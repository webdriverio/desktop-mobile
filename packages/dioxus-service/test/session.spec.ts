import { DEFAULT_TEARDOWN_TIMEOUT_MS, PROCESS_TEARDOWN_TIMEOUT_MS } from '@wdio/native-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const onPrepareMock = vi.fn().mockResolvedValue(undefined);
const onCompleteMock = vi.fn().mockResolvedValue(undefined);
const serviceBeforeMock = vi.fn().mockResolvedValue(undefined);
const serviceAfterMock = vi.fn().mockResolvedValue(undefined);
const serviceAfterSessionMock = vi.fn().mockResolvedValue(undefined);
const remoteMock = vi.fn();
const deleteSessionMock = vi.fn().mockResolvedValue(undefined);
const launcherState = { isBrowserMode: false };

vi.mock('../src/launcher.js', () => ({
  default: class {
    onPrepare = onPrepareMock;
    onComplete = onCompleteMock;
    get isBrowserMode() {
      return launcherState.isBrowserMode;
    }
  },
}));

vi.mock('../src/service.js', () => ({
  default: class {
    before = serviceBeforeMock;
    after = serviceAfterMock;
    afterSession = serviceAfterSessionMock;
  },
}));

vi.mock('webdriverio', () => ({
  remote: (...args: unknown[]) => remoteMock(...args),
}));

import { cleanup, init } from '../src/session.js';
import type { DioxusCapabilities } from '../src/types.js';

function makeBrowser(): WebdriverIO.Browser {
  return { sessionId: 'sess-1', deleteSession: deleteSessionMock } as unknown as WebdriverIO.Browser;
}

// port/hostname are normally set on the capability by launcher.onPrepare; the mock launcher is a
// no-op, so pre-set them here to let init() proceed past its port check.
function makeCaps(): DioxusCapabilities {
  return {
    browserName: 'dioxus',
    port: 9515,
    hostname: '127.0.0.1',
    'dioxus:options': { application: '/app/dioxus-app' },
    'wdio:dioxusServiceOptions': { appBinaryPath: '/app/dioxus-app' },
  } as unknown as DioxusCapabilities;
}

describe('session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onPrepareMock.mockResolvedValue(undefined);
    onCompleteMock.mockResolvedValue(undefined);
    serviceBeforeMock.mockResolvedValue(undefined);
    serviceAfterMock.mockResolvedValue(undefined);
    serviceAfterSessionMock.mockResolvedValue(undefined);
    remoteMock.mockResolvedValue(makeBrowser());
    deleteSessionMock.mockResolvedValue(undefined);
    launcherState.isBrowserMode = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('init', () => {
    it('should drive onPrepare, open the session, and run service.before', async () => {
      const browser = await init(makeCaps());

      expect(onPrepareMock).toHaveBeenCalledTimes(1);
      expect(remoteMock).toHaveBeenCalledTimes(1);
      expect(serviceBeforeMock).toHaveBeenCalledTimes(1);
      expect(browser).toBeDefined();
    });

    it('should open a native session when the capability options hold a devServer function', async () => {
      const caps = makeCaps();
      caps['wdio:dioxusServiceOptions'] = {
        ...caps['wdio:dioxusServiceOptions'],
        devServer: async () => ({ url: 'http://localhost:8080', close: async () => {} }),
      };

      await init(caps);

      expect(remoteMock).toHaveBeenCalledWith(expect.objectContaining({ hostname: '127.0.0.1', port: 9515 }));
      expect(remoteMock.mock.calls[0][0].capabilities).not.toHaveProperty('port');
      expect(caps).toHaveProperty('port', 9515);
    });

    it('should stop the launcher when building the session options throws', async () => {
      const error = new Error('capability could not be read');
      onPrepareMock.mockImplementationOnce(async (_config: unknown, [caps]: [DioxusCapabilities]) => {
        Object.defineProperty(caps, 'test:unreadable', {
          enumerable: true,
          get: () => {
            throw error;
          },
        });
      });

      await expect(init(makeCaps())).rejects.toBe(error);
      expect(remoteMock).not.toHaveBeenCalled();
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });

    it("should leave the caller's capabilities untouched by the launcher's writes", async () => {
      onPrepareMock.mockImplementationOnce(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4445;
        caps.hostname = 'localhost';
        (caps['wdio:dioxusServiceOptions'] as Record<string, unknown>).embeddedPort = 4445;
      });
      const caps = makeCaps();

      await init(caps);

      expect(caps).toEqual(makeCaps());
      expect(remoteMock.mock.calls[0][0]).toMatchObject({ hostname: 'localhost', port: 4445 });
    });

    it('should stop the launcher when remote() fails', async () => {
      remoteMock.mockRejectedValueOnce(new Error('driver missing'));

      await expect(init(makeCaps())).rejects.toThrow(/driver missing/);
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });

    it('should delete the session and stop the launcher when service.before fails', async () => {
      serviceBeforeMock.mockRejectedValueOnce(new Error('bridge attach failed'));

      await expect(init(makeCaps())).rejects.toThrow(/bridge attach failed/);
      expect(deleteSessionMock).toHaveBeenCalledTimes(1);
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });

    it('should swallow a benign deleteSession error when service.before fails', async () => {
      serviceBeforeMock.mockRejectedValueOnce(new Error('bridge attach failed'));
      deleteSessionMock.mockRejectedValueOnce(new Error('invalid session id'));

      await expect(init(makeCaps())).rejects.toThrow(/bridge attach failed/);
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        'port check',
        () => {
          const caps = makeCaps();
          delete (caps as { port?: number }).port;
          return caps;
        },
        /port was not set/,
      ],
      [
        'remote()',
        () => {
          remoteMock.mockRejectedValueOnce(new Error('driver missing'));
          return makeCaps();
        },
        /driver missing/,
      ],
      [
        'service.before',
        () => {
          serviceBeforeMock.mockRejectedValueOnce(new Error('bridge attach failed'));
          return makeCaps();
        },
        /bridge attach failed/,
      ],
    ])('should surface a launcher-teardown failure alongside a %s failure', async (_stage, setup, startupMessage) => {
      const caps = setup();
      const launcherCleanup = new Error('devServer close failed');
      onCompleteMock.mockRejectedValueOnce(launcherCleanup);

      const error = await init(caps).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AggregateError);
      const aggregate = error as AggregateError;
      expect((aggregate.cause as Error).message).toMatch(startupMessage);
      expect(aggregate.errors).toEqual([aggregate.cause, launcherCleanup]);
    });
  });

  describe('browser mode', () => {
    const devServerUrl = 'http://localhost:8080';

    beforeEach(() => {
      onPrepareMock.mockImplementation(async () => {
        launcherState.isBrowserMode = true;
      });
    });

    function makeBrowserModeCaps(): DioxusCapabilities {
      return {
        browserName: 'chrome',
        'wdio:dioxusServiceOptions': { mode: 'browser', devServerUrl },
      } as DioxusCapabilities;
    }

    it('should open the session through WebdriverIO without a driver port', async () => {
      const caps = makeBrowserModeCaps();

      const browser = await init(caps);

      expect(remoteMock).toHaveBeenCalledWith({ capabilities: caps });
      expect(serviceBeforeMock).toHaveBeenCalledWith(caps, [], browser);
    });

    it('should open a browser-mode session when mode comes from the global options', async () => {
      const caps = { browserName: 'chrome' } as DioxusCapabilities;

      await init(caps, { mode: 'browser', devServerUrl });

      expect(remoteMock).toHaveBeenCalledWith({ capabilities: caps });
    });

    it("should follow the launcher's browser-mode decision", async () => {
      const caps = { browserName: 'chrome' } as DioxusCapabilities;

      await init(caps);

      expect(remoteMock).toHaveBeenCalledWith({ capabilities: caps });
    });

    it("should keep WebdriverIO's capability writes off the caller's object", async () => {
      // Mirrors what WebdriverIO does to the capabilities it starts a Chrome session with.
      remoteMock.mockImplementationOnce(async ({ capabilities: sessionCapabilities }) => {
        sessionCapabilities.webSocketUrl = true;
        sessionCapabilities.unhandledPromptBehavior = 'ignore';
        const chromedriverOptions = sessionCapabilities['wdio:chromedriverOptions'];
        chromedriverOptions.allowedOrigins = chromedriverOptions.allowedOrigins || ['*'];
        chromedriverOptions.allowedIps = chromedriverOptions.allowedIps || ['0.0.0.0'];
        sessionCapabilities['goog:chromeOptions'] = { binary: '/path/to/chrome' };
        return makeBrowser();
      });
      const makeCapsWithDriverOptions = () =>
        ({
          ...makeBrowserModeCaps(),
          'wdio:chromedriverOptions': { binary: '/path/to/chromedriver' },
        }) as DioxusCapabilities;
      const caps = makeCapsWithDriverOptions();

      await init(caps);

      expect(caps).toEqual(makeCapsWithDriverOptions());
    });

    it('should strip a user-supplied port and hostname from the browser session capabilities', async () => {
      await init({ ...makeBrowserModeCaps(), hostname: 'localhost', port: 9999 } as DioxusCapabilities);

      expect(remoteMock).toHaveBeenCalledWith({ capabilities: makeBrowserModeCaps() });
    });

    it('should stop the launcher, which stops the managed dev server, on cleanup', async () => {
      const browser = await init(makeBrowserModeCaps());
      expect(onCompleteMock).not.toHaveBeenCalled();

      await cleanup(browser);

      expect(serviceAfterSessionMock).toHaveBeenCalledTimes(1);
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });

    it('should stop the launcher when the browser session fails to start', async () => {
      const error = new Error('chromedriver failed to start');
      remoteMock.mockRejectedValueOnce(error);

      await expect(init(makeBrowserModeCaps())).rejects.toBe(error);
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('cleanup', () => {
    it('should run service teardown and stop the launcher', async () => {
      const browser = await init(makeCaps());

      await cleanup(browser);

      expect(serviceAfterMock).toHaveBeenCalledTimes(1);
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });

    it('should resolve when launcher.onComplete rejects (best-effort teardown)', async () => {
      const browser = await init(makeCaps());
      onCompleteMock.mockRejectedValueOnce(new Error('teardown boom'));

      await expect(cleanup(browser)).resolves.toBeUndefined();
    });

    it('should not hang cleanup when launcher.onComplete never settles', async () => {
      const browser = await init(makeCaps());
      onCompleteMock.mockReturnValueOnce(new Promise<void>(() => {})); // a devServer stop() that hangs

      vi.useFakeTimers();
      try {
        const cleanupPromise = cleanup(browser);
        await vi.advanceTimersByTimeAsync(PROCESS_TEARDOWN_TIMEOUT_MS + 1_000);
        await expect(cleanupPromise).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
      expect(serviceAfterMock).toHaveBeenCalledTimes(1);
    });

    it('should wait past the default teardown deadline for a slow multi-process onComplete', async () => {
      const browser = await init(makeCaps());
      let finishStop: () => void = () => {};
      onCompleteMock.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishStop = resolve;
        }),
      );

      vi.useFakeTimers();
      try {
        let settled = false;
        const pending = cleanup(browser).then(() => {
          settled = true;
        });
        await vi.advanceTimersByTimeAsync(DEFAULT_TEARDOWN_TIMEOUT_MS + 5_000);
        expect(settled).toBe(false);

        finishStop();
        await pending;
        expect(settled).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
