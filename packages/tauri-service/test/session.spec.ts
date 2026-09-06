import type { IncomingMessage, RequestOptions } from 'node:http';
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
}));

vi.mock('@wdio/native-utils', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../src/launcher.js', () => ({
  default: vi.fn().mockImplementation(function MockLauncher() {
    return {
      onPrepare: mockOnPrepare,
      onWorkerStart: mockOnWorkerStart,
      onWorkerEnd: mockOnWorkerEnd,
      onComplete: mockOnComplete,
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

vi.mock('../src/logWriter.js', () => ({
  getLogWriter: vi.fn().mockReturnValue({
    initialize: mockLogWriterInitialize,
    getLogDir: mockLogWriterGetLogDir,
    getLogFile: mockLogWriterGetLogFile,
  }),
  closeLogWriter: vi.fn(),
}));

vi.mock('webdriverio', () => ({
  remote: mockRemote,
}));

vi.mock('node:http', () => ({
  default: {
    get: mockHttpGet,
  },
}));

import TauriLaunchService from '../src/launcher.js';
import { closeLogWriter, getLogWriter } from '../src/logWriter.js';
import TauriWorkerService from '../src/service.js';
import { cleanup, createTauriCapabilities, getTauriServiceStatus, init } from '../src/session.js';
import type { TauriCapabilities } from '../src/types.js';

function createMockBrowser(overrides: Record<string, unknown> = {}): WebdriverIO.Browser {
  return {
    sessionId: 'mock-session-id',
    isMultiremote: false,
    instances: [],
    getInstance: vi.fn(),
    execute: vi.fn(),
    deleteSession: vi.fn(),
    ...overrides,
  } as unknown as WebdriverIO.Browser;
}

function simulateHealthyDriver() {
  mockHttpGet.mockImplementation((_url: string, _options: RequestOptions, callback: (res: IncomingMessage) => void) => {
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

  describe('getTauriServiceStatus', () => {
    it('should return available true with version', () => {
      const status = getTauriServiceStatus();

      expect(status).toEqual({
        available: true,
        version: '0.0.0',
      });
    });

    it('should have a version string', () => {
      const status = getTauriServiceStatus();
      expect(typeof status.version).toBe('string');
    });

    it('should have available as boolean', () => {
      const status = getTauriServiceStatus();
      expect(typeof status.available).toBe('boolean');
    });
  });

  describe('init', () => {
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
      mockOnWorkerStart.mockResolvedValue(undefined);

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
      simulateHealthyDriver();

      const mockBrowser = createMockBrowser();
      mockRemote.mockResolvedValue(mockBrowser);

      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.hostname = 'localhost';
        caps.port = 4444;
        caps.browserName = 'wry';
      });
      mockOnWorkerStart.mockResolvedValue(undefined);

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
      simulateHealthyDriver();

      const mockBrowser = createMockBrowser();
      mockRemote.mockResolvedValue(mockBrowser);

      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 5555;
      });
      mockOnWorkerStart.mockResolvedValue(undefined);

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
      simulateHealthyDriver();

      const mockBrowser = createMockBrowser();
      mockRemote.mockResolvedValue(mockBrowser);

      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      mockOnWorkerStart.mockResolvedValue(undefined);

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
      simulateHealthyDriver();

      const mockBrowser = createMockBrowser();
      mockRemote.mockResolvedValue(mockBrowser);

      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      mockOnWorkerStart.mockResolvedValue(undefined);

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
      simulateHealthyDriver();

      const mockBrowser = createMockBrowser();
      mockRemote.mockResolvedValue(mockBrowser);

      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      mockOnWorkerStart.mockResolvedValue(undefined);

      const capabilities = {
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': { appBinaryPath: '/app' },
      } as unknown as TauriCapabilities;

      const browser = await init(capabilities);

      expect(mockBefore).toHaveBeenCalledWith(capabilities, [], browser);
    });

    it('should return the browser instance', async () => {
      simulateHealthyDriver();

      const mockBrowser = createMockBrowser();
      mockRemote.mockResolvedValue(mockBrowser);

      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      mockOnWorkerStart.mockResolvedValue(undefined);

      const capabilities = {
        'tauri:options': { application: '/app' },
      } as unknown as TauriCapabilities;

      const browser = await init(capabilities);
      expect(browser).toBe(mockBrowser);
    });

    it('should re-throw errors from remote()', async () => {
      simulateHealthyDriver();

      mockRemote.mockRejectedValue(new Error('Connection refused'));

      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      mockOnWorkerStart.mockResolvedValue(undefined);

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
    });

    it('should create TauriWorkerService with service options from capabilities', async () => {
      simulateHealthyDriver();

      const mockBrowser = createMockBrowser();
      mockRemote.mockResolvedValue(mockBrowser);

      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      mockOnWorkerStart.mockResolvedValue(undefined);

      const serviceOpts = { appBinaryPath: '/app', logLevel: 'debug' as const };
      const capabilities = {
        'tauri:options': { application: '/app' },
        'wdio:tauriServiceOptions': serviceOpts,
      } as unknown as TauriCapabilities;

      await init(capabilities);

      expect(TauriWorkerService).toHaveBeenCalledWith(serviceOpts, capabilities);
    });

    it('should create TauriWorkerService with empty options when none in capabilities', async () => {
      simulateHealthyDriver();

      const mockBrowser = createMockBrowser();
      mockRemote.mockResolvedValue(mockBrowser);

      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      mockOnWorkerStart.mockResolvedValue(undefined);

      const capabilities = {
        'tauri:options': { application: '/app' },
      } as unknown as TauriCapabilities;

      await init(capabilities);

      expect(TauriWorkerService).toHaveBeenCalledWith({}, capabilities);
    });
  });

  describe('standalone cancellation and failed startup cleanup', () => {
    beforeEach(() => {
      simulateHealthyDriver();
      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.hostname = '127.0.0.1';
        caps.port = 4445;
      });
      mockRemote.mockResolvedValue(createMockBrowser());
    });

    it('rejects a pre-aborted signal without starting the launcher', async () => {
      const cause = new Error('cancelled');
      await expect(init({}, { abortSignal: AbortSignal.abort(cause) })).rejects.toBe(cause);
      expect(TauriLaunchService).not.toHaveBeenCalled();
      expect(mockRemote).not.toHaveBeenCalled();
    });

    it('preserves a non-Error cancellation reason as the cause', async () => {
      await expect(init({}, { abortSignal: AbortSignal.abort('cancelled') })).rejects.toMatchObject({
        message: 'Tauri WebDriver lifecycle aborted',
        cause: 'cancelled',
      });
    });

    it.each(['prepare', 'worker', 'remote', 'before'] as const)(
      'cleans up when %s fails and preserves the original failure',
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

    it.each(['prepare', 'worker', 'remote', 'before'] as const)(
      'observes cancellation after %s resolves',
      async (stage) => {
        const controller = new AbortController();
        const reason = new Error('cancelled at stage boundary');
        const browser = createMockBrowser();
        const hook = { prepare: mockOnPrepare, worker: mockOnWorkerStart, remote: mockRemote, before: mockBefore }[
          stage
        ];
        hook.mockImplementationOnce(async () => {
          controller.abort(reason);
          return stage === 'remote' ? browser : undefined;
        });
        await expect(init({}, { abortSignal: controller.signal })).rejects.toBe(reason);
        expect(mockOnComplete).toHaveBeenCalledOnce();
        expect(browser.deleteSession).toHaveBeenCalledTimes(stage === 'remote' ? 1 : 0);
        expect(mockOnWorkerStart).toHaveBeenCalledTimes(stage === 'prepare' ? 0 : 1);
        expect(mockRemote).toHaveBeenCalledTimes(['prepare', 'worker'].includes(stage) ? 0 : 1);
      },
    );

    it('waits for launcher cleanup before rejecting startup', async () => {
      const error = new Error('prepare failed');
      mockOnPrepare.mockRejectedValueOnce(error);
      let finishCleanup!: () => void;
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

    it('preserves startup, session cleanup and launcher cleanup failures', async () => {
      const startup = new Error('worker service failed');
      const sessionCleanup = new Error('delete session failed');
      const launcherCleanup = new Error('process did not exit');
      const browser = createMockBrowser({ deleteSession: vi.fn().mockRejectedValue(sessionCleanup) });
      mockRemote.mockResolvedValueOnce(browser);
      mockBefore.mockRejectedValueOnce(startup);
      mockOnComplete.mockRejectedValueOnce(launcherCleanup);
      await expect(init({})).rejects.toMatchObject({
        cause: startup,
        errors: [startup, sessionCleanup, launcherCleanup],
      });
      expect(mockOnComplete).toHaveBeenCalledOnce();
    });

    it('preserves request cancellation alongside the lifecycle signal', async () => {
      const lifecycle = new AbortController();
      const request = new AbortController();
      await init({}, { abortSignal: lifecycle.signal });
      const options = mockRemote.mock.calls[0][0] as {
        transformRequest: (request: RequestInit) => RequestInit;
      };
      const transformed = options.transformRequest({ method: 'POST', signal: request.signal });
      expect(transformed.method).toBe('POST');
      request.abort(new Error('request timeout'));
      expect(transformed.signal?.reason).toBe(request.signal.reason);
      const next = options.transformRequest({ method: 'GET' });
      lifecycle.abort(new Error('lifecycle cancelled'));
      expect(next.signal?.reason).toBe(lifecycle.signal.reason);
    });
  });

  describe('cleanup', () => {
    it('should call launcher lifecycle methods when launcher is found', async () => {
      simulateHealthyDriver();

      const mockBrowser = createMockBrowser();
      mockRemote.mockResolvedValue(mockBrowser);

      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      mockOnWorkerStart.mockResolvedValue(undefined);

      const capabilities = {
        'tauri:options': { application: '/app' },
      } as unknown as TauriCapabilities;

      const browser = await init(capabilities);

      vi.clearAllMocks();

      await cleanup(browser);

      expect(mockOnWorkerEnd).toHaveBeenCalledWith('standalone');
      expect(mockOnComplete).toHaveBeenCalledWith(0, expect.objectContaining({ capabilities: [] }), []);
      expect(closeLogWriter).toHaveBeenCalled();
    });

    it('should remove launcher from active launchers after cleanup', async () => {
      simulateHealthyDriver();

      const mockBrowser = createMockBrowser();
      mockRemote.mockResolvedValue(mockBrowser);

      mockOnPrepare.mockImplementation(async (_config: unknown, [caps]: [Record<string, unknown>]) => {
        caps.port = 4444;
      });
      mockOnWorkerStart.mockResolvedValue(undefined);

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
