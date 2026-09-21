import { DEFAULT_TEARDOWN_TIMEOUT_MS } from '@wdio/native-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const onPrepareMock = vi.fn().mockResolvedValue(undefined);
const onCompleteMock = vi.fn().mockResolvedValue(undefined);
const serviceBeforeMock = vi.fn().mockResolvedValue(undefined);
const serviceAfterMock = vi.fn().mockResolvedValue(undefined);
const serviceAfterSessionMock = vi.fn().mockResolvedValue(undefined);
const remoteMock = vi.fn();
const deleteSessionMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/launcher.js', () => ({
  default: class {
    onPrepare = onPrepareMock;
    onComplete = onCompleteMock;
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
        await vi.advanceTimersByTimeAsync(DEFAULT_TEARDOWN_TIMEOUT_MS + 1_000);
        await expect(cleanupPromise).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
      expect(serviceAfterMock).toHaveBeenCalledTimes(1);
    });
  });
});
