import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeBrowser } from './helpers.js';

const { remoteMock } = vi.hoisted(() => ({ remoteMock: vi.fn() }));

vi.mock('webdriverio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('webdriverio')>()),
  remote: remoteMock,
}));

vi.mock('@wdio/native-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-utils')>()),
  createLogger: vi.fn(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() })),
}));

import { cleanup, init } from '../../src/session.js';
import type { TauriCapabilities } from '../../src/types.js';

const DEV_SERVER = 'http://localhost:1420';

function createSessionBrowser() {
  return Object.assign(createFakeBrowser({ isBidi: true }), {
    sessionId: 'chrome-session',
    isMultiremote: false,
    deleteSession: vi.fn().mockResolvedValue(undefined),
  });
}

describe('standalone init() in browser mode', () => {
  let closeDevServer: ReturnType<typeof vi.fn>;
  let devServer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    remoteMock.mockReset();
    // The managed dev server's readiness poll probes devServerUrl with fetch.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    closeDevServer = vi.fn().mockResolvedValue(undefined);
    devServer = vi.fn().mockResolvedValue({ url: DEV_SERVER, close: closeDevServer });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function browserModeCapabilities(): TauriCapabilities {
    return { 'wdio:tauriServiceOptions': { mode: 'browser', devServer } } as unknown as TauriCapabilities;
  }

  it('should open a Chrome session without a driver port and load the managed dev server', async () => {
    const sessionBrowser = createSessionBrowser();
    const initialUrl = sessionBrowser.url;
    remoteMock.mockResolvedValue(sessionBrowser);

    const browser = await init(browserModeCapabilities());

    expect(devServer).toHaveBeenCalledOnce();
    expect(remoteMock).toHaveBeenCalledOnce();
    const [options] = remoteMock.mock.calls[0];
    expect(options).not.toHaveProperty('port');
    expect(options).not.toHaveProperty('hostname');
    expect(options.capabilities).toMatchObject({ browserName: 'chrome' });
    expect(initialUrl).toHaveBeenCalledWith(DEV_SERVER);

    await cleanup(browser);
  });

  it("should leave the caller's capabilities untouched by the launcher's browser-mode rewrite", async () => {
    remoteMock.mockResolvedValue(createSessionBrowser());
    const capabilities = {
      'tauri:options': { application: '/app' },
      'wdio:tauriServiceOptions': { mode: 'browser', devServer },
    } as unknown as TauriCapabilities;

    const browser = await init(capabilities);

    expect(remoteMock.mock.calls[0][0].capabilities).toMatchObject({ browserName: 'chrome' });
    expect(remoteMock.mock.calls[0][0].capabilities).not.toHaveProperty('tauri:options');
    expect(capabilities).toEqual({
      'tauri:options': { application: '/app' },
      'wdio:tauriServiceOptions': { mode: 'browser', devServer },
    });

    await cleanup(browser);
  });

  it('should open a Chrome session when mode comes from the global options', async () => {
    remoteMock.mockResolvedValue(createSessionBrowser());

    const browser = await init({} as TauriCapabilities, { mode: 'browser', devServer });

    expect(remoteMock).toHaveBeenCalledOnce();
    expect(remoteMock.mock.calls[0][0]).not.toHaveProperty('port');
    expect(remoteMock.mock.calls[0][0].capabilities).toMatchObject({ browserName: 'chrome' });

    await cleanup(browser);
    expect(closeDevServer).toHaveBeenCalledOnce();
  });

  it('should delete the session and stop the managed dev server on cleanup', async () => {
    const sessionBrowser = createSessionBrowser();
    remoteMock.mockResolvedValue(sessionBrowser);
    const browser = await init(browserModeCapabilities());
    expect(closeDevServer).not.toHaveBeenCalled();

    await cleanup(browser);

    expect(sessionBrowser.deleteSession).toHaveBeenCalledOnce();
    expect(closeDevServer).toHaveBeenCalledOnce();
  });

  it('should stop the managed dev server when the browser session fails to start', async () => {
    const error = new Error('chromedriver failed to start');
    remoteMock.mockRejectedValueOnce(error);

    await expect(init(browserModeCapabilities())).rejects.toBe(error);
    expect(closeDevServer).toHaveBeenCalledOnce();
  });
});
