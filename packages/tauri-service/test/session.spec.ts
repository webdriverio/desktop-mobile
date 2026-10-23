import type { IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockOnPrepare,
  mockOnWorkerStart,
  mockOnWorkerEnd,
  mockOnComplete,
  mockBefore,
  mockLogWriterInitialize,
  mockLogWriterGetLogDir,
  mockLogWriterGetLogFile,
  mockRemote,
  mockHttpGet,
  mockLog,
  launcherState,
} = vi.hoisted(() => ({
  mockOnPrepare: vi.fn().mockResolvedValue(undefined),
  mockOnWorkerStart: vi.fn().mockResolvedValue(undefined),
  mockOnWorkerEnd: vi.fn().mockResolvedValue(undefined),
  mockOnComplete: vi.fn().mockResolvedValue(undefined),
  mockBefore: vi.fn().mockResolvedValue(undefined),
  mockLogWriterInitialize: vi.fn(),
  mockLogWriterGetLogDir: vi.fn().mockReturnValue('/tmp/logs'),
  mockLogWriterGetLogFile: vi.fn().mockReturnValue('/tmp/logs/test.log'),
  mockRemote: vi.fn(),
  mockHttpGet: vi.fn(),
  mockLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  launcherState: { isBrowserMode: false },
}));

vi.mock('@wdio/native-core', () => ({
  getLogWriter: vi.fn().mockReturnValue({
    initialize: mockLogWriterInitialize,
    getLogDir: mockLogWriterGetLogDir,
    getLogFile: mockLogWriterGetLogFile,
  }),
  closeLogWriter: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@wdio/native-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-utils')>()),
  createLogger: () => mockLog,
}));

vi.mock('../src/launcher.js', () => ({
  default: vi.fn().mockImplementation(function MockLauncher() {
    return {
      onPrepare: mockOnPrepare,
      onWorkerStart: mockOnWorkerStart,
      onWorkerEnd: mockOnWorkerEnd,
      onComplete: mockOnComplete,
      get isBrowserMode() {
        return launcherState.isBrowserMode;
      },
    };
  }),
}));

vi.mock('../src/service.js', () => ({
  default: vi.fn().mockImplementation(function MockService() {
    return {
      before: mockBefore,
    };
  }),
}));

vi.mock('webdriverio', () => ({
  remote: mockRemote,
}));

vi.mock('node:http', () => ({
  default: {
    get: mockHttpGet,
  },
}));

import { closeLogWriter, getLogWriter } from '@wdio/native-core';
import { DEFAULT_TEARDOWN_TIMEOUT_MS } from '@wdio/native-utils';
import TauriLaunchService from '../src/launcher.js';
import TauriWorkerService from '../src/service.js';
import { cleanup, createTauriCapabilities, init } from '../src/session.js';
import type { TauriCapabilities } from '../src/types.js';

function createMockBrowser(overrides: Record<string, unknown> = {}): WebdriverIO.Browser {
  return {
    sessionId: 'mock-session-id',
    isMultiremote: false,
    instances: [],
    getInstance: vi.fn(),
    execute: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as WebdriverIO.Browser;
}

function simulateHealthyDriver() {
  mockHttpGet.mockImplementation((_url: string, callback: (res: IncomingMessage) => void) => {
    const mockResponse = {
      statusCode: 200,
      resume: vi.fn(),
    } as unknown as IncomingMessage;
    callback(mockResponse);
    return {
      setTimeout: vi.fn(),
      on: vi.fn(),
      destroy: vi.fn(),
    };
  });
}

describe('session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations to defaults (clearAllMocks only clears call history)
    mockOnPrepare.mockResolvedValue(undefined);
    mockOnWorkerStart.mockResolvedValue(undefined);
    mockOnWorkerEnd.mockResolvedValue(undefined);
    mockOnComplete.mockResolvedValue(undefined);
    mockBefore.mockResolvedValue(undefined);
    launcherState.isBrowserMode = false;
  });

  describe('createTauriCapabilities', () => {
    it('should create capabilities with only appBinaryPath', () => {
      const caps = createTauriCapabilities('/path/to/app');

      expect(caps).toEqual({
        'tauri:options': {
          application: '/path/to/app',
          args: [],
        },
        'wdio:tauriServiceOptions': {
          appBinaryPath: '/path/to/app',
          appArgs: [],
          tauriDriverPort: undefined,
          logLevel: 'info',
          commandTimeout: 30000,
          startTimeout: 60000,
          driverProvider: undefined,
          autoInstallTauriDriver: undefined,
        },
      });
    });

    it('should use default values for optional fields', () => {
      const caps = createTauriCapabilities('/app');
      const serviceOpts = caps['wdio:tauriServiceOptions'];

      expect(serviceOpts?.logLevel).toBe('info');
      expect(serviceOpts?.commandTimeout).toBe(30000);
      expect(serviceOpts?.startTimeout).toBe(60000);
      expect(serviceOpts?.appArgs).toEqual([]);
    });

    it('should set custom appArgs', () => {
      const caps = createTauriCapabilities('/app', {
        appArgs: ['--verbose', '--port=3000'],
      });

      expect(caps['tauri:options']?.args).toEqual(['--verbose', '--port=3000']);
      expect(caps['wdio:tauriServiceOptions']?.appArgs).toEqual(['--verbose', '--port=3000']);
    });

    it('should set custom tauriDriverPort', () => {
      const caps = createTauriCapabilities('/app', {
        tauriDriverPort: 9515,
      });

      expect(caps['wdio:tauriServiceOptions']?.tauriDriverPort).toBe(9515);
    });

    it('should set custom logLevel', () => {
      const caps = createTauriCapabilities('/app', { logLevel: 'debug' });
      expect(caps['wdio:tauriServiceOptions']?.logLevel).toBe('debug');
    });

    it('should set logLevel to trace', () => {
      const caps = createTauriCapabilities('/app', { logLevel: 'trace' });
      expect(caps['wdio:tauriServiceOptions']?.logLevel).toBe('trace');
    });

    it('should set logLevel to error', () => {
      const caps = createTauriCapabilities('/app', { logLevel: 'error' });
      expect(caps['wdio:tauriServiceOptions']?.logLevel).toBe('error');
    });

    it('should set custom commandTimeout', () => {
      const caps = createTauriCapabilities('/app', { commandTimeout: 60000 });
      expect(caps['wdio:tauriServiceOptions']?.commandTimeout).toBe(60000);
    });

    it('should set custom startTimeout', () => {
      const caps = createTauriCapabilities('/app', { startTimeout: 60000 });
      expect(caps['wdio:tauriServiceOptions']?.startTimeout).toBe(60000);
    });

    it('should set driverProvider to official', () => {
      const caps = createTauriCapabilities('/app', { driverProvider: 'official' });
      expect(caps['wdio:tauriServiceOptions']?.driverProvider).toBe('official');
    });

    it('should set driverProvider to crabnebula', () => {
      const caps = createTauriCapabilities('/app', { driverProvider: 'crabnebula' });
      expect(caps['wdio:tauriServiceOptions']?.driverProvider).toBe('crabnebula');
    });

    it('should set driverProvider to embedded', () => {
      const caps = createTauriCapabilities('/app', { driverProvider: 'embedded' });
      expect(caps['wdio:tauriServiceOptions']?.driverProvider).toBe('embedded');
    });

    it('should set autoInstallTauriDriver', () => {
      const caps = createTauriCapabilities('/app', { autoInstallTauriDriver: true });
      expect(caps['wdio:tauriServiceOptions']?.autoInstallTauriDriver).toBe(true);
    });

    it('should set autoInstallTauriDriver to false', () => {
      const caps = createTauriCapabilities('/app', { autoInstallTauriDriver: false });
      expect(caps['wdio:tauriServiceOptions']?.autoInstallTauriDriver).toBe(false);
    });

    it('should set all options at once', () => {
      const caps = createTauriCapabilities('/my/app', {
        appArgs: ['--dev'],
        tauriDriverPort: 4444,
        logLevel: 'warn',
        commandTimeout: 10000,
        startTimeout: 45000,
        driverProvider: 'crabnebula',
        autoInstallTauriDriver: true,
      });

      expect(caps).toEqual({
        'tauri:options': {
          application: '/my/app',
          args: ['--dev'],
        },
        'wdio:tauriServiceOptions': {
          appBinaryPath: '/my/app',
          appArgs: ['--dev'],
          tauriDriverPort: 4444,
          logLevel: 'warn',
          commandTimeout: 10000,
          startTimeout: 45000,
          driverProvider: 'crabnebula',
          autoInstallTauriDriver: true,
        },
      });
    });

    it('should set application path in tauri:options', () => {
      const caps = createTauriCapabilities('/usr/bin/my-tauri-app');
      expect(caps['tauri:options']?.application).toBe('/usr/bin/my-tauri-app');
    });

    it('should preserve empty appArgs as empty array', () => {
      const caps = createTauriCapabilities('/app', { appArgs: [] });
      expect(caps['tauri:options']?.args).toEqual([]);
      expect(caps['wdio:tauriServiceOptions']?.appArgs).toEqual([]);
    });
  });

  describe('init', () => {
    let mockBrowser: ReturnType<typeof createMockBrowser>;

    beforeEach(() => {
      simulateHealthyDriver();
      mockBrowser = createMockBrowser();
      mockRemote.mockResolvedValue(mockBrowser);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should throw if port is not set on capabilities', async () => {
      mockOnPrepare.mockImplementation(() => Promise.resolve());
      mockOnWorkerStart.mockImplementation(() => Promise.resolve());

      const capabilities: TauriCapabilities = {
        'tauri:options': {
          application: '/app',
        },
        'wdio:tauriServiceOptions': {
          appBinaryPath: '/app',
        },
      };

      await expect(init(capabilities)).rejects.toThrow('Tauri driver port was not set on capabilities by onPrepare');
    });

    it('should create launcher with global options containing rootDir', async () => {
      mockOnPrepare.mockImplementation(async () => {
        // Simulate launcher setting port on capabilities
      });
      const capabilities: TauriCapabilities = {
        'tauri:options': { application: '/app' },
      };

      await expect(init(capabilities, { rootDir: '/my/project' })).rejects.toThrow('Tauri driver port was not set');

      expect(TauriLaunchService).toHaveBeenCalledWith({ rootDir: '/my/project' }, capabilities, {
        rootDir: '/my/project',
        capabilities: [],
      });
    });

    it('should create launcher with empty global options when not provided', async () => {
      const capabilities: TauriCapabilities = {
        'tauri:options': { application: '/app' },
      };

      await expect(init(capabilities)).rejects.toThrow('Tauri driver port was not set');

      expect(TauriLaunchService).toHaveBeenCalledWith({}, capabilities, { capabilities: [] });
    });

    it('should call onPrepare and onWorkerStart in order', async () => {
      const callOrder: string[] = [];
      mockOnPrepare.mockImplementation(async () => {
        callOrder.push('onPrepare');
      });
      mockOnWorkerStart.mockImplementation(async () => {
        callOrder.push('onWorkerStart');
      });

      const capabilities: TauriCapabilities = {
        'tauri:options': { application: '/app' },
      };

      await expect(init(capabilities)).rejects.toThrow();

      expect(callOrder).toEqual(['onPrepare', 'onWorkerStart']);
    });

    it('should strip hostname, port, and browserName from driver capabilities', async () => {
      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.hostname = 'localhost';
        caps.port = 4444;
        caps.browserName = 'wry';
      });
      const capabilities = {
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': { appBinaryPath: '/app' },
      } as unknown as TauriCapabilities;

      await init(capabilities);

      const remoteCall = mockRemote.mock.calls[0][0] as {
        hostname: string;
        port: number;
        capabilities: Record<string, unknown>;
      };

      expect(remoteCall.hostname).toBe('localhost');
      expect(remoteCall.port).toBe(4444);
      expect(remoteCall.capabilities).not.toHaveProperty('hostname');
      expect(remoteCall.capabilities).not.toHaveProperty('port');
      expect(remoteCall.capabilities).not.toHaveProperty('browserName');
    });

    it('should use default hostname localhost when not set', async () => {
      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 5555;
      });
      const capabilities = {
        'tauri:options': { application: '/app' },
      } as unknown as TauriCapabilities;

      await init(capabilities);

      const remoteCall = mockRemote.mock.calls[0][0] as {
        hostname: string;
        port: number;
      };
      expect(remoteCall.hostname).toBe('localhost');
    });

    it('should pass connectionRetryTimeout as startTimeout * 4', async () => {
      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      const capabilities = {
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': {
          appBinaryPath: '/app',
          startTimeout: 15000,
        },
      } as unknown as TauriCapabilities;

      await init(capabilities);

      const remoteCall = mockRemote.mock.calls[0][0] as {
        connectionRetryTimeout: number;
        connectionRetryCount: number;
      };
      expect(remoteCall.connectionRetryTimeout).toBe(60000);
      expect(remoteCall.connectionRetryCount).toBe(10);
    });

    it('should use default startTimeout of 30000 when not specified', async () => {
      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      const capabilities = {
        'tauri:options': { application: '/app' },
      } as unknown as TauriCapabilities;

      await init(capabilities);

      const remoteCall = mockRemote.mock.calls[0][0] as {
        connectionRetryTimeout: number;
      };
      expect(remoteCall.connectionRetryTimeout).toBe(120000);
    });

    it('should call service.before with the browser', async () => {
      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      const capabilities = {
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': { appBinaryPath: '/app' },
      } as unknown as TauriCapabilities;

      const browser = await init(capabilities);

      expect(mockBefore).toHaveBeenCalledWith({ ...capabilities, port: 4444 }, [], browser);
    });

    it('should return the browser instance', async () => {
      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      const capabilities = {
        'tauri:options': { application: '/app' },
      } as unknown as TauriCapabilities;

      const browser = await init(capabilities);
      expect(browser).toBe(mockBrowser);
    });

    it('should re-throw errors from remote()', async () => {
      mockRemote.mockRejectedValue(new Error('Connection refused'));

      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      const capabilities = {
        'tauri:options': { application: '/app' },
      } as unknown as TauriCapabilities;

      await expect(init(capabilities)).rejects.toThrow('Connection refused');
    });

    it('should initialize log writer when captureBackendLogs is enabled with logDir', async () => {
      const capabilities = {
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': {
          captureBackendLogs: true,
          logDir: '/tmp/test-logs',
        },
      } as unknown as TauriCapabilities;

      await expect(init(capabilities)).rejects.toThrow('Tauri driver port was not set');

      expect(getLogWriter).toHaveBeenCalled();
      expect(mockLogWriterInitialize).toHaveBeenCalledWith('/tmp/test-logs');
    });

    it('should initialize log writer when captureFrontendLogs is enabled with logDir', async () => {
      const capabilities = {
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': {
          captureFrontendLogs: true,
          logDir: '/tmp/test-logs',
        },
      } as unknown as TauriCapabilities;

      await expect(init(capabilities)).rejects.toThrow('Tauri driver port was not set');

      expect(getLogWriter).toHaveBeenCalled();
      expect(mockLogWriterInitialize).toHaveBeenCalledWith('/tmp/test-logs');
    });

    it('should not initialize log writer when logging is disabled', async () => {
      const capabilities = {
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': {
          captureBackendLogs: false,
          captureFrontendLogs: false,
        },
      } as unknown as TauriCapabilities;

      await expect(init(capabilities)).rejects.toThrow('Tauri driver port was not set');

      expect(mockLogWriterInitialize).not.toHaveBeenCalled();
    });

    it('should not initialize log writer when logDir is not specified', async () => {
      const capabilities = {
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': {
          captureBackendLogs: true,
        },
      } as unknown as TauriCapabilities;

      await expect(init(capabilities)).rejects.toThrow('Tauri driver port was not set');

      expect(mockLogWriterInitialize).not.toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('logs will be written to'));
      expect(mockLog.warn).not.toHaveBeenCalledWith(expect.stringContaining('logs will not be captured'));
    });

    it('should create TauriWorkerService with empty options when no global options are given', async () => {
      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      const capabilities = {
        'tauri:options': { application: '/app' },
      } as unknown as TauriCapabilities;

      await init(capabilities);

      expect(TauriWorkerService).toHaveBeenCalledWith({}, { ...capabilities, port: 4444 });
    });

    it('should pass the global options to TauriWorkerService', async () => {
      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      const capabilities = {
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': { windowLabel: 'settings' },
      } as unknown as TauriCapabilities;
      const globalOptions = { windowLabel: 'main', clearMocks: true };

      await init(capabilities, globalOptions);

      expect(TauriWorkerService).toHaveBeenCalledWith(globalOptions, { ...capabilities, port: 4444 });
    });

    it('should keep a global driverProvider that createTauriCapabilities leaves undefined', async () => {
      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      const capabilities = createTauriCapabilities('/app');

      await init(capabilities, { driverProvider: 'external' });

      const [workerOptions, workerCapabilities] = vi.mocked(TauriWorkerService).mock.calls[0];
      const { default: RealTauriWorkerService } =
        await vi.importActual<typeof import('../src/service.js')>('../src/service.js');
      const worker = new RealTauriWorkerService(workerOptions, workerCapabilities);
      expect((worker as unknown as { driverProvider?: string }).driverProvider).toBe('external');
    });

    it('should open a native session when the capability options hold a devServer function', async () => {
      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      const capabilities = {
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': {
          devServer: async () => ({ url: 'http://localhost:1420', close: async () => {} }),
        },
      } as unknown as TauriCapabilities;

      await init(capabilities);

      expect(mockRemote).toHaveBeenCalledWith(expect.objectContaining({ port: 4444 }));
      expect(mockRemote.mock.calls[0][0].capabilities).not.toHaveProperty('port');
    });

    it("should leave the caller's capabilities untouched by the launcher's native-mode writes", async () => {
      mockOnPrepare.mockImplementation(
        async (_config: unknown, [caps]: [TauriCapabilities & Record<string, unknown>]) => {
          caps.port = 4444;
          caps.hostname = '127.0.0.1';
          if (caps['tauri:options']) {
            caps['tauri:options'].application = '/resolved/app';
          }
        },
      );
      const capabilities = {
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': { appBinaryPath: '/app' },
      } as unknown as TauriCapabilities;

      await init(capabilities);

      expect(capabilities).toEqual({
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': { appBinaryPath: '/app' },
      });
      expect(mockRemote.mock.calls[0][0]).toMatchObject({ hostname: '127.0.0.1', port: 4444 });
    });
  });

  describe('browser mode', () => {
    const devServerUrl = 'http://localhost:1420';

    beforeEach(() => {
      // Mirrors the launcher's browser-mode onPrepare: a Chrome capability and no driver port.
      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.browserName = 'chrome';
        delete caps['tauri:options'];
        launcherState.isBrowserMode = true;
      });
      mockRemote.mockResolvedValue(createMockBrowser());
    });

    function browserModeCapabilities(): TauriCapabilities {
      return {
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl },
      } as unknown as TauriCapabilities;
    }

    const chromeSessionCapabilities = {
      browserName: 'chrome',
      'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl },
    };

    it('should open the session through WebdriverIO without a driver port', async () => {
      const browser = await init(browserModeCapabilities());

      expect(mockRemote).toHaveBeenCalledWith({ capabilities: chromeSessionCapabilities });
      expect(mockHttpGet).not.toHaveBeenCalled();
      expect(mockBefore).toHaveBeenCalledWith(chromeSessionCapabilities, [], browser);
    });

    it('should open a browser-mode session when mode comes from the global options', async () => {
      await init({} as TauriCapabilities, { mode: 'browser', devServerUrl });

      expect(mockRemote).toHaveBeenCalledWith({ capabilities: { browserName: 'chrome' } });
      expect(TauriWorkerService).toHaveBeenCalledWith(expect.objectContaining({ mode: 'browser' }), {
        browserName: 'chrome',
      });
    });

    it("should follow the launcher's browser-mode decision", async () => {
      await init({ 'tauri:options': { application: '/app' } } as unknown as TauriCapabilities);

      expect(mockRemote).toHaveBeenCalledWith({ capabilities: { browserName: 'chrome' } });
    });

    it("should leave the caller's capabilities untouched by the launcher's browser-mode rewrite", async () => {
      const capabilities = browserModeCapabilities();

      await init(capabilities);

      expect(capabilities).toEqual(browserModeCapabilities());
    });

    it('should strip a user-supplied port and hostname from the browser session capabilities', async () => {
      await init({ ...browserModeCapabilities(), hostname: 'localhost', port: 9999 } as TauriCapabilities);

      expect(mockRemote).toHaveBeenCalledWith({ capabilities: chromeSessionCapabilities });
    });

    it("should keep WebdriverIO's capability writes off the caller's object", async () => {
      // Mirrors what WebdriverIO does to the capabilities it starts a Chrome session with.
      mockRemote.mockImplementationOnce(async ({ capabilities: sessionCapabilities }) => {
        sessionCapabilities.webSocketUrl = true;
        sessionCapabilities.unhandledPromptBehavior = 'ignore';
        const chromedriverOptions = sessionCapabilities['wdio:chromedriverOptions'];
        chromedriverOptions.allowedOrigins = chromedriverOptions.allowedOrigins || ['*'];
        chromedriverOptions.allowedIps = chromedriverOptions.allowedIps || ['0.0.0.0'];
        sessionCapabilities['goog:chromeOptions'] = { binary: '/path/to/chrome' };
        return createMockBrowser();
      });
      const capabilities = {
        ...browserModeCapabilities(),
        'wdio:chromedriverOptions': { binary: '/path/to/chromedriver' },
      } as TauriCapabilities;

      await init(capabilities);

      expect(capabilities).toEqual({
        ...browserModeCapabilities(),
        'wdio:chromedriverOptions': { binary: '/path/to/chromedriver' },
      });
    });

    it('should warn that log capture is unavailable instead of pointing at a log directory', async () => {
      await init({
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl, captureBackendLogs: true },
      } as unknown as TauriCapabilities);

      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('unavailable in browser mode'));
      expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining('logs will be written to'));
    });

    it('should warn that log capture is unavailable when browser mode comes from the global options', async () => {
      await init(
        {
          'tauri:options': { application: '/app' },
          'wdio:tauriServiceOptions': { captureBackendLogs: true },
        } as unknown as TauriCapabilities,
        { mode: 'browser', devServerUrl },
      );

      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('unavailable in browser mode'));
      expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining('logs will be written to'));
    });

    it('should stop the launcher, which stops the managed dev server, on cleanup', async () => {
      const browser = await init(browserModeCapabilities());
      expect(mockOnComplete).not.toHaveBeenCalled();

      await cleanup(browser);

      expect(mockOnComplete).toHaveBeenCalledOnce();
    });

    it('should stop the launcher when the browser session fails to start', async () => {
      const error = new Error('chromedriver failed to start');
      mockRemote.mockRejectedValueOnce(error);

      await expect(init(browserModeCapabilities())).rejects.toBe(error);
      expect(mockOnComplete).toHaveBeenCalledOnce();
    });
  });

  describe('standalone failed startup cleanup', () => {
    beforeEach(() => {
      simulateHealthyDriver();
      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.hostname = '127.0.0.1';
        caps.port = 4445;
      });
      mockRemote.mockResolvedValue(createMockBrowser());
    });

    it.each(['prepare', 'worker', 'remote', 'before'] as const)(
      'should clean up when %s fails and preserves the original failure',
      async (stage) => {
        const error = new Error(`${stage} failed`);
        const hook = { prepare: mockOnPrepare, worker: mockOnWorkerStart, remote: mockRemote, before: mockBefore }[
          stage
        ];
        hook.mockRejectedValueOnce(error);
        await expect(init({})).rejects.toBe(error);
        expect(mockOnComplete).toHaveBeenCalledOnce();
      },
    );

    it('should wait for launcher cleanup before rejecting startup', async () => {
      const error = new Error('prepare failed');
      mockOnPrepare.mockRejectedValueOnce(error);
      let finishCleanup: () => void = () => {};
      mockOnComplete.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishCleanup = resolve;
          }),
      );
      let settled = false;
      const result = init({}).catch((failure: unknown) => {
        settled = true;
        return failure;
      });
      await vi.waitFor(() => expect(mockOnComplete).toHaveBeenCalledOnce());
      expect(settled).toBe(false);
      finishCleanup();
      expect(await result).toBe(error);
    });

    it('should preserve startup and launcher cleanup failures', async () => {
      const startup = new Error('worker service failed');
      const launcherCleanup = new Error('process did not exit');
      mockRemote.mockResolvedValueOnce(createMockBrowser());
      mockBefore.mockRejectedValueOnce(startup);
      mockOnComplete.mockRejectedValueOnce(launcherCleanup);
      await expect(init({})).rejects.toMatchObject({
        cause: startup,
        errors: [startup, launcherCleanup],
      });
      expect(mockOnComplete).toHaveBeenCalledOnce();
    });

    it('should warn on a non-benign session-cleanup failure and rethrow only the startup error', async () => {
      const startup = new Error('worker service failed');
      const deleteSession = vi.fn().mockRejectedValue(new Error('chrome not reachable'));
      mockRemote.mockResolvedValueOnce(createMockBrowser({ deleteSession }));
      mockBefore.mockRejectedValueOnce(startup);
      await expect(init({})).rejects.toBe(startup);
      expect(deleteSession).toHaveBeenCalledOnce();
      expect(mockLog.warn).toHaveBeenCalledWith(
        'Failed to delete session during startup cleanup: chrome not reachable',
      );
      expect(mockOnComplete).toHaveBeenCalledOnce();
    });

    it('should swallow a benign session-cleanup error and rethrow only the startup error', async () => {
      const startup = new Error('worker service failed');
      const browser = createMockBrowser({ deleteSession: vi.fn().mockRejectedValue(new Error('session not found')) });
      mockRemote.mockResolvedValueOnce(browser);
      mockBefore.mockRejectedValueOnce(startup);
      await expect(init({})).rejects.toBe(startup);
    });
  });

  describe('cleanup', () => {
    beforeEach(() => {
      simulateHealthyDriver();
      mockRemote.mockResolvedValue(createMockBrowser());
      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
    });

    it('should stop the launcher via onComplete alone when launcher is found', async () => {
      const capabilities = {
        'tauri:options': { application: '/app' },
      } as unknown as TauriCapabilities;

      const browser = await init(capabilities);

      vi.clearAllMocks();

      await cleanup(browser);

      expect(mockOnWorkerEnd).not.toHaveBeenCalled();
      expect(mockOnComplete).toHaveBeenCalled();
    });

    it('should swallow a launcher.onComplete failure during cleanup', async () => {
      const capabilities = {
        'tauri:options': { application: '/app' },
      } as unknown as TauriCapabilities;
      const browser = await init(capabilities);
      vi.clearAllMocks();
      mockOnComplete.mockRejectedValueOnce(new Error('driver stop boom'));

      await expect(cleanup(browser)).resolves.toBeUndefined();
    });

    it('should wait past the default teardown deadline for a slow multi-process onComplete', async () => {
      const capabilities = {
        'tauri:options': { application: '/app' },
      } as unknown as TauriCapabilities;
      const browser = await init(capabilities);
      vi.clearAllMocks();
      let finishStop: () => void = () => {};
      mockOnComplete.mockReturnValueOnce(
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

    it('should remove launcher from active launchers after cleanup', async () => {
      const capabilities = {
        'tauri:options': { application: '/app' },
      } as unknown as TauriCapabilities;

      const browser = await init(capabilities);

      await cleanup(browser);

      vi.clearAllMocks();

      await cleanup(browser);

      expect(mockOnWorkerEnd).not.toHaveBeenCalled();
      expect(mockOnComplete).not.toHaveBeenCalled();
    });

    it('should warn when no launcher is found for browser', async () => {
      const unknownBrowser = createMockBrowser();

      await cleanup(unknownBrowser);

      expect(mockOnWorkerEnd).not.toHaveBeenCalled();
      expect(mockOnComplete).not.toHaveBeenCalled();
      expect(closeLogWriter).not.toHaveBeenCalled();
    });
  });
});
