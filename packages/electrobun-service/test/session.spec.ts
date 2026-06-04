import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const onPrepareMock = vi.fn().mockResolvedValue(undefined);
const onWorkerStartMock = vi.fn().mockResolvedValue(undefined);
const onCompleteMock = vi.fn().mockResolvedValue(undefined);
const serviceBeforeMock = vi.fn().mockResolvedValue(undefined);
const serviceAfterMock = vi.fn().mockResolvedValue(undefined);
const serviceAfterSessionMock = vi.fn().mockResolvedValue(undefined);
const remoteMock = vi.fn();
const deleteSessionMock = vi.fn().mockResolvedValue(undefined);
const serviceCtorArgs: unknown[][] = [];

vi.mock('../src/launcher.js', () => ({
  default: class {
    onPrepare = onPrepareMock;
    onWorkerStart = onWorkerStartMock;
    onComplete = onCompleteMock;
  },
}));

vi.mock('../src/service.js', () => ({
  default: class {
    before = serviceBeforeMock;
    after = serviceAfterMock;
    afterSession = serviceAfterSessionMock;
    constructor(...args: unknown[]) {
      serviceCtorArgs.push(args);
    }
  },
}));

vi.mock('webdriverio', () => ({
  remote: (...args: unknown[]) => remoteMock(...args),
}));

import { cleanup, createElectrobunCapabilities, init } from '../src/session.js';

function makeBrowser(): WebdriverIO.Browser {
  return { sessionId: 'sess-1', deleteSession: deleteSessionMock } as unknown as WebdriverIO.Browser;
}

describe('session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceCtorArgs.length = 0;
    onPrepareMock.mockResolvedValue(undefined);
    onWorkerStartMock.mockResolvedValue(undefined);
    onCompleteMock.mockResolvedValue(undefined);
    serviceBeforeMock.mockResolvedValue(undefined);
    remoteMock.mockResolvedValue(makeBrowser());
    deleteSessionMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createElectrobunCapabilities', () => {
    it('should build a capability with the electrobun browserName and service options', () => {
      const cap = createElectrobunCapabilities({ appBinaryPath: '/apps/Demo.app' });

      expect(cap.browserName).toBe('electrobun');
      expect(cap['wdio:electrobunServiceOptions']).toMatchObject({ appBinaryPath: '/apps/Demo.app' });
    });

    it('should throw when appBinaryPath is missing in native mode', () => {
      expect(() => createElectrobunCapabilities({})).toThrow(/appBinaryPath is required/);
    });

    it('should not require appBinaryPath in browser mode', () => {
      expect(() =>
        createElectrobunCapabilities({ mode: 'browser', devServerUrl: 'http://localhost:3000' }),
      ).not.toThrow();
    });
  });

  describe('init', () => {
    it('should drive onPrepare + onWorkerStart, open the session, and run service.before', async () => {
      const cap = createElectrobunCapabilities({ appBinaryPath: '/apps/Demo.app' });

      const browser = await init(cap);

      expect(onPrepareMock).toHaveBeenCalledTimes(1);
      expect(onWorkerStartMock).toHaveBeenCalledTimes(1);
      expect(remoteMock).toHaveBeenCalledTimes(1);
      expect(serviceBeforeMock).toHaveBeenCalledTimes(1);
      expect(browser).toBeDefined();
    });

    it('should call launcher.onComplete when remote() fails', async () => {
      remoteMock.mockRejectedValueOnce(new Error('chromedriver missing'));
      const cap = createElectrobunCapabilities({ appBinaryPath: '/apps/Demo.app' });

      await expect(init(cap)).rejects.toThrow(/chromedriver missing/);
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });

    it('should tear down the session and call onComplete when service.before fails', async () => {
      serviceBeforeMock.mockRejectedValueOnce(new Error('attach failed'));
      const cap = createElectrobunCapabilities({ appBinaryPath: '/apps/Demo.app' });

      await expect(init(cap)).rejects.toThrow(/attach failed/);
      expect(deleteSessionMock).toHaveBeenCalledTimes(1);
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('init option merging', () => {
    it('should merge globalOptions into the worker service options (capability wins)', async () => {
      const cap = createElectrobunCapabilities({ appBinaryPath: '/apps/Demo.app' });

      await init(cap, { cdpConnectionTimeout: 5000 });

      expect(serviceCtorArgs[0]?.[0]).toMatchObject({
        cdpConnectionTimeout: 5000,
        appBinaryPath: '/apps/Demo.app',
      });
    });
  });

  describe('cleanup', () => {
    it('should run service teardown, delete the session, and call onComplete', async () => {
      const cap = createElectrobunCapabilities({ appBinaryPath: '/apps/Demo.app' });
      const browser = await init(cap);

      await cleanup(browser);

      expect(serviceAfterMock).toHaveBeenCalledTimes(1);
      // after() is the whole teardown — afterSession() would only re-run the
      // same closeBridges() against already-cleared state.
      expect(serviceAfterSessionMock).not.toHaveBeenCalled();
      expect(deleteSessionMock).toHaveBeenCalledTimes(1);
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });

    it('should resolve when launcher.onComplete rejects (best-effort teardown)', async () => {
      const cap = createElectrobunCapabilities({ appBinaryPath: '/apps/Demo.app' });
      const browser = await init(cap);
      onCompleteMock.mockRejectedValueOnce(new Error('teardown boom'));

      await expect(cleanup(browser)).resolves.toBeUndefined();
    });

    it('should warn and no-op when the browser was not created by init()', async () => {
      const stray = makeBrowser();

      await expect(cleanup(stray)).resolves.toBeUndefined();
      expect(onCompleteMock).not.toHaveBeenCalled();
    });
  });
});
