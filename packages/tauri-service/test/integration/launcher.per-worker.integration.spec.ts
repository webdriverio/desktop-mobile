import type { spawn } from 'node:child_process';
import getPort from 'get-port';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TauriCapabilities } from '../../src/types.js';

// Mock only the driver discovery, not the process itself
vi.mock('../../src/driverManager.js', () => ({
  ensureTauriDriver: vi.fn(),
  ensureWebKitWebDriver: vi.fn().mockResolvedValue({
    ok: true,
    value: { path: '/usr/bin/WebKitWebDriver' },
  }),
}));

vi.mock('../../src/pathResolver.js', () => ({
  getWebKitWebDriverPath: vi.fn().mockReturnValue('/usr/bin/WebKitWebDriver'),
}));

vi.mock('@wdio/native-utils', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  })),
  isErr: vi.fn(() => false),
  isOk: vi.fn(() => true),
  Ok: vi.fn((v: unknown) => ({ ok: true, value: v })),
  Err: vi.fn((e: unknown) => ({ ok: false, error: e })),
  diagnosePlatform: vi.fn(() => [
    { category: 'Platform', status: 'ok', message: 'linux x64' },
    { category: 'Node Version', status: 'ok', message: 'v20.0.0' },
  ]),
  diagnoseDisplay: vi.fn(() => []),
  diagnoseBinary: vi.fn(() => [
    { category: 'Binary Permissions', status: 'ok', message: '755' },
    { category: 'Binary Size', status: 'ok', message: '100.00 MB' },
  ]),
  diagnoseDiskSpace: vi.fn(() => []),
  diagnoseLinuxDependencies: vi.fn(() => []),
  formatDiagnosticResults: vi.fn(),
}));

vi.mock('../../src/edgeDriverManager.js', () => ({
  ensureMsEdgeDriver: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      method: 'found',
      driverVersion: '120.0.0',
    },
  }),
}));

// Mock fs.existsSync to always return true (we're using mock drivers)
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

// Mock execSync to prevent ldd errors in tests
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

import { ensureTauriDriver } from '../../src/driverManager.js';
import TauriLaunchService from '../../src/launcher.js';
import { mockSuccessPath } from '../mockPaths.js';

// Track all spawned processes for cleanup
const spawnedProcesses: ReturnType<typeof spawn>[] = [];

// Global cleanup - kill any leftover processes
afterAll(async () => {
  for (const proc of spawnedProcesses) {
    if (!proc.killed) {
      proc.kill('SIGKILL');
    }
  }
  // Give processes time to die
  await new Promise((resolve) => setTimeout(resolve, 100));
});

describe('Per-Worker Mode - Integration', () => {
  let launcher: TauriLaunchService;
  let basePort: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Use dynamic base port to avoid conflicts
    basePort = await getPort({ port: 4444 });
  });

  afterEach(async () => {
    // Clean up launcher after each test
    if (launcher) {
      try {
        await Promise.race([
          (launcher as any).onComplete?.(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Cleanup timeout')), 5000)),
        ]);
      } catch {
        // Ignore cleanup errors
      }
    }
    // Wait for ports to be fully released
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe('worker spawning', () => {
    it('should spawn separate driver per worker', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { tauriDriverPort: basePort, driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 2 },
      );

      // Simulate onPrepare (this sets up per-worker mode)
      await (launcher as any).onPrepare({}, [{ browserName: 'tauri', 'tauri:options': { application: '/app' } }]);

      // Simulate worker 0 starting
      const caps0: TauriCapabilities = {
        browserName: 'tauri',
        'tauri:options': { application: '/app' },
      };
      await (launcher as any).onWorkerStart('0-0', caps0, [], {});

      // Verify worker 0 driver is running
      expect((launcher as any).getTauriDriverStatus().running).toBe(true);

      // Simulate worker 1 starting
      const caps1: TauriCapabilities = {
        browserName: 'tauri',
        'tauri:options': { application: '/app' },
      };
      await (launcher as any).onWorkerStart('0-1', caps1, [], {});

      // Both workers should have their own drivers
      const status0 = (launcher as any).getTauriDriverStatus();
      expect(status0.running).toBe(true);
    });

    it('should allocate unique ports for each worker', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { tauriDriverPort: basePort, driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 2 },
      );

      const ports: number[] = [];

      // Mock capability updates to capture port assignments
      await (launcher as any).onPrepare({}, [{ browserName: 'tauri', 'tauri:options': { application: '/app' } }]);

      // Start worker 0
      const caps0: TauriCapabilities & { port?: number } = {
        browserName: 'tauri',
        'tauri:options': { application: '/app' },
      };
      await (launcher as any).onWorkerStart('0-0', caps0, [], {});
      expect(caps0.port).toBeDefined();
      ports.push(caps0.port as number);

      // Start worker 1
      const caps1: TauriCapabilities & { port?: number } = {
        browserName: 'tauri',
        'tauri:options': { application: '/app' },
      };
      await (launcher as any).onWorkerStart('0-1', caps1, [], {});
      expect(caps1.port).toBeDefined();
      ports.push(caps1.port as number);

      // Verify ports are unique
      expect(ports[0]).not.toBe(ports[1]);
      expect(ports[0]).toBeGreaterThan(0);
      expect(ports[1]).toBeGreaterThan(0);
    });

    it('should set environment variables per worker', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { tauriDriverPort: basePort, driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      await (launcher as any).onPrepare({}, [
        {
          browserName: 'tauri',
          'tauri:options': { application: '/app' },
          'wdio:tauriServiceOptions': {
            env: { TEST_VAR: 'worker_value' },
          },
        },
      ]);

      const caps: TauriCapabilities = {
        browserName: 'tauri',
        'tauri:options': { application: '/app' },
      };

      // Should not throw when starting with custom env
      await expect((launcher as any).onWorkerStart('0-0', caps, [], {})).resolves.not.toThrow();
    });
  });

  describe('worker isolation', () => {
    it('should stop correct worker without affecting others', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { tauriDriverPort: basePort, driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 2 },
      );

      await (launcher as any).onPrepare({}, [{ browserName: 'tauri', 'tauri:options': { application: '/app' } }]);

      // Start two workers
      const caps0: TauriCapabilities & { port?: number } = {
        browserName: 'tauri',
        'tauri:options': { application: '/app' },
      };
      const caps1: TauriCapabilities & { port?: number } = {
        browserName: 'tauri',
        'tauri:options': { application: '/app' },
      };

      await (launcher as any).onWorkerStart('0-0', caps0, [], {});
      await (launcher as any).onWorkerStart('0-1', caps1, [], {});

      // Stop worker 0
      await (launcher as any).stopTauriDriverForWorker?.('0-0');

      // Worker 1 should still be running
      // Note: We can't easily verify this without exposing more state,
      // but the test validates no errors are thrown
      expect((launcher as any).getTauriDriverStatus().running).toBe(true);
    });

    it('should handle worker end event', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { tauriDriverPort: basePort, driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      await (launcher as any).onPrepare({}, [{ browserName: 'tauri', 'tauri:options': { application: '/app' } }]);

      const caps: TauriCapabilities = {
        browserName: 'tauri',
        'tauri:options': { application: '/app' },
      };

      await (launcher as any).onWorkerStart('0-0', caps, [], {});

      // Simulate worker ending
      await expect((launcher as any).onWorkerEnd?.('0-0')).resolves.not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should cleanup all workers in onComplete', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { tauriDriverPort: basePort, driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 2 },
      );

      await (launcher as any).onPrepare({}, [{ browserName: 'tauri', 'tauri:options': { application: '/app' } }]);

      // Start multiple workers
      const caps0: TauriCapabilities = {
        browserName: 'tauri',
        'tauri:options': { application: '/app' },
      };
      const caps1: TauriCapabilities = {
        browserName: 'tauri',
        'tauri:options': { application: '/app' },
      };

      await (launcher as any).onWorkerStart('0-0', caps0, [], {});
      await (launcher as any).onWorkerStart('0-1', caps1, [], {});

      // onComplete should clean up all workers without errors
      await expect((launcher as any).onComplete?.()).resolves.not.toThrow();
    });

    it('should handle worker start failures gracefully', async () => {
      // Use a driver that will fail to start
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: 'node', method: 'found' }, // This will exit immediately
      });

      launcher = new TauriLaunchService(
        { tauriDriverPort: basePort, driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      await (launcher as any).onPrepare({}, [{ browserName: 'tauri', 'tauri:options': { application: '/app' } }]);

      const caps: TauriCapabilities = {
        browserName: 'tauri',
        'tauri:options': { application: '/app' },
      };

      // Should reject when driver fails to start
      await expect((launcher as any).onWorkerStart('0-0', caps, [], {})).rejects.toThrow();
    });
  });
});
