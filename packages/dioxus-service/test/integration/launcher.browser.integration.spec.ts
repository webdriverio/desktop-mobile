import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeBrowser, createFakeMultiremoteBrowser } from './helpers.js';

// Embedded-driver setup — none of these should run when mode is 'browser'.
vi.mock('../../src/providers/embedded.js', () => ({
  getEmbeddedPort: vi.fn().mockReturnValue(4444),
  startEmbeddedDriver: vi.fn().mockResolvedValue({ proc: { pid: 1234, kill: vi.fn() }, logHandlers: [] }),
  stopEmbeddedDriver: vi.fn().mockResolvedValue(undefined),
  DEFAULT_EMBEDDED_PORT: 4444,
  EMBEDDED_PORT_ENV_VAR: 'WDIO_EMBEDDED_PORT',
}));

vi.mock('@wdio/native-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-utils')>()),
  createLogger: vi.fn(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() })),
}));

import { SevereServiceError } from 'webdriverio';
import DioxusLaunchService from '../../src/launcher.js';
import { startEmbeddedDriver } from '../../src/providers/embedded.js';
import DioxusWorkerService from '../../src/service.js';
import type { DioxusCapabilities, DioxusServiceGlobalOptions } from '../../src/types.js';

const DEV_SERVER = 'http://localhost:8080';
const OTHER_DEV_SERVER = 'http://localhost:8081';
const baseConfig = {} as Parameters<DioxusLaunchService['onPrepare']>[0];

function createLauncher(globalOpts: Partial<DioxusServiceGlobalOptions> = {}): DioxusLaunchService {
  return new DioxusLaunchService(globalOpts as DioxusServiceGlobalOptions, {} as DioxusCapabilities, baseConfig);
}

describe('launcher → worker handshake (browser mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // onPrepare now preflights the dev server with a fetch HEAD probe (#490); stub it reachable so
    // the happy-path handshake tests don't hit a real (absent) server. Error-path tests below throw
    // before the probe and are unaffected.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should transform the Dioxus capability into a Chrome capability and remove dioxus:options', async () => {
    const launcher = createLauncher();
    const caps: Array<Record<string, unknown>> = [
      {
        browserName: 'dioxus',
        'dioxus:options': { application: '/app/my-app' },
        'wdio:dioxusServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER },
      },
    ];

    await launcher.onPrepare(baseConfig, caps as never);

    expect(caps[0].browserName).toBe('chrome');
    expect(caps[0]['dioxus:options']).toBeUndefined();
  });

  it('should not spawn the embedded driver in onPrepare', async () => {
    const launcher = createLauncher();
    const caps: Array<Record<string, unknown>> = [
      { 'wdio:dioxusServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
    ];

    await launcher.onPrepare(baseConfig, caps as never);

    expect(startEmbeddedDriver).not.toHaveBeenCalled();
  });

  it('should reject capabilities that mix native and browser modes', async () => {
    const launcher = createLauncher();
    const caps: Array<Record<string, unknown>> = [
      { 'wdio:dioxusServiceOptions': {} },
      { 'wdio:dioxusServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
    ];

    const error = await launcher.onPrepare(baseConfig, caps as never).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SevereServiceError);
    expect(error).toMatchObject({
      message: expect.stringContaining(
        'All Dioxus capabilities must use the same mode, but found mixed modes: native, browser',
      ),
    });
    expect(caps[0].browserName).toBeUndefined();
    expect(startEmbeddedDriver).not.toHaveBeenCalled();
  });

  it('should throw a SevereServiceError when devServerUrl is missing', async () => {
    const launcher = createLauncher();
    const caps: Array<Record<string, unknown>> = [{ 'wdio:dioxusServiceOptions': { mode: 'browser' } }];

    await expect(launcher.onPrepare(baseConfig, caps as never)).rejects.toThrow(/devServerUrl is required/);
  });

  it('should throw a SevereServiceError when devServerUrl is not a valid URL', async () => {
    const launcher = createLauncher();
    const caps: Array<Record<string, unknown>> = [
      { 'wdio:dioxusServiceOptions': { mode: 'browser', devServerUrl: 'not-a-url' } },
    ];

    await expect(launcher.onPrepare(baseConfig, caps as never)).rejects.toThrow(/not a valid URL/);
  });

  it('should propagate the launcher devServerUrl into the worker initial navigation', async () => {
    const launcher = createLauncher();
    const caps: Array<Record<string, unknown>> = [
      {
        browserName: 'dioxus',
        'dioxus:options': { application: '/app/my-app' },
        'wdio:dioxusServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER },
      },
    ];
    await launcher.onPrepare(baseConfig, caps as never);

    // The worker is built from the transformed capability; the surviving
    // wdio:dioxusServiceOptions still carries mode + devServerUrl.
    const worker = new DioxusWorkerService({}, caps[0] as never);
    const browser = createFakeBrowser();
    // initBrowserMode calls browser.url(devServerUrl) before the url override
    // replaces browser.url — capture the spy before the patch.
    const urlSpy = browser.url;
    await worker.before({}, [], browser as unknown as WebdriverIO.Browser);

    expect(urlSpy).toHaveBeenCalledWith(DEV_SERVER);
  });

  it('should enter browser mode in the worker without any driver involvement', async () => {
    const launcher = createLauncher();
    const caps: Array<Record<string, unknown>> = [
      { browserName: 'dioxus', 'wdio:dioxusServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
    ];
    await launcher.onPrepare(baseConfig, caps as never);

    const worker = new DioxusWorkerService({}, caps[0] as never);
    const browser = createFakeBrowser();
    await worker.before({}, [], browser as unknown as WebdriverIO.Browser);

    expect((browser as unknown as { dioxus?: unknown }).dioxus).toBeDefined();
    expect(browser.overrides.has('url')).toBe(true);
    expect(startEmbeddedDriver).not.toHaveBeenCalled();
  });

  it('should navigate each multiremote instance to its own devServerUrl', async () => {
    const launcher = createLauncher({ mode: 'browser', devServerUrl: DEV_SERVER });
    const caps = {
      browserA: { capabilities: { 'wdio:dioxusServiceOptions': { devServerUrl: OTHER_DEV_SERVER } } },
      browserB: { capabilities: {} },
    };
    await launcher.onPrepare(baseConfig, caps as never);

    // Built without service options, so each instance's URL can only come from its own capability.
    const worker = new DioxusWorkerService({}, caps as never);
    const { root, instances } = createFakeMultiremoteBrowser(['browserA', 'browserB']);
    const rootUrl = root.url;
    await worker.before({}, [], root as unknown as WebdriverIO.Browser);

    expect(instances.get('browserA')?.url).toHaveBeenCalledExactlyOnceWith(OTHER_DEV_SERVER);
    expect(instances.get('browserB')?.url).toHaveBeenCalledExactlyOnceWith(DEV_SERVER);
    expect(rootUrl).not.toHaveBeenCalled();
    for (const instance of instances.values()) {
      expect(instance.execute.mock.calls.some(([script]) => String(script).includes('__wdio_original_invoke__'))).toBe(
        true,
      );
    }
    expect(instances.get('browserA')?.dioxus).toHaveProperty('execute');
    expect(instances.get('browserB')?.dioxus).toHaveProperty('execute');
  });

  it('should accept devServerUrl via service-level global options', async () => {
    const launcher = createLauncher({ mode: 'browser', devServerUrl: DEV_SERVER });
    const caps: Array<Record<string, unknown>> = [{}];
    await launcher.onPrepare(baseConfig, caps as never);

    expect(caps[0].browserName).toBe('chrome');

    const worker = new DioxusWorkerService({ mode: 'browser', devServerUrl: DEV_SERVER }, caps[0] as never);
    const browser = createFakeBrowser();
    const urlSpy = browser.url;
    await worker.before({}, [], browser as unknown as WebdriverIO.Browser);

    expect(urlSpy).toHaveBeenCalledWith(DEV_SERVER);
  });
});
