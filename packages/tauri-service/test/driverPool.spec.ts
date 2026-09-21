import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared mock state: driverPool is now a Tauri-flavoured wrapper around
// @wdio/native-core's DriverPool. We mock core's DriverPool with an
// in-memory fake (Map-backed) and expose mockIsRunning / mockProcPid /
// mockStop so individual tests can simulate stopped drivers, missing PIDs,
// etc. without spawning real child processes.

const mockStop = vi.fn();
const mockIsRunning = vi.fn();
let mockProcPid: number | undefined = 12345;

interface FakeDriverInfo {
  process: {
    stop: () => Promise<void>;
    isRunning: () => boolean;
    proc: { pid: number | undefined };
  };
  port: number;
  nativePort: number;
  mode: 'single' | 'worker' | 'multiremote';
  identifier: string;
}

const driverState = new Map<string, FakeDriverInfo>();

vi.mock('@wdio/native-core', async (importActual) => {
  const actual = await importActual<typeof import('@wdio/native-core')>();
  return {
    ...actual,
    DriverPool: class MockCoreDriverPool {
      async startDriver(config: {
        mode: 'single' | 'worker' | 'multiremote';
        identifier: string;
        port: number;
        nativePort: number;
      }): Promise<FakeDriverInfo> {
        const info: FakeDriverInfo = {
          process: {
            stop: mockStop,
            isRunning: mockIsRunning,
            proc: {
              get pid() {
                return mockProcPid;
              },
            },
          },
          port: config.port,
          nativePort: config.nativePort,
          mode: config.mode,
          identifier: config.identifier,
        };
        driverState.set(config.identifier, info);
        return info;
      }

      async stopDriver(identifier: string): Promise<void> {
        const info = driverState.get(identifier);
        if (info) {
          await info.process.stop();
          driverState.delete(identifier);
        }
      }

      async stopAll(): Promise<void> {
        for (const info of driverState.values()) {
          await info.process.stop();
        }
        driverState.clear();
      }

      getDriver(id: string) {
        return driverState.get(id);
      }

      getDriverProcess(id: string) {
        return driverState.get(id)?.process;
      }

      getStatus(): { running: boolean; count: number; identifiers: string[] } {
        const identifiers = Array.from(driverState.keys());
        const runningCount = Array.from(driverState.values()).filter((info) => info.process.isRunning()).length;
        return {
          running: runningCount > 0,
          count: runningCount,
          identifiers,
        };
      }

      getRunningPids(): number[] {
        const pids: number[] = [];
        for (const info of driverState.values()) {
          if (info.process.isRunning() && info.process.proc?.pid) {
            pids.push(info.process.proc.pid);
          }
        }
        return pids;
      }
    },
  };
});

vi.mock('../src/driverManager.js', () => ({
  ensureTauriDriver: vi.fn(async () => ({
    ok: true,
    value: { path: '/mock/tauri-driver', method: 'found' as const },
  })),
}));

vi.mock('../src/pathResolver.js', () => ({
  getWebKitWebDriverPath: vi.fn(() => '/mock/webkit-driver'),
}));

describe('DriverPool', () => {
  let pool: Awaited<ReturnType<typeof import('../src/driverPool.js').DriverPool>>;
  let ensureTauriDriver: typeof import('../src/driverManager.js').ensureTauriDriver;

  beforeEach(async () => {
    mockStop.mockClear().mockResolvedValue(undefined);
    mockIsRunning.mockClear().mockReturnValue(true);
    mockProcPid = 12345;
    driverState.clear();

    const driverManagerMod = await import('../src/driverManager.js');
    ensureTauriDriver = driverManagerMod.ensureTauriDriver;
    vi.mocked(ensureTauriDriver).mockResolvedValue({
      ok: true,
      value: { path: '/mock/tauri-driver', method: 'found' as const },
    });

    const { DriverPool } = await import('../src/driverPool.js');
    pool = new DriverPool({}, '/mock/native-driver');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('startDriver', () => {
    it('should start a driver in single mode', async () => {
      const config = {
        mode: 'single' as const,
        identifier: 'tauri-driver',
        port: 4444,
        nativePort: 4445,
      };

      const info = await pool.startDriver(config);

      expect(info.mode).toBe('single');
      expect(info.identifier).toBe('tauri-driver');
      expect(info.port).toBe(4444);
      expect(info.nativePort).toBe(4445);
    });

    it('should start a driver in worker mode', async () => {
      const config = {
        mode: 'worker' as const,
        identifier: 'worker-0',
        port: 4500,
        nativePort: 4501,
        instanceId: '0',
      };

      const info = await pool.startDriver(config);

      expect(info.mode).toBe('worker');
      expect(info.identifier).toBe('worker-0');
    });

    it('should start a driver in multiremote mode', async () => {
      const config = {
        mode: 'multiremote' as const,
        identifier: 'browserA',
        port: 4600,
        nativePort: 4601,
        env: { CUSTOM_VAR: 'value' },
      };

      const info = await pool.startDriver(config);

      expect(info.mode).toBe('multiremote');
      expect(info.identifier).toBe('browserA');
    });

    it('should track started drivers', async () => {
      await pool.startDriver({
        mode: 'single',
        identifier: 'driver-1',
        port: 4444,
        nativePort: 4445,
      });

      await pool.startDriver({
        mode: 'worker',
        identifier: 'driver-2',
        port: 4500,
        nativePort: 4501,
      });

      const status = pool.getStatus();
      expect(status.count).toBe(2);
      expect(status.identifiers).toContain('driver-1');
      expect(status.identifiers).toContain('driver-2');
    });

    it('should throw when ensureTauriDriver returns an Err result', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: false,
        error: new Error('tauri-driver not found'),
      });

      await expect(
        pool.startDriver({
          mode: 'single',
          identifier: 'fail-driver',
          port: 4444,
          nativePort: 4445,
        }),
      ).rejects.toThrow('tauri-driver not found');
    });
  });

  describe('stopDriver', () => {
    it('should stop a specific driver', async () => {
      await pool.startDriver({
        mode: 'single',
        identifier: 'test-driver',
        port: 4444,
        nativePort: 4445,
      });

      await pool.stopDriver('test-driver');

      const status = pool.getStatus();
      expect(status.running).toBe(false);
      expect(status.count).toBe(0);
    });

    it('should handle stopping non-existent driver', async () => {
      await expect(pool.stopDriver('non-existent')).resolves.not.toThrow();
    });

    it('should only stop the specified driver', async () => {
      await pool.startDriver({
        mode: 'worker',
        identifier: 'worker-1',
        port: 4444,
        nativePort: 4445,
      });

      await pool.startDriver({
        mode: 'worker',
        identifier: 'worker-2',
        port: 4500,
        nativePort: 4501,
      });

      await pool.stopDriver('worker-1');

      const status = pool.getStatus();
      expect(status.identifiers).toContain('worker-2');
      expect(status.identifiers).not.toContain('worker-1');
    });
  });

  describe('stopAll', () => {
    it('should stop all drivers', async () => {
      await pool.startDriver({
        mode: 'single',
        identifier: 'driver-1',
        port: 4444,
        nativePort: 4445,
      });

      await pool.startDriver({
        mode: 'worker',
        identifier: 'driver-2',
        port: 4500,
        nativePort: 4501,
      });

      await pool.startDriver({
        mode: 'multiremote',
        identifier: 'driver-3',
        port: 4600,
        nativePort: 4601,
      });

      await pool.stopAll();

      const status = pool.getStatus();
      expect(status.count).toBe(0);
      expect(status.identifiers).toHaveLength(0);
    });

    it('should handle empty pool', async () => {
      await expect(pool.stopAll()).resolves.not.toThrow();
    });
  });

  describe('getDriver', () => {
    it('should return driver info for existing driver', async () => {
      await pool.startDriver({
        mode: 'single',
        identifier: 'test-driver',
        port: 4444,
        nativePort: 4445,
      });

      const info = pool.getDriver('test-driver');

      expect(info).toBeDefined();
      expect(info?.identifier).toBe('test-driver');
      expect(info?.port).toBe(4444);
    });

    it('should return undefined for non-existent driver', () => {
      const info = pool.getDriver('non-existent');
      expect(info).toBeUndefined();
    });
  });

  describe('getDriverProcess', () => {
    it('should return driver process for existing driver', async () => {
      await pool.startDriver({
        mode: 'single',
        identifier: 'test-driver',
        port: 4444,
        nativePort: 4445,
      });

      const process = pool.getDriverProcess('test-driver');
      expect(process).toBeDefined();
    });

    it('should return undefined for non-existent driver', () => {
      const process = pool.getDriverProcess('non-existent');
      expect(process).toBeUndefined();
    });
  });

  describe('getStatus', () => {
    it('should return correct status for empty pool', () => {
      const status = pool.getStatus();

      expect(status.running).toBe(false);
      expect(status.count).toBe(0);
      expect(status.identifiers).toHaveLength(0);
    });

    it('should return correct status with running drivers', async () => {
      await pool.startDriver({
        mode: 'single',
        identifier: 'driver-1',
        port: 4444,
        nativePort: 4445,
      });

      const status = pool.getStatus();

      expect(status.running).toBe(true);
      expect(status.count).toBe(1);
      expect(status.identifiers).toContain('driver-1');
    });

    it('should report mixed running/stopped drivers correctly', async () => {
      await pool.startDriver({
        mode: 'worker',
        identifier: 'running-driver',
        port: 4444,
        nativePort: 4445,
      });

      await pool.startDriver({
        mode: 'worker',
        identifier: 'stopped-driver',
        port: 4500,
        nativePort: 4501,
      });

      mockIsRunning
        .mockReturnValueOnce(true) // running-driver
        .mockReturnValueOnce(false); // stopped-driver

      const status = pool.getStatus();

      expect(status.identifiers).toHaveLength(2);
      expect(status.count).toBe(1);
      expect(status.running).toBe(true);
    });
  });

  describe('getRunningPids', () => {
    it('should return empty array for empty pool', () => {
      const pids = pool.getRunningPids();
      expect(pids).toHaveLength(0);
    });

    it('should return PIDs for running drivers', async () => {
      await pool.startDriver({
        mode: 'single',
        identifier: 'driver-1',
        port: 4444,
        nativePort: 4445,
      });

      const pids = pool.getRunningPids();
      expect(pids).toContain(12345);
    });

    it('should exclude drivers with undefined pid', async () => {
      await pool.startDriver({
        mode: 'single',
        identifier: 'no-pid-driver',
        port: 4444,
        nativePort: 4445,
      });

      mockProcPid = undefined;

      const pids = pool.getRunningPids();
      expect(pids).toHaveLength(0);
    });

    it('should exclude stopped drivers', async () => {
      await pool.startDriver({
        mode: 'single',
        identifier: 'stopped-driver',
        port: 4444,
        nativePort: 4445,
      });

      mockIsRunning.mockReturnValue(false);

      const pids = pool.getRunningPids();
      expect(pids).toHaveLength(0);
    });
  });
});

describe('native driver resolution', () => {
  it.each([undefined, '/mock/webkit-driver'])('caches lazy resolution even when it returns %s', async (path) => {
    const { DriverPool } = await import('../src/driverPool.js');
    const { getWebKitWebDriverPath } = await import('../src/pathResolver.js');
    vi.mocked(getWebKitWebDriverPath).mockClear().mockReturnValue(path);
    const pool = new DriverPool({});
    expect(getWebKitWebDriverPath).not.toHaveBeenCalled();
    await pool.startDriver({ mode: 'worker', identifier: 'one', port: 4444, nativePort: 4445 });
    await pool.startDriver({ mode: 'worker', identifier: 'two', port: 4446, nativePort: 4447 });
    expect(getWebKitWebDriverPath).toHaveBeenCalledOnce();
  });
});
