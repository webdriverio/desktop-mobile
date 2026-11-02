import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeBrowser, createFakeMultiremoteBrowser } from './helpers.js';

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

vi.mock('@wdio/native-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-core')>()),
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
  triggerDeeplink: vi.fn(),
}));

vi.mock('../../src/crabnebulaBackend.js', () => ({
  startTestRunnerBackend: vi.fn(),
  stopTestRunnerBackend: vi.fn().mockResolvedValue(undefined),
  waitTestRunnerBackendReady: vi.fn().mockResolvedValue(undefined),
}));

import { SevereServiceError } from 'webdriverio';
import { ensureTauriDriver } from '../../src/driverManager.js';
import { ensureMsEdgeDriver } from '../../src/edgeDriverManager.js';
import TauriLaunchService from '../../src/launcher.js';
import mockStore from '../../src/mockStore.js';
import TauriWorkerService from '../../src/service.js';

const DEV_SERVER = 'http://localhost:1420';
const OTHER_DEV_SERVER = 'http://localhost:1421';

function createLauncher(globalOpts: Record<string, unknown> = {}): TauriLaunchService {
  return new TauriLaunchService(globalOpts as never, {} as never, { maxInstances: 1 } as never);
}

describe('launcher → worker handshake (browser mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.clear();
    // Launcher onPrepare now preflights the dev server; stub it as reachable.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('should reject multiremote capabilities that mix native and browser modes', async () => {
    const launcher = createLauncher();
    const caps = {
      browserA: { capabilities: { 'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } } },
      browserB: { capabilities: {} },
    };

    const error = await launcher.onPrepare({} as never, caps as never).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SevereServiceError);
    expect(error).toMatchObject({
      message: expect.stringContaining(
        'All Tauri capabilities must use the same mode, but found mixed modes: browser, native',
      ),
    });
    expect(launcher.isBrowserMode).toBe(false);
    expect(caps.browserB.capabilities).toEqual({});
  });

  it('should navigate each multiremote instance to its own devServerUrl', async () => {
    const launcher = createLauncher({ mode: 'browser', devServerUrl: DEV_SERVER });
    const caps = {
      browserA: { capabilities: { 'wdio:tauriServiceOptions': { devServerUrl: OTHER_DEV_SERVER } } },
      browserB: { capabilities: {} },
    };
    await launcher.onPrepare({} as never, caps as never);

    // Built without service options, so each instance's URL can only come from its own capability.
    const worker = new TauriWorkerService({} as never, caps as never);
    const { root, instances } = createFakeMultiremoteBrowser(['browserA', 'browserB']);
    const rootUrl = root.url;
    await worker.before(caps as never, [], root as unknown as WebdriverIO.Browser);

    expect(instances.get('browserA')?.url).toHaveBeenCalledExactlyOnceWith(OTHER_DEV_SERVER);
    expect(instances.get('browserB')?.url).toHaveBeenCalledExactlyOnceWith(DEV_SERVER);
    expect(rootUrl).not.toHaveBeenCalled();
    expect(instances.get('browserA')?.tauri).toBeDefined();
    expect(instances.get('browserB')?.tauri).toBeDefined();
  });

  it('should name the multiremote instance that has no devServerUrl', async () => {
    const caps = {
      browserA: { capabilities: { 'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } } },
      browserB: { capabilities: { 'wdio:tauriServiceOptions': { mode: 'browser' } } },
    };
    const worker = new TauriWorkerService({} as never, caps as never);
    const { root } = createFakeMultiremoteBrowser(['browserA', 'browserB']);

    await expect(worker.before(caps as never, [], root as unknown as WebdriverIO.Browser)).rejects.toMatchObject({
      message: 'devServerUrl is required for browser mode but was not set for multiremote instance "browserB"',
    });
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
