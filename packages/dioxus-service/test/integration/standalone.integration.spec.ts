import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeBrowser } from './helpers.js';

const { remoteMock } = vi.hoisted(() => ({ remoteMock: vi.fn() }));

vi.mock('webdriverio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('webdriverio')>()),
  remote: remoteMock,
}));

vi.mock('../../src/providers/embedded.js', () => ({
  getEmbeddedPort: vi.fn().mockReturnValue(4444),
  startEmbeddedDriver: vi.fn(),
  stopEmbeddedDriver: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@wdio/native-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-utils')>()),
  createLogger: vi.fn(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() })),
}));

import { SevereServiceError } from 'webdriverio';
import { startEmbeddedDriver } from '../../src/providers/embedded.js';
import { cleanup, init } from '../../src/session.js';
import type { DioxusCapabilities } from '../../src/types.js';

const DEV_SERVER = 'http://localhost:8080';

function createSessionBrowser() {
  return Object.assign(createFakeBrowser(), {
    sessionId: 'chrome-session',
    deleteSession: vi.fn().mockResolvedValue(undefined),
  });
}

describe('standalone init()', () => {
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

  describe('in browser mode', () => {
    function browserModeCapabilities(): DioxusCapabilities {
      return {
        browserName: 'dioxus',
        'wdio:dioxusServiceOptions': { mode: 'browser', devServer },
      } as DioxusCapabilities;
    }

    it('should open a Chrome session without a driver port and load the managed dev server', async () => {
      const sessionBrowser = createSessionBrowser();
      const initialUrl = sessionBrowser.url;
      remoteMock.mockResolvedValue(sessionBrowser);

      const browser = await init(browserModeCapabilities());

      expect(devServer).toHaveBeenCalledOnce();
      expect(startEmbeddedDriver).not.toHaveBeenCalled();
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
      const capabilities = browserModeCapabilities();

      const browser = await init(capabilities);

      expect(remoteMock.mock.calls[0][0].capabilities).toMatchObject({
        browserName: 'chrome',
        'wdio:dioxusServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER },
      });
      expect(capabilities).toEqual(browserModeCapabilities());

      await cleanup(browser);
    });

    it('should open a Chrome session when mode comes from the global options', async () => {
      remoteMock.mockResolvedValue(createSessionBrowser());

      const browser = await init({} as DioxusCapabilities, { mode: 'browser', devServer });

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

  describe('with the embedded driver', () => {
    it("should send a global windowLabel to the driver without changing the caller's capabilities", async () => {
      remoteMock.mockResolvedValue(createSessionBrowser());
      const capabilities = { 'dioxus:options': { application: '/app/dioxus-app' } } as DioxusCapabilities;

      const browser = await init(capabilities, { windowLabel: 'window-1' });
      await cleanup(browser);

      expect(remoteMock.mock.calls[0][0].capabilities).toMatchObject({
        'wdio:dioxusServiceOptions': { windowLabel: 'window-1' },
      });
      expect(capabilities).not.toHaveProperty('wdio:dioxusServiceOptions');
    });
  });

  describe("with driverProvider: 'external'", () => {
    it('should reject with the unsupported-provider error before starting a driver or dev server', async () => {
      const capabilities = {
        'dioxus:options': { application: '/app/dioxus-app' },
        'wdio:dioxusServiceOptions': { driverProvider: 'external', devServer },
      } as DioxusCapabilities;

      const error = await init(capabilities).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SevereServiceError);
      expect(error).toMatchObject({ message: expect.stringContaining("driverProvider: 'external' is not supported") });
      expect(startEmbeddedDriver).not.toHaveBeenCalled();
      expect(devServer).not.toHaveBeenCalled();
      expect(remoteMock).not.toHaveBeenCalled();
    });
  });
});
