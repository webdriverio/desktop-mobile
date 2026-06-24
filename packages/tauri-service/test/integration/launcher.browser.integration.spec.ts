import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeBrowser } from './helpers.js';

// Native-mode setup modules — none should be touched when mode is 'browser'.
vi.mock('../../src/embeddedProvider.js', () => ({
  checkEmbeddedServerAlive: vi.fn(),
  startEmbeddedDriver: vi.fn(),
  stopEmbeddedDriver: vi.fn(),
  getEmbeddedPort: vi.fn().mockReturnValue(4445),
  isEmbeddedProvider: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/diagnostics.js', () => ({
  diagnoseTauriEnvironment: vi.fn().mockResolvedValue([]),
}));

// Keep @wdio/native-utils real — the worker's before() drives the real
// installMockSyncOverride; only silence the logger.
vi.mock('@wdio/native-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-utils')>()),
  createLogger: vi.fn(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() })),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('../../src/driverPool.js', () => ({
  DriverPool: class MockDriverPool {
    startDriver = vi.fn();
    stopDriver = vi.fn().mockResolvedValue(undefined);
    stopAll = vi.fn().mockResolvedValue(undefined);
    getStatus = vi.fn().mockReturnValue({ count: 0, running: false });
    getRunningPids = vi.fn().mockReturnValue([]);
  },
}));

vi.mock('../../src/portManager.js', () => ({
  PortManager: class MockPortManager {
    allocatePortPair = vi.fn().mockResolvedValue({ port: 4444, nativePort: 4445 });
    allocatePorts = vi.fn().mockResolvedValue([{ port: 4444, nativePort: 4445 }]);
    allocatePort = vi.fn().mockResolvedValue(4444);
    clear = vi.fn();
  },
}));

vi.mock('../../src/pathResolver.js', () => ({
  getWebKitWebDriverPath: vi.fn().mockReturnValue('/usr/bin/WebKitWebDriver'),
}));

vi.mock('../../src/driverManager.js', () => ({
  ensureTauriDriver: vi.fn().mockResolvedValue({ ok: true, value: { path: '/tauri-driver', method: 'found' } }),
  findTestRunnerBackend: vi.fn(),
}));

vi.mock('../../src/edgeDriverManager.js', () => ({
  ensureMsEdgeDriver: vi.fn().mockResolvedValue({ ok: true, value: { method: 'found', driverVersion: '120' } }),
}));

vi.mock('../../src/commands/triggerDeeplink.js', () => ({
  setEmbeddedModeInfo: vi.fn(),
  setCrabnebulaModeInfo: vi.fn(),
  triggerDeeplink: vi.fn(),
}));

vi.mock('../../src/crabnebulaBackend.js', () => ({
  startTestRunnerBackend: vi.fn(),
  stopTestRunnerBackend: vi.fn().mockResolvedValue(undefined),
  waitTestRunnerBackendReady: vi.fn().mockResolvedValue(undefined),
}));

import { ensureTauriDriver } from '../../src/driverManager.js';
import { ensureMsEdgeDriver } from '../../src/edgeDriverManager.js';
import TauriLaunchService from '../../src/launcher.js';
import mockStore from '../../src/mockStore.js';
import TauriWorkerService from '../../src/service.js';

const DEV_SERVER = 'http://localhost:1420';

function createLauncher(globalOpts: Record<string, unknown> = {}): TauriLaunchService {
  return new TauriLaunchService(globalOpts as never, {} as never, { maxInstances: 1 } as never);
}

describe('launcher → worker handshake (browser mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.clear();
  });

  it('should transform the Tauri capability into a Chrome capability and remove tauri:options', async () => {
    const launcher = createLauncher();
    const caps: Array<Record<string, unknown>> = [
      {
        browserName: 'tauri',
        'tauri:options': { application: '/app/my-app' },
        'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER },
      },
    ];

    await launcher.onPrepare({} as never, caps as never);

    expect(caps[0].browserName).toBe('chrome');
    expect(caps[0]['tauri:options']).toBeUndefined();
  });

  it('should not spawn tauri-driver or msedgedriver in onPrepare', async () => {
    const launcher = createLauncher();
    const caps: Array<Record<string, unknown>> = [
      { 'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
    ];

    await launcher.onPrepare({} as never, caps as never);

    expect(ensureTauriDriver).not.toHaveBeenCalled();
    expect(ensureMsEdgeDriver).not.toHaveBeenCalled();
  });

  it('should propagate the launcher devServerUrl into the worker initial navigation', async () => {
    const launcher = createLauncher();
    const caps: Array<Record<string, unknown>> = [
      {
        browserName: 'tauri',
        'tauri:options': { application: '/app/my-app' },
        'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER },
      },
    ];
    await launcher.onPrepare({} as never, caps as never);

    // The worker is built from the transformed capability; the surviving
    // wdio:tauriServiceOptions still carries mode + devServerUrl.
    const worker = new TauriWorkerService({} as never, caps[0] as never);
    const browser = createFakeBrowser();
    // initBrowserMode calls browser.url(devServerUrl) before patchBrowserUrl
    // replaces browser.url — capture the spy before the patch.
    const urlSpy = browser.url;
    await worker.before({} as never, [], browser as unknown as WebdriverIO.Browser);

    expect(urlSpy).toHaveBeenCalledWith(DEV_SERVER);
    expect((browser as unknown as Record<string, boolean>).__wdioBrowserMode__).toBe(true);
  });

  it('should enter browser mode in the worker without any driver involvement', async () => {
    const launcher = createLauncher();
    const caps: Array<Record<string, unknown>> = [
      { browserName: 'tauri', 'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
    ];
    await launcher.onPrepare({} as never, caps as never);

    const worker = new TauriWorkerService({} as never, caps[0] as never);
    const browser = createFakeBrowser();
    await worker.before({} as never, [], browser as unknown as WebdriverIO.Browser);

    expect((browser as unknown as { tauri?: unknown }).tauri).toBeDefined();
    expect(browser.overrides.has('url')).toBe(true);
    expect(ensureTauriDriver).not.toHaveBeenCalled();
    expect(ensureMsEdgeDriver).not.toHaveBeenCalled();
  });

  it('should accept devServerUrl via service-level global options', async () => {
    const launcher = createLauncher({ mode: 'browser', devServerUrl: DEV_SERVER });
    const caps: Array<Record<string, unknown>> = [{}];
    await launcher.onPrepare({} as never, caps as never);

    expect(caps[0].browserName).toBe('chrome');

    const worker = new TauriWorkerService({ mode: 'browser', devServerUrl: DEV_SERVER } as never, caps[0] as never);
    const browser = createFakeBrowser();
    const urlSpy = browser.url;
    await worker.before({} as never, [], browser as unknown as WebdriverIO.Browser);

    expect(urlSpy).toHaveBeenCalledWith(DEV_SERVER);
  });
});
