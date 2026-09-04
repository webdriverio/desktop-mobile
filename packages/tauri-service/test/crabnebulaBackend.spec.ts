import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isTestRunnerBackendHealthy,
  startTestRunnerBackend,
  stopTestRunnerBackend,
  waitTestRunnerBackendReady,
} from '../src/crabnebulaBackend.js';
import * as driverManager from '../src/driverManager.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../src/driverManager.js', () => ({
  findTestRunnerBackend: vi.fn(),
}));

type MockSocket = EventEmitter & {
  connect: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  setTimeout: ReturnType<typeof vi.fn>;
};

let onConnect: (socket: MockSocket) => void = () => {};
const createMockSocket = () => {
  const socket = Object.assign(new EventEmitter(), {
    connect: vi.fn().mockImplementation(function (this: MockSocket) {
      onConnect(this);
    }),
    destroy: vi.fn(),
    setTimeout: vi.fn(),
  }) as MockSocket;
  return socket;
};

function MockSocket() {
  return createMockSocket();
}

vi.mock('node:net', () => ({
  default: { Socket: MockSocket },
  Socket: MockSocket,
}));

describe('CrabNebula Backend', () => {
  let mockProc: EventEmitter & Partial<ChildProcess>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockProc = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
    Object.defineProperty(mockProc, 'killed', {
      value: false,
      writable: true,
      configurable: true,
    });
    mockProc.kill = vi.fn().mockImplementation(() => {
      Object.defineProperty(mockProc, 'killed', { value: true, writable: true, configurable: true });
      return true;
    });
    mockProc.stdout = Object.assign(new EventEmitter(), {
      resume: vi.fn(),
      pause: vi.fn(),
      setEncoding: vi.fn(),
      [Symbol.asyncIterator]: undefined,
    }) as unknown as ChildProcess['stdout'];
    mockProc.stderr = Object.assign(new EventEmitter(), {
      resume: vi.fn(),
      pause: vi.fn(),
      setEncoding: vi.fn(),
      [Symbol.asyncIterator]: undefined,
    }) as unknown as ChildProcess['stderr'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CN_API_KEY;
  });

  describe('startTestRunnerBackend', () => {
    it('should throw when test-runner-backend is not found', async () => {
      vi.mocked(driverManager.findTestRunnerBackend).mockReturnValue(undefined);

      await expect(startTestRunnerBackend({ port: 3000 })).rejects.toThrow('test-runner-backend not found');
    });

    it('should throw when CN_API_KEY is not set', async () => {
      vi.mocked(driverManager.findTestRunnerBackend).mockReturnValue('/mock/backend');
      delete process.env.CN_API_KEY;

      await expect(startTestRunnerBackend({ port: 3000 })).rejects.toThrow('CN_API_KEY');
    });

    it('should throw when CN_API_KEY is empty', async () => {
      vi.mocked(driverManager.findTestRunnerBackend).mockReturnValue('/mock/backend');
      process.env.CN_API_KEY = '   ';

      await expect(startTestRunnerBackend({ port: 3000 })).rejects.toThrow(
        'CN_API_KEY environment variable is set but empty',
      );
    });

    it('should start backend with correct environment', async () => {
      vi.mocked(driverManager.findTestRunnerBackend).mockReturnValue('/mock/backend');
      process.env.CN_API_KEY = 'test-api-key-long-enough';
      vi.mocked(spawn).mockReturnValue(mockProc as ChildProcess);

      const promise = startTestRunnerBackend({ port: 3000 });

      setImmediate(() => {
        mockProc.emit('spawn');
      });

      const result = await promise;

      expect(spawn).toHaveBeenCalledWith(
        '/mock/backend',
        ['--port', '3000'],
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          env: expect.objectContaining({
            CN_API_KEY: 'test-api-key-long-enough',
            PORT: '3000',
          }),
        }),
      );
      expect(result.proc).toBe(mockProc);
      expect(result.port).toBe(3000);
    }, 10000);

    it('should resolve when the process spawns, before any stdout line', async () => {
      vi.mocked(driverManager.findTestRunnerBackend).mockReturnValue('/mock/backend');
      process.env.CN_API_KEY = 'test-api-key-long-enough';
      vi.mocked(spawn).mockReturnValue(mockProc as ChildProcess);

      const promise = startTestRunnerBackend({ port: 3000 });

      setImmediate(() => {
        mockProc.emit('spawn');
      });

      const result = await promise;
      expect(result.port).toBe(3000);
    }, 10000);

    it('should keep the log-capture pipes flowing after ready (never pause them)', async () => {
      vi.mocked(driverManager.findTestRunnerBackend).mockReturnValue('/mock/backend');
      process.env.CN_API_KEY = 'test-api-key-long-enough';
      vi.mocked(spawn).mockReturnValue(mockProc as ChildProcess);

      const promise = startTestRunnerBackend({
        port: 3000,
        serviceOptions: { captureBackendLogs: true },
      });

      setImmediate(() => {
        mockProc.emit('spawn');
      });

      await promise;

      // Readiness must never pause a pipe — that would drop the forwarded app logs mid-test.
      expect(mockProc.stdout?.pause).not.toHaveBeenCalled();
      expect(mockProc.stderr?.pause).not.toHaveBeenCalled();
    }, 10000);

    it('should reject if process exits with error', async () => {
      vi.mocked(driverManager.findTestRunnerBackend).mockReturnValue('/mock/backend');
      process.env.CN_API_KEY = 'test-api-key-long-enough';
      vi.mocked(spawn).mockReturnValue(mockProc as ChildProcess);

      const promise = startTestRunnerBackend({ port: 3000 });

      setTimeout(() => {
        mockProc.emit('exit', 1);
      }, 10);

      await expect(promise).rejects.toThrow('exited with code 1');
    });

    it('should reject if process emits error during startup', async () => {
      vi.mocked(driverManager.findTestRunnerBackend).mockReturnValue('/mock/backend');
      process.env.CN_API_KEY = 'test-api-key-long-enough';
      vi.mocked(spawn).mockReturnValue(mockProc as ChildProcess);

      const promise = startTestRunnerBackend({ port: 3000 });

      setTimeout(() => {
        mockProc.emit('error', new Error('ENOENT'));
      }, 10);

      await expect(promise).rejects.toThrow('Failed to start test-runner-backend');
    });
  });

  describe('stopTestRunnerBackend', () => {
    it('should return early if process already killed', async () => {
      Object.defineProperty(mockProc, 'killed', { value: true, writable: true, configurable: true });

      await stopTestRunnerBackend(mockProc as ChildProcess);

      expect(mockProc.kill).not.toHaveBeenCalled();
    });

    it('should send SIGTERM for graceful shutdown', async () => {
      const stopPromise = stopTestRunnerBackend(mockProc as ChildProcess);

      setTimeout(() => {
        mockProc.emit('exit', 0);
      }, 10);

      await stopPromise;

      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should send SIGKILL if process does not exit gracefully', async () => {
      vi.useFakeTimers();

      const killCalls: string[] = [];
      mockProc.kill = vi.fn((signal: string) => {
        killCalls.push(signal);
        return true;
      }) as any;

      const stopPromise = stopTestRunnerBackend(mockProc as ChildProcess);

      vi.advanceTimersByTime(6000);

      await stopPromise;

      expect(killCalls).toContain('SIGTERM');
      expect(killCalls).toContain('SIGKILL');

      vi.useRealTimers();
    });
  });

  describe('waitTestRunnerBackendReady', () => {
    it('should resolve when port is accepting connections', async () => {
      onConnect = (socket) => setImmediate(() => socket.emit('connect'));

      await expect(waitTestRunnerBackendReady('127.0.0.1', 3000, 5000)).resolves.toBeUndefined();
    });

    it('should reject after timeout when connection is refused', async () => {
      vi.useFakeTimers();

      onConnect = (socket) => setImmediate(() => socket.emit('error', new Error('ECONNREFUSED')));

      const promise = waitTestRunnerBackendReady('127.0.0.1', 1, 500);
      // Prevent unhandled rejection while timers advance
      let rejection: Error | undefined;
      promise.catch((err: Error) => {
        rejection = err;
      });

      await vi.advanceTimersByTimeAsync(600);

      expect(rejection).toBeDefined();
      expect(rejection?.message).toContain('did not become ready within 500ms');

      vi.useRealTimers();
    });

    it('should retry and eventually connect', async () => {
      vi.useFakeTimers();

      let connectAttempts = 0;
      onConnect = (socket) => {
        connectAttempts++;
        setImmediate(() => {
          if (connectAttempts < 3) {
            socket.emit('error', new Error('ECONNREFUSED'));
          } else {
            socket.emit('connect');
          }
        });
      };

      const promise = waitTestRunnerBackendReady('127.0.0.1', 3000, 5000);

      await vi.advanceTimersByTimeAsync(500);

      await expect(promise).resolves.toBeUndefined();
      expect(connectAttempts).toBeGreaterThanOrEqual(3);

      vi.useRealTimers();
    });
  });

  describe('isTestRunnerBackendHealthy', () => {
    it('should return true when backend is accepting connections', async () => {
      onConnect = (socket) => setImmediate(() => socket.emit('connect'));

      const healthy = await isTestRunnerBackendHealthy('127.0.0.1', 3000);
      expect(healthy).toBe(true);
    });

    it('should return false when backend is not accepting connections', async () => {
      onConnect = (socket) => setImmediate(() => socket.emit('error', new Error('ECONNREFUSED')));

      const healthy = await isTestRunnerBackendHealthy('127.0.0.1', 1);
      expect(healthy).toBe(false);
    });
  });
});
