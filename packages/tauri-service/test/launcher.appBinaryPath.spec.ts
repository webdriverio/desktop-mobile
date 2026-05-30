import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/embeddedProvider.js', () => ({
  checkEmbeddedServerAlive: vi.fn(),
  startEmbeddedDriver: vi.fn().mockResolvedValue({ proc: { pid: 42, kill: vi.fn() }, logHandlers: [] }),
  stopEmbeddedDriver: vi.fn().mockResolvedValue(undefined),
  getEmbeddedPort: vi.fn().mockReturnValue(4445),
  isEmbeddedProvider: vi.fn().mockReturnValue(true),
}));

vi.mock('../src/diagnostics.js', () => ({
  diagnoseTauriEnvironment: vi.fn().mockResolvedValue([]),
}));

vi.mock('@wdio/native-utils', () => ({
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

vi.mock('../src/portManager.js', () => ({
  PortManager: class MockPortManager {
    allocatePortPair = vi.fn().mockResolvedValue({ port: 4444, nativePort: 4445 });
    allocatePorts = vi.fn().mockResolvedValue([
      { port: 4444, nativePort: 4445 },
      { port: 4446, nativePort: 4447 },
    ]);
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

vi.mock('../src/commands/triggerDeeplink.js', () => ({
  setEmbeddedModeInfo: vi.fn(),
  setCrabnebulaModeInfo: vi.fn(),
}));

vi.mock('../src/crabnebulaBackend.js', () => ({
  startTestRunnerBackend: vi.fn(),
  stopTestRunnerBackend: vi.fn().mockResolvedValue(undefined),
  waitTestRunnerBackendReady: vi.fn().mockResolvedValue(undefined),
}));

import TauriLaunchService from '../src/launcher.js';

const APP_BINARY = '/workspace/target/release/my-app';

function createLauncher(): TauriLaunchService {
  return new TauriLaunchService({} as any, {} as any, { maxInstances: 1 } as any);
}

describe('TauriLaunchService — appBinaryPath resolution', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('should populate tauri:options.application from service-level appBinaryPath when no capability application is set', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const launcher = createLauncher();
    const caps: any[] = [
      {
        'wdio:tauriServiceOptions': { appBinaryPath: APP_BINARY, driverProvider: 'embedded' },
      },
    ];

    await launcher.onPrepare({ maxInstances: 1 } as any, caps);

    expect(caps[0]['tauri:options']).toBeDefined();
    expect(caps[0]['tauri:options']?.application).toBe(APP_BINARY);
  });

  it('should write back tauri:options.application on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const launcher = createLauncher();
    const caps: any[] = [
      {
        'wdio:tauriServiceOptions': { appBinaryPath: APP_BINARY, driverProvider: 'embedded' },
      },
    ];

    await launcher.onPrepare({ maxInstances: 1 } as any, caps);

    expect(caps[0]['tauri:options']?.application).toBe(APP_BINARY);
  });

  it('should resolve appBinaryPath for every multiremote capability on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const launcher = createLauncher();
    const capabilities: any = {
      instanceA: {
        capabilities: { 'wdio:tauriServiceOptions': { appBinaryPath: '/bin/app-a', driverProvider: 'embedded' } },
      },
      instanceB: {
        capabilities: { 'wdio:tauriServiceOptions': { appBinaryPath: '/bin/app-b', driverProvider: 'embedded' } },
      },
    };

    await launcher.onPrepare({ maxInstances: 1 } as any, capabilities);

    // Windows runs an extra Edge-driver step; guard that it doesn't stop
    // per-capability resolution before instances 2..N.
    expect(capabilities.instanceA.capabilities['tauri:options']?.application).toBe('/bin/app-a');
    expect(capabilities.instanceB.capabilities['tauri:options']?.application).toBe('/bin/app-b');
  });

  it('should prefer capability-level application over service-level appBinaryPath', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const launcher = createLauncher();
    const caps: any[] = [
      {
        'tauri:options': { application: '/cap/level/binary' },
        'wdio:tauriServiceOptions': { appBinaryPath: '/service/level/binary', driverProvider: 'embedded' },
      },
    ];

    await launcher.onPrepare({ maxInstances: 1 } as any, caps);

    expect(caps[0]['tauri:options']?.application).toBe('/cap/level/binary');
  });
});
