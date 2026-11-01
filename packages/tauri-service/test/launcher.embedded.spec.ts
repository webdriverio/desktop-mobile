import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/embeddedProvider.js', () => ({
  checkEmbeddedServerAlive: vi.fn(),
  startEmbeddedDriver: vi.fn(),
  stopEmbeddedDriver: vi.fn(),
  getEmbeddedPort: vi.fn().mockReturnValue(4445),
  isEmbeddedProvider: vi.fn().mockReturnValue(true),
}));

vi.mock('../src/diagnostics.js', () => ({
  diagnoseTauriEnvironment: vi.fn().mockResolvedValue([]),
}));

vi.mock('@wdio/native-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-utils')>()),
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  formatDiagnosticResults: vi.fn(),
  isErr: vi.fn().mockReturnValue(false),
  isOk: vi.fn().mockReturnValue(true),
  Ok: (v: unknown) => ({ ok: true, value: v }),
  Err: (e: unknown) => ({ ok: false, error: e }),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('../src/driverPool.js', () => ({
  DriverPool: class MockDriverPool {
    startDriver = vi.fn();
    stopDriver = vi.fn().mockResolvedValue(undefined);
    stopAll = vi.fn().mockResolvedValue(undefined);
    getStatus = vi.fn().mockReturnValue({ count: 0, running: false });
    getRunningPids = vi.fn().mockReturnValue([]);
  },
}));

vi.mock('@wdio/native-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-core')>()),
  PortManager: class MockPortManager {
    allocatePortPair = vi.fn().mockResolvedValue({ port: 4444, nativePort: 4445 });
    allocatePorts = vi.fn().mockResolvedValue([{ port: 4444, nativePort: 4445 }]);
    allocatePort = vi.fn().mockResolvedValue(4444);
    clear = vi.fn();
  },
}));

vi.mock('../src/pathResolver.js', () => ({
  getWebKitWebDriverPath: vi.fn().mockReturnValue('/usr/bin/WebKitWebDriver'),
}));

vi.mock('../src/driverManager.js', () => ({
  ensureTauriDriver: vi.fn().mockResolvedValue({ ok: true, value: { path: '/tauri-driver', method: 'found' } }),
  findTestRunnerBackend: vi.fn(),
}));

vi.mock('../src/edgeDriverManager.js', () => ({
  ensureMsEdgeDriver: vi.fn().mockResolvedValue({ ok: true, value: { method: 'found', driverVersion: '120' } }),
}));

vi.mock('../src/crabnebulaBackend.js', () => ({
  startTestRunnerBackend: vi.fn(),
  stopTestRunnerBackend: vi.fn().mockResolvedValue(undefined),
  waitTestRunnerBackendReady: vi.fn().mockResolvedValue(undefined),
}));

import { mockPlatform, restorePlatform } from '@repo/test-utils';
import { checkEmbeddedServerAlive, startEmbeddedDriver, stopEmbeddedDriver } from '../src/embeddedProvider.js';
import TauriLaunchService from '../src/launcher.js';

const APP_BINARY = '/app/my-app';
const EMBEDDED_PORT = 4445;

const stubDriverInfo = { proc: { pid: 123, kill: vi.fn() } as any, logHandlers: [] };
const stubConfig = { appBinaryPath: APP_BINARY, port: EMBEDDED_PORT, options: {} };
const stdCaps = [{ 'tauri:options': { application: APP_BINARY } }];

function createEmbeddedLauncher(): TauriLaunchService {
  const launcher = new TauriLaunchService(
    {},
    { 'tauri:options': { application: APP_BINARY } } as any,
    { maxInstances: 1 } as any,
  );
  (launcher as any).isEmbeddedMode = true;
  (launcher as any).perWorkerMode = false;
  return launcher;
}

describe('ensureEmbeddedServersHealthy', () => {
  let launcher: TauriLaunchService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stopEmbeddedDriver).mockResolvedValue(undefined);
    launcher = createEmbeddedLauncher();
    (launcher as any).embeddedConfigs.set('0', stubConfig);
    (launcher as any).embeddedProcesses.set('0', stubDriverInfo);
  });

  it('should do nothing when the server is reachable', async () => {
    vi.mocked(checkEmbeddedServerAlive).mockResolvedValue(true);

    await (launcher as any).ensureEmbeddedServersHealthy();

    expect(stopEmbeddedDriver).not.toHaveBeenCalled();
    expect(startEmbeddedDriver).not.toHaveBeenCalled();
  });

  it('should stop the old process and start a new one when the server is unreachable', async () => {
    const newInfo = { proc: { pid: 456 } as any, logHandlers: [] };
    vi.mocked(checkEmbeddedServerAlive).mockResolvedValue(false);
    vi.mocked(startEmbeddedDriver).mockResolvedValue(newInfo);

    await (launcher as any).ensureEmbeddedServersHealthy();

    expect(stopEmbeddedDriver).toHaveBeenCalledWith(stubDriverInfo);
    expect(startEmbeddedDriver).toHaveBeenCalledWith(APP_BINARY, EMBEDDED_PORT, {}, '0');
    expect((launcher as any).embeddedProcesses.get('0')).toBe(newInfo);
  });

  it('retains the old process and refuses to restart if shutdown fails', async () => {
    const error = new Error('process did not exit');
    vi.mocked(checkEmbeddedServerAlive).mockResolvedValue(false);
    vi.mocked(stopEmbeddedDriver).mockRejectedValue(error);
    await expect(launcher.onWorkerStart('0-0', stdCaps)).rejects.toBe(error);
    expect(startEmbeddedDriver).not.toHaveBeenCalled();
    vi.mocked(stopEmbeddedDriver).mockResolvedValue(undefined);
    await launcher.onComplete(0, { capabilities: [] }, []);
    expect(stopEmbeddedDriver).toHaveBeenLastCalledWith(stubDriverInfo);
  });

  it('should throw SevereServiceError when restart fails', async () => {
    vi.mocked(checkEmbeddedServerAlive).mockResolvedValue(false);
    vi.mocked(startEmbeddedDriver).mockRejectedValue(new Error('Binary not found'));

    await expect((launcher as any).ensureEmbeddedServersHealthy()).rejects.toThrow(
      'Failed to restart embedded WebDriver on port 4445',
    );
  });

  it('should restart only the crashed instance when multiple instances are running', async () => {
    const config2 = { appBinaryPath: APP_BINARY, port: 4446, options: {} };
    const driverInfo2 = { proc: { pid: 789 } as any, logHandlers: [] };
    (launcher as any).embeddedConfigs.set('1', config2);
    (launcher as any).embeddedProcesses.set('1', driverInfo2);

    vi.mocked(checkEmbeddedServerAlive).mockImplementation(async (port) => port === 4446);
    const newInfo = { proc: { pid: 999 } as any, logHandlers: [] };
    vi.mocked(startEmbeddedDriver).mockResolvedValue(newInfo);

    await (launcher as any).ensureEmbeddedServersHealthy();

    expect(startEmbeddedDriver).toHaveBeenCalledOnce();
    expect(startEmbeddedDriver).toHaveBeenCalledWith(APP_BINARY, EMBEDDED_PORT, {}, '0');
    expect((launcher as any).embeddedProcesses.get('0')).toBe(newInfo);
    expect((launcher as any).embeddedProcesses.get('1')).toBe(driverInfo2);
  });

  it('should do nothing when embeddedConfigs is empty', async () => {
    (launcher as any).embeddedConfigs.clear();

    await (launcher as any).ensureEmbeddedServersHealthy();

    expect(checkEmbeddedServerAlive).not.toHaveBeenCalled();
  });
});

describe('verifyEmbeddedServerStable — Windows stability probes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    vi.mocked(stopEmbeddedDriver).mockResolvedValue(undefined);
    mockPlatform('win32');
  });

  afterEach(() => {
    vi.useRealTimers();
    restorePlatform();
  });

  it('should run 3 additional probes on win32 after a passing health check', async () => {
    vi.mocked(checkEmbeddedServerAlive).mockResolvedValue(true);

    const launcher = createEmbeddedLauncher();
    (launcher as any).embeddedConfigs.set('0', stubConfig);
    (launcher as any).embeddedProcesses.set('0', stubDriverInfo);

    const promise = (launcher as any).ensureEmbeddedServersHealthy();
    await vi.advanceTimersByTimeAsync(1600);
    await promise;

    // 1 initial check + 3 stability probes
    expect(checkEmbeddedServerAlive).toHaveBeenCalledTimes(4);
    expect(startEmbeddedDriver).not.toHaveBeenCalled();
  });

  it('should restart when a stability probe flips to false', async () => {
    let callCount = 0;
    vi.mocked(checkEmbeddedServerAlive).mockImplementation(async () => {
      callCount++;
      return callCount !== 2; // initial=true, first stability probe=false
    });
    const newInfo = { proc: { pid: 999 } as any, logHandlers: [] };
    vi.mocked(startEmbeddedDriver).mockResolvedValue(newInfo);

    const launcher = createEmbeddedLauncher();
    (launcher as any).embeddedConfigs.set('0', stubConfig);
    (launcher as any).embeddedProcesses.set('0', stubDriverInfo);

    const promise = (launcher as any).ensureEmbeddedServersHealthy();
    await vi.advanceTimersByTimeAsync(600);
    await promise;

    expect(startEmbeddedDriver).toHaveBeenCalledWith(APP_BINARY, EMBEDDED_PORT, {}, '0');
    expect((launcher as any).embeddedProcesses.get('0')).toBe(newInfo);
  });

  it('should not run stability probes on non-win32', async () => {
    mockPlatform('darwin');
    vi.mocked(checkEmbeddedServerAlive).mockResolvedValue(true);

    const launcher = createEmbeddedLauncher();
    (launcher as any).embeddedConfigs.set('0', stubConfig);
    (launcher as any).embeddedProcesses.set('0', stubDriverInfo);

    await (launcher as any).ensureEmbeddedServersHealthy();

    // Only the single initial check — no stability probes
    expect(checkEmbeddedServerAlive).toHaveBeenCalledTimes(1);
  });
});

describe('onWorkerStart — embedded health check guard', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should run health check when isEmbeddedMode=true and perWorkerMode=false', async () => {
    vi.mocked(checkEmbeddedServerAlive).mockResolvedValue(true);
    const launcher = createEmbeddedLauncher();
    (launcher as any).embeddedConfigs.set('0', stubConfig);
    (launcher as any).embeddedProcesses.set('0', stubDriverInfo);

    await launcher.onWorkerStart('0-0', stdCaps as any);

    expect(checkEmbeddedServerAlive).toHaveBeenCalledWith(EMBEDDED_PORT, undefined);
  });

  it('should skip health check when isEmbeddedMode=false', async () => {
    const launcher = createEmbeddedLauncher();
    (launcher as any).isEmbeddedMode = false;
    (launcher as any).embeddedConfigs.set('0', stubConfig);

    await launcher.onWorkerStart('0-0', stdCaps as any);

    expect(checkEmbeddedServerAlive).not.toHaveBeenCalled();
  });

  it('should skip health check when perWorkerMode=true', async () => {
    const launcher = createEmbeddedLauncher();
    (launcher as any).perWorkerMode = true;
    (launcher as any).embeddedConfigs.set('0', stubConfig);

    await launcher.onWorkerStart('0-0', stdCaps as any);

    expect(checkEmbeddedServerAlive).not.toHaveBeenCalled();
  });
});

describe('embedded launcher lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(startEmbeddedDriver).mockResolvedValue(stubDriverInfo);
    vi.mocked(stopEmbeddedDriver).mockResolvedValue(undefined);
    vi.mocked(checkEmbeddedServerAlive).mockResolvedValue(true);
  });

  it.each(['linux', 'win32', 'darwin'])('skips external setup and diagnostics on %s', async (platform) => {
    mockPlatform(platform);
    try {
      const { getWebKitWebDriverPath } = await import('../src/pathResolver.js');
      const { ensureMsEdgeDriver } = await import('../src/edgeDriverManager.js');
      const { ensureTauriDriver } = await import('../src/driverManager.js');
      const { diagnoseTauriEnvironment } = await import('../src/diagnostics.js');
      const caps = { 'tauri:options': { application: APP_BINARY } };
      const config = { maxInstances: 2, capabilities: [caps] };
      const launcher = new TauriLaunchService({}, caps, config);
      await launcher.onPrepare(config, [caps]);
      await launcher.onWorkerStart('0-0', [caps]);
      expect(getWebKitWebDriverPath).not.toHaveBeenCalled();
      expect(ensureMsEdgeDriver).not.toHaveBeenCalled();
      expect(ensureTauriDriver).not.toHaveBeenCalled();
      expect(diagnoseTauriEnvironment).not.toHaveBeenCalled();
      await launcher.onComplete(0, config, []);
    } finally {
      restorePlatform();
    }
  });

  it.each([false, true])('preserves startup causes (multiremote=%s)', async (multiremote) => {
    const { SevereServiceError } = await import('webdriverio');
    const cause = new AggregateError([new Error('startup'), new Error('cleanup')], 'both failed');
    vi.mocked(startEmbeddedDriver).mockRejectedValueOnce(cause);
    const caps = { 'tauri:options': { application: APP_BINARY } };
    const launcher = new TauriLaunchService({}, caps, { capabilities: [] });
    const capabilities = multiremote ? { app: { capabilities: caps } } : [caps];
    const result = launcher.onPrepare({ capabilities: [] }, capabilities);
    await expect(result).rejects.toBeInstanceOf(SevereServiceError);
    await expect(result).rejects.toMatchObject({ name: 'SevereServiceError', cause });
  });

  it('tries every cleanup, reports all failures and retries only retained processes', async () => {
    const caps = { 'tauri:options': { application: APP_BINARY } };
    const launcher = new TauriLaunchService({}, caps, { capabilities: [] });
    const capabilities = {
      first: { capabilities: structuredClone(caps) },
      second: { capabilities: structuredClone(caps) },
    };
    await launcher.onPrepare({ capabilities: [] }, capabilities);
    const first = new Error('first did not exit');
    const second = new Error('second did not exit');
    vi.mocked(stopEmbeddedDriver).mockRejectedValueOnce(first).mockRejectedValueOnce(second);
    await expect(launcher.onComplete(0, { capabilities: [] }, [])).rejects.toMatchObject({
      cause: first,
      errors: [first, second],
    });
    expect(stopEmbeddedDriver).toHaveBeenCalledTimes(2);
    vi.mocked(stopEmbeddedDriver).mockResolvedValueOnce(undefined).mockRejectedValueOnce(second);
    await expect(launcher.onComplete(0, { capabilities: [] }, [])).rejects.toBe(second);
    vi.mocked(stopEmbeddedDriver).mockClear().mockResolvedValue(undefined);
    await launcher.onComplete(0, { capabilities: [] }, []);
    expect(stopEmbeddedDriver).toHaveBeenCalledOnce();
  });

  it('should still clear its state and report every failure when stopping the driver pool fails', async () => {
    const caps = { 'tauri:options': { application: APP_BINARY } };
    const launcher = new TauriLaunchService({}, caps, { capabilities: [] });
    await launcher.onPrepare({ capabilities: [] }, { only: { capabilities: structuredClone(caps) } });
    const embeddedError = new Error('embedded did not exit');
    const poolError = new AggregateError([new Error('kill failed')], 'Failed to stop driver(s)');
    vi.mocked(stopEmbeddedDriver).mockRejectedValueOnce(embeddedError);
    const internals = launcher as unknown as {
      driverPool: { stopAll: ReturnType<typeof vi.fn> };
      portManager: { clear: ReturnType<typeof vi.fn> };
      instanceOptions: Map<string, unknown>;
    };
    internals.driverPool.stopAll.mockRejectedValueOnce(poolError);

    await expect(launcher.onComplete(0, { capabilities: [] }, [])).rejects.toMatchObject({
      errors: [embeddedError, poolError],
    });
    expect(internals.portManager.clear).toHaveBeenCalled();
    expect(internals.instanceOptions.size).toBe(0);
  });
});

describe('driverProvider validation', () => {
  const caps = { 'tauri:options': { application: APP_BINARY } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject an unknown provider set in the service options', async () => {
    const { SevereServiceError } = await import('webdriverio');
    const launcher = new TauriLaunchService({ driverProvider: 'webkit' } as any, caps, { capabilities: [] });
    const result = launcher.onPrepare({ capabilities: [] }, [caps]);
    await expect(result).rejects.toBeInstanceOf(SevereServiceError);
    await expect(result).rejects.toMatchObject({
      message: `driverProvider must be 'embedded', 'external' or 'crabnebula', not "webkit".`,
    });
    expect(startEmbeddedDriver).not.toHaveBeenCalled();
  });

  it('should reject an unknown provider set in the capability options', async () => {
    const launcher = new TauriLaunchService({}, caps, { capabilities: [] });
    const capability = { ...caps, 'wdio:tauriServiceOptions': { driverProvider: 'tauri-driver' } } as any;
    await expect(launcher.onPrepare({ capabilities: [] }, [capability])).rejects.toMatchObject({
      name: 'SevereServiceError',
      message: `driverProvider must be 'embedded', 'external' or 'crabnebula', not "tauri-driver".`,
    });
  });
});

describe('embedded port allocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(startEmbeddedDriver).mockResolvedValue(stubDriverInfo);
  });

  function stubAllocatedPorts(launcher: TauriLaunchService, ...ports: number[]) {
    const { allocatePort } = (launcher as unknown as { portManager: { allocatePort: ReturnType<typeof vi.fn> } })
      .portManager;
    for (const port of ports) {
      allocatePort.mockResolvedValueOnce(port);
    }
    return allocatePort;
  }

  it('should prefer sequential ports for multiple capabilities and use the free ones allocated', async () => {
    const caps = [
      { 'tauri:options': { application: APP_BINARY } },
      { 'tauri:options': { application: APP_BINARY } },
    ] as Array<{ port?: number }>;
    const launcher = new TauriLaunchService({}, caps[0], { capabilities: [] });
    const allocatePort = stubAllocatedPorts(launcher, 4445, 51234);

    await launcher.onPrepare({ capabilities: [] }, caps as never);

    expect(allocatePort.mock.calls).toEqual([[4445], [4446]]);
    expect(vi.mocked(startEmbeddedDriver).mock.calls.map((call) => call[1])).toEqual([4445, 51234]);
    expect(caps.map((cap) => cap.port)).toEqual([4445, 51234]);
  });

  it("should prefer a multiremote instance's own embeddedPort and connect each instance to its allocated port", async () => {
    const caps = {
      appA: {
        capabilities: {
          'tauri:options': { application: APP_BINARY },
          'wdio:tauriServiceOptions': { embeddedPort: 5000 },
        },
      },
      appB: { capabilities: { 'tauri:options': { application: APP_BINARY } } },
    };
    const launcher = new TauriLaunchService({}, caps.appA.capabilities, { capabilities: [] });
    const allocatePort = stubAllocatedPorts(launcher, 5000, 51234);

    await launcher.onPrepare({ capabilities: [] }, caps);

    expect(allocatePort.mock.calls).toEqual([[5000], [4446]]);
    expect(vi.mocked(startEmbeddedDriver).mock.calls.map((call) => call[1])).toEqual([5000, 51234]);
    expect((caps.appA as { port?: number }).port).toBe(5000);
    expect((caps.appB as { port?: number }).port).toBe(51234);
  });
});
