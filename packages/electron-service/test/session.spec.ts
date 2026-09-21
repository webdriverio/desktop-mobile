import { DEFAULT_TEARDOWN_TIMEOUT_MS } from '@wdio/native-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, createElectronCapabilities, init } from '../src/session.js';

const browserMock = { mockBrowser: true, sessionId: 'sess-1', deleteSession: vi.fn() };
const onPrepareMock = vi.fn();
const onWorkerStartMock = vi.fn();
const onCompleteMock = vi.fn();
const beforeMock = vi.fn();
const remoteMock = vi.fn();

vi.mock('../src/service.js', () => ({
  default: class MockElectronWorkerService {
    async before(...args: unknown[]) {
      return beforeMock(...args);
    }
  },
}));
vi.mock('../src/launcher.js', () => ({
  default: class MockElectronLaunchService {
    async onPrepare(...args: unknown[]) {
      onPrepareMock(...args);
    }
    async onWorkerStart(...args: unknown[]) {
      onWorkerStartMock(...args);
    }
    async onComplete(...args: unknown[]) {
      return onCompleteMock(...args);
    }
  },
}));
vi.mock('webdriverio', () => ({
  remote: (...args: unknown[]) => remoteMock(...args),
}));

const mockInitialize = vi.fn();
const mockGetLogDir = vi.fn().mockReturnValue('/mock/logs');
const mockClose = vi.fn();

vi.mock('../src/logWriter.js', () => ({
  getStandaloneLogWriter: () => ({
    initialize: mockInitialize,
    getLogDir: mockGetLogDir,
    close: mockClose,
  }),
}));

describe('Session Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    remoteMock.mockResolvedValue(browserMock);
    onCompleteMock.mockResolvedValue(undefined);
    beforeMock.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
    browserMock.deleteSession.mockResolvedValue(undefined);
  });

  describe('init()', () => {
    it('should create a new browser session', async () => {
      const session = await init({});
      expect(session).toStrictEqual(browserMock);
    });

    it('should call onPrepare with the expected parameters', async () => {
      const expectedCaps = {
        browserName: 'electron',
        browserVersion: '99.9.9',
        'wdio:electronServiceOptions': {
          appBinaryPath: '/path/to/binary',
        },
        'goog:chromeOptions': {
          args: ['--disable-dev-shm-usage', '--disable-gpu', '--headless'],
        },
        'wdio:chromedriverOptions': {
          binary: '/path/to/chromedriver',
        },
      };
      await init([expectedCaps]);
      expect(onPrepareMock).toHaveBeenCalledWith({}, [expectedCaps]);
      expect(onWorkerStartMock).toHaveBeenCalledWith('', [expectedCaps]);
    });

    it('should call onPrepare with the expected parameters when a rootDir is specified', async () => {
      await init(
        [
          {
            browserName: 'electron',
            'wdio:electronServiceOptions': { appBinaryPath: '/path/to/binary' },
          },
        ],
        {
          rootDir: '/path/to/root',
        },
      );
      expect(onPrepareMock).toHaveBeenCalledWith({ rootDir: '/path/to/root' }, [
        {
          browserName: 'electron',
          'wdio:electronServiceOptions': {
            appBinaryPath: '/path/to/binary',
          },
        },
      ]);
    });

    it('should call before with the expected parameters', async () => {
      const caps = { 'wdio:electronServiceOptions': { appBinaryPath: '/path/to/binary' } };
      await init([caps]);
      expect(beforeMock).toHaveBeenCalledWith(caps, [], browserMock);
    });

    it('should initialize log writer when captureMainProcessLogs is enabled with logDir', async () => {
      mockInitialize.mockClear();

      await init({
        browserName: 'electron',
        'wdio:electronServiceOptions': {
          appBinaryPath: '/path/to/app',
          captureMainProcessLogs: true,
          logDir: '/logs',
        },
      } as unknown as import('@wdio/native-types').ElectronServiceCapabilities);

      expect(mockInitialize).toHaveBeenCalledWith('/logs');
    });

    it('should initialize log writer when captureRendererLogs is enabled with logDir', async () => {
      mockInitialize.mockClear();

      await init({
        browserName: 'electron',
        'wdio:electronServiceOptions': {
          appBinaryPath: '/path/to/app',
          captureRendererLogs: true,
          logDir: '/logs',
        },
      } as unknown as import('@wdio/native-types').ElectronServiceCapabilities);

      expect(mockInitialize).toHaveBeenCalledWith('/logs');
    });

    it('should warn when logging enabled without logDir', async () => {
      mockInitialize.mockClear();

      await init({
        browserName: 'electron',
        'wdio:electronServiceOptions': {
          appBinaryPath: '/path/to/app',
          captureMainProcessLogs: true,
        },
      } as unknown as import('@wdio/native-types').ElectronServiceCapabilities);

      expect(mockInitialize).not.toHaveBeenCalled();
    });

    it('should close the log writer and stop the launcher when remote() fails', async () => {
      remoteMock.mockRejectedValueOnce(new Error('chromedriver missing'));
      const caps = { 'wdio:electronServiceOptions': { appBinaryPath: '/path/to/binary' } };

      await expect(init([caps])).rejects.toThrow(/chromedriver missing/);
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('should tear down the session and stop the launcher when service.before fails', async () => {
      beforeMock.mockRejectedValueOnce(new Error('bridge attach failed'));
      const caps = { 'wdio:electronServiceOptions': { appBinaryPath: '/path/to/binary' } };

      await expect(init([caps])).rejects.toThrow(/bridge attach failed/);
      expect(browserMock.deleteSession).toHaveBeenCalledTimes(1);
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('should surface both errors via AggregateError when onComplete also fails', async () => {
      remoteMock.mockRejectedValueOnce(new Error('chromedriver missing'));
      onCompleteMock.mockRejectedValueOnce(new Error('dev server stop boom'));
      const caps = { 'wdio:electronServiceOptions': { appBinaryPath: '/path/to/binary' } };

      const err = await init([caps]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AggregateError);
      expect((err as AggregateError).errors.map((e: Error) => e.message)).toEqual([
        'chromedriver missing',
        'dev server stop boom',
      ]);
      expect((err as { cause?: Error }).cause?.message).toBe('chromedriver missing');
    });
  });

  describe('cleanup()', () => {
    it('should clean up a browser session that was initialized', async () => {
      const caps = { 'wdio:electronServiceOptions': { appBinaryPath: '/path/to/binary' } };
      const browser = await init([caps]);
      await expect(cleanup(browser)).resolves.toBeUndefined();
      expect(mockClose).toHaveBeenCalled();
    });

    it('should stop the launcher (browser-mode dev server) during cleanup', async () => {
      const caps = { 'wdio:electronServiceOptions': { appBinaryPath: '/path/to/binary' } };
      const browser = await init([caps]);
      await cleanup(browser);
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });

    it('should delete the WebDriver session during cleanup', async () => {
      const caps = { 'wdio:electronServiceOptions': { appBinaryPath: '/path/to/binary' } };
      const browser = await init([caps]);
      await cleanup(browser);
      expect(browserMock.deleteSession).toHaveBeenCalledTimes(1);
    });

    it('should swallow a benign deleteSession error during cleanup', async () => {
      const caps = { 'wdio:electronServiceOptions': { appBinaryPath: '/path/to/binary' } };
      const browser = await init([caps]);
      browserMock.deleteSession.mockRejectedValueOnce(new Error('invalid session id'));
      await expect(cleanup(browser)).resolves.toBeUndefined();
      expect(mockClose).toHaveBeenCalled();
    });

    it('should resolve when launcher.onComplete rejects (best-effort teardown)', async () => {
      const caps = { 'wdio:electronServiceOptions': { appBinaryPath: '/path/to/binary' } };
      const browser = await init([caps]);
      onCompleteMock.mockRejectedValueOnce(new Error('dev server stop boom'));
      await expect(cleanup(browser)).resolves.toBeUndefined();
    });

    it('should not hang cleanup when launcher.onComplete never settles', async () => {
      const caps = { 'wdio:electronServiceOptions': { appBinaryPath: '/path/to/binary' } };
      const browser = await init([caps]);
      onCompleteMock.mockReturnValueOnce(new Promise<void>(() => {})); // a devServer stop() that hangs

      vi.useFakeTimers();
      try {
        const cleanupPromise = cleanup(browser);
        await vi.advanceTimersByTimeAsync(DEFAULT_TEARDOWN_TIMEOUT_MS + 1_000);
        await expect(cleanupPromise).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
      // The bounded onComplete was abandoned, so the log writer still closed.
      expect(mockClose).toHaveBeenCalled();
    });

    it('should not hang cleanup when browser.deleteSession never settles', async () => {
      const caps = { 'wdio:electronServiceOptions': { appBinaryPath: '/path/to/binary' } };
      const browser = await init([caps]);
      browserMock.deleteSession.mockReturnValueOnce(new Promise<void>(() => {})); // a driver that never acks the DELETE

      vi.useFakeTimers();
      try {
        const cleanupPromise = cleanup(browser);
        await vi.advanceTimersByTimeAsync(DEFAULT_TEARDOWN_TIMEOUT_MS + 1_000);
        await expect(cleanupPromise).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
      // deleteSession was abandoned, so onComplete + log writer still ran.
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
      expect(mockClose).toHaveBeenCalled();
    });

    it('should warn when cleaning up an unknown browser instance', async () => {
      await cleanup({ unknown: true } as unknown as WebdriverIO.Browser);

      expect(mockClose).not.toHaveBeenCalled();
      expect(onCompleteMock).not.toHaveBeenCalled();
    });
  });

  describe('createElectronCapabilities()', () => {
    it('should create capabilities with appBinaryPath', () => {
      const caps = createElectronCapabilities({ appBinaryPath: '/path/to/app' });

      expect(caps).toStrictEqual({
        browserName: 'electron',
        'goog:chromeOptions': {
          binary: '/path/to/app',
          args: [],
        },
        'wdio:electronServiceOptions': {
          appBinaryPath: '/path/to/app',
        },
      });
    });

    it('should create capabilities with appEntryPoint', () => {
      const caps = createElectronCapabilities({ appEntryPoint: './main.js' });

      expect(caps).toStrictEqual({
        browserName: 'electron',
        'wdio:electronServiceOptions': {
          appEntryPoint: './main.js',
        },
      });
      expect(caps['goog:chromeOptions']).toBeUndefined();
    });

    it('should include appArgs in both chromeOptions and serviceOptions', () => {
      const caps = createElectronCapabilities({
        appBinaryPath: '/path/to/app',
        appArgs: ['--flag', '--other'],
      });

      expect(caps['goog:chromeOptions']).toStrictEqual({
        binary: '/path/to/app',
        args: ['--flag', '--other'],
      });
      expect(caps['wdio:electronServiceOptions']?.appArgs).toStrictEqual(['--flag', '--other']);
    });

    it('should pass through all service options', () => {
      const caps = createElectronCapabilities({
        appBinaryPath: '/path/to/app',
        captureMainProcessLogs: true,
        mainProcessLogLevel: 'debug',
        logDir: './logs',
        clearMocks: true,
      });

      expect(caps['wdio:electronServiceOptions']).toMatchObject({
        appBinaryPath: '/path/to/app',
        captureMainProcessLogs: true,
        mainProcessLogLevel: 'debug',
        logDir: './logs',
        clearMocks: true,
      });
    });

    it('should throw when neither appBinaryPath nor appEntryPoint is provided', () => {
      expect(() => createElectronCapabilities({})).toThrow('Either appBinaryPath or appEntryPoint must be provided');
    });
  });
});
