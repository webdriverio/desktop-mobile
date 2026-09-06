import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TauriServiceOptions } from '../src/types.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../src/logCapture.js', () => ({
  createLogCapture: vi.fn(() => ({
    close: vi.fn(),
  })),
}));

describe('checkEmbeddedServerAlive', () => {
  let checkEmbeddedServerAlive: typeof import('../src/embeddedProvider.js').checkEmbeddedServerAlive;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    const mod = await import('../src/embeddedProvider.js');
    checkEmbeddedServerAlive = mod.checkEmbeddedServerAlive;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return true when the status endpoint responds ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    expect(await checkEmbeddedServerAlive(4445)).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4445/status',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('should use the given port in the URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    await checkEmbeddedServerAlive(9999);
    expect(globalThis.fetch).toHaveBeenCalledWith('http://127.0.0.1:9999/status', expect.anything());
  });

  it('should return false when fetch throws (connection refused)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await checkEmbeddedServerAlive(4445)).toBe(false);
  });

  it('should return false when response.ok is false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
    expect(await checkEmbeddedServerAlive(4445)).toBe(false);
  });

  it('should return false when fetch times out (AbortError)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));
    expect(await checkEmbeddedServerAlive(4445)).toBe(false);
  });
});

describe('isEmbeddedProvider', () => {
  let isEmbeddedProvider: typeof import('../src/embeddedProvider.js').isEmbeddedProvider;

  beforeEach(async () => {
    const mod = await import('../src/embeddedProvider.js');
    isEmbeddedProvider = mod.isEmbeddedProvider;
  });

  describe('explicit driverProvider — always takes priority', () => {
    it('should return true for "embedded"', () => {
      expect(isEmbeddedProvider({ driverProvider: 'embedded' })).toBe(true);
    });

    it('should return false for "official"', () => {
      expect(isEmbeddedProvider({ driverProvider: 'official' })).toBe(false);
    });

    it('should return false for "crabnebula"', () => {
      expect(isEmbeddedProvider({ driverProvider: 'crabnebula' })).toBe(false);
    });
  });

  describe('default behavior (no explicit driverProvider)', () => {
    it('should return true when no driverProvider is set', () => {
      expect(isEmbeddedProvider({})).toBe(true);
    });

    it('should return true on macOS with no driverProvider', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      expect(isEmbeddedProvider({})).toBe(true);
    });

    it('should return true on Windows with no driverProvider', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      expect(isEmbeddedProvider({})).toBe(true);
    });

    it('should return true on Linux with no driverProvider', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      expect(isEmbeddedProvider({})).toBe(true);
    });
  });
});

describe('getEmbeddedPort', () => {
  let getEmbeddedPort: typeof import('../src/embeddedProvider.js').getEmbeddedPort;
  const originalEnv = process.env;

  beforeEach(async () => {
    const mod = await import('../src/embeddedProvider.js');
    getEmbeddedPort = mod.getEmbeddedPort;
    process.env = { ...originalEnv };
    delete process.env.TAURI_WEBDRIVER_PORT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return explicit embeddedPort option when set', () => {
    expect(getEmbeddedPort({ embeddedPort: 9999 })).toBe(9999);
  });

  it('should prefer embeddedPort option over env var', () => {
    process.env.TAURI_WEBDRIVER_PORT = '8888';
    expect(getEmbeddedPort({ embeddedPort: 9999 })).toBe(9999);
  });

  it('should fall back to TAURI_WEBDRIVER_PORT env var when no option', () => {
    process.env.TAURI_WEBDRIVER_PORT = '7777';
    expect(getEmbeddedPort({})).toBe(7777);
  });

  it('should return default 4445 when neither option nor env var is set', () => {
    expect(getEmbeddedPort({})).toBe(4445);
  });

  it('should ignore NaN env var and returns default', () => {
    process.env.TAURI_WEBDRIVER_PORT = 'not-a-number';
    expect(getEmbeddedPort({})).toBe(4445);
  });

  it('should parse numeric string env var correctly', () => {
    process.env.TAURI_WEBDRIVER_PORT = '5555';
    expect(getEmbeddedPort({})).toBe(5555);
  });
});

describe('startEmbeddedDriver', () => {
  let startEmbeddedDriver: typeof import('../src/embeddedProvider.js').startEmbeddedDriver;
  let mockProc: EventEmitter & Partial<ChildProcess>;
  const originalFetch = globalThis.fetch;
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();

    const mod = await import('../src/embeddedProvider.js');
    startEmbeddedDriver = mod.startEmbeddedDriver;

    mockProc = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
    Object.defineProperty(mockProc, 'pid', { value: 12345, configurable: true });
    mockProc.exitCode = null;
    mockProc.signalCode = null;
    mockProc.kill = vi.fn().mockImplementation((signal: NodeJS.Signals) => {
      mockProc.signalCode = signal;
      mockProc.emit('exit', null, signal);
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

    vi.mocked(spawn).mockReturnValue(mockProc as ChildProcess);
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('should spawn app and resolves when poll succeeds', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ value: { ready: true } }),
    });

    const options: TauriServiceOptions = { appArgs: ['--test'] };
    const result = await startEmbeddedDriver('/path/to/app', 4445, options);

    expect(spawn).toHaveBeenCalledWith(
      '/path/to/app',
      ['--test'],
      expect.objectContaining({
        env: expect.objectContaining({
          TAURI_WEBDRIVER_PORT: '4445',
          WDIO_EMBEDDED_SERVER: 'true',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      }),
    );
    expect(result.proc).toBe(mockProc);
    expect(result.logHandlers).toBeDefined();
  });

  it('should reject on spawn error', async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      (_url, { signal }: RequestInit) =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );

    const promise = startEmbeddedDriver('/path/to/nonexistent', 4445, {});

    setImmediate(() => {
      mockProc.emit('error', new Error('ENOENT'));
    });

    await expect(promise).rejects.toThrow('Failed to spawn Tauri app');
  });

  it('should clean up on poll timeout failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const options: TauriServiceOptions = { startTimeout: 500 };
    const promise = startEmbeddedDriver('/path/to/app', 4445, options);

    await expect(promise).rejects.toThrow('Embedded WebDriver server did not become ready');
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

describe('stopEmbeddedDriver', () => {
  let stopEmbeddedDriver: typeof import('../src/embeddedProvider.js').stopEmbeddedDriver;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mod = await import('../src/embeddedProvider.js');
    stopEmbeddedDriver = mod.stopEmbeddedDriver;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should send SIGTERM and resolves when process exits gracefully', async () => {
    const mockChild = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
    Object.defineProperty(mockChild, 'pid', { value: 111, configurable: true });
    Object.defineProperty(mockChild, 'exitCode', { value: null, writable: true, configurable: true });
    Object.defineProperty(mockChild, 'signalCode', { value: null, writable: true, configurable: true });
    mockChild.kill = vi.fn().mockImplementation(() => {
      Object.defineProperty(mockChild, 'exitCode', { value: 0, writable: true, configurable: true });
      // stopEmbeddedDriver now waits on the 'exit' event rather than polling
      // exitCode, so emit it on the next tick to simulate graceful shutdown.
      queueMicrotask(() => (mockChild as EventEmitter).emit('exit', 0, null));
      return true;
    });

    const handler = { close: vi.fn() } as any;
    await stopEmbeddedDriver({ proc: mockChild as ChildProcess, logHandlers: [handler] });

    expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockChild.kill).not.toHaveBeenCalledWith('SIGKILL');
    expect(handler.close).toHaveBeenCalled();
  });

  it('should send SIGKILL after graceful timeout expires', async () => {
    const mockChild = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
    Object.defineProperty(mockChild, 'pid', { value: 222, configurable: true });
    Object.defineProperty(mockChild, 'exitCode', { value: null, writable: true, configurable: true });
    Object.defineProperty(mockChild, 'signalCode', { value: null, writable: true, configurable: true });
    const killCalls: string[] = [];
    mockChild.kill = vi.fn().mockImplementation((signal: string) => {
      killCalls.push(signal);
      if (signal === 'SIGKILL') {
        Object.defineProperty(mockChild, 'signalCode', { value: 'SIGKILL', writable: true, configurable: true });
      }
      return true;
    });

    const promise = stopEmbeddedDriver({ proc: mockChild as ChildProcess, logHandlers: [] });

    await vi.advanceTimersByTimeAsync(6000);
    await promise;

    expect(killCalls).toContain('SIGTERM');
    expect(killCalls).toContain('SIGKILL');
  });

  it('should return early when no PID is available', async () => {
    const mockChild = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
    Object.defineProperty(mockChild, 'pid', { value: undefined, configurable: true });
    mockChild.kill = vi.fn();

    const handler = { close: vi.fn() } as any;
    await stopEmbeddedDriver({ proc: mockChild as ChildProcess, logHandlers: [handler] });

    expect(mockChild.kill).not.toHaveBeenCalledWith('SIGTERM');
    expect(handler.close).toHaveBeenCalled();
  });

  it('should ignore errors when closing log handlers', async () => {
    const mockChild = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
    Object.defineProperty(mockChild, 'pid', { value: undefined, configurable: true });
    mockChild.kill = vi.fn();

    const throwingHandler = {
      close: vi.fn().mockImplementation(() => {
        throw new Error('close failed');
      }),
    } as any;

    await expect(
      stopEmbeddedDriver({ proc: mockChild as ChildProcess, logHandlers: [throwingHandler] }),
    ).resolves.toBeUndefined();
  });
});

describe('embedded lifecycle races', () => {
  let child: ChildProcess;
  const originalFetch = globalThis.fetch;
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    child = Object.assign(new EventEmitter(), {
      pid: 12345,
      exitCode: null,
      signalCode: null,
      stdout: null,
      stderr: null,
      kill: vi.fn((signal: NodeJS.Signals) => {
        child.signalCode = signal;
        child.emit('exit', null, signal);
        return true;
      }),
    }) as unknown as ChildProcess;
    vi.mocked(spawn).mockReturnValue(child);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    vi.useRealTimers();
  });

  function stallFetch() {
    const requests: AbortSignal[] = [];
    globalThis.fetch = vi.fn().mockImplementation((_url, { signal }: { signal: AbortSignal }) => {
      requests.push(signal);
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    return requests;
  }

  it('does not spawn for a pre-aborted signal', async () => {
    const { startEmbeddedDriver } = await import('../src/embeddedProvider.js');
    const reason = new Error('already cancelled');
    await expect(startEmbeddedDriver('/app', 4445, {}, undefined, AbortSignal.abort(reason))).rejects.toBe(reason);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('aborts the in-flight poll and waits for child exit before rejecting', async () => {
    const { startEmbeddedDriver } = await import('../src/embeddedProvider.js');
    const { getEventListeners } = await import('node:events');
    const requests = stallFetch();
    vi.mocked(child.kill).mockReturnValue(true);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    let settled = false;
    const result = startEmbeddedDriver('/app', 4445, {}, undefined, controller.signal).catch((error: unknown) => {
      settled = true;
      return error;
    });
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(requests[0].aborted).toBe(true);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(settled).toBe(false);
    child.exitCode = 0;
    child.emit('exit', 0, null);
    expect(await result).toBe(reason);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('enforces startTimeout even while the HTTP request is stalled', async () => {
    const { startEmbeddedDriver } = await import('../src/embeddedProvider.js');
    const requests = stallFetch();
    const result = startEmbeddedDriver('/app', 4445, { startTimeout: 20 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toMatchObject({ message: expect.stringContaining('within 20ms') });
    expect(requests[0].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops polling immediately when the child exits during startup', async () => {
    const { startEmbeddedDriver } = await import('../src/embeddedProvider.js');
    const requests = stallFetch();
    const result = startEmbeddedDriver('/app', 4445, {});
    child.exitCode = 42;
    child.emit('exit', 42, null);
    await expect(result).rejects.toThrow('code=42');
    expect(requests[0].aborted).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves both startup and kill errors', async () => {
    const { startEmbeddedDriver } = await import('../src/embeddedProvider.js');
    stallFetch();
    const controller = new AbortController();
    const cause = new Error('cancelled');
    const cleanup = new Error('permission denied');
    vi.mocked(child.kill).mockImplementation(() => {
      throw cleanup;
    });
    const result = startEmbeddedDriver('/app', 4445, {}, undefined, controller.signal);
    controller.abort(cause);
    await expect(result).rejects.toMatchObject({ cause, errors: [cause, cleanup] });
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes startup listeners and timers when ready', async () => {
    const { startEmbeddedDriver } = await import('../src/embeddedProvider.js');
    const { getEventListeners } = await import('node:events');
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ value: { ready: true } }) });
    const controller = new AbortController();
    await startEmbeddedDriver('/app', 4445, {}, undefined, controller.signal);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('rejects if a child still has not exited after SIGKILL and removes its waiters', async () => {
    const { stopEmbeddedDriver } = await import('../src/embeddedProvider.js');
    vi.mocked(child.kill).mockReturnValue(false);
    const stopped = stopEmbeddedDriver({ proc: child, logHandlers: [] }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await stopped).toMatchObject({ message: expect.stringContaining('did not exit after SIGKILL') });
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for exit after SIGKILL instead of returning when the signal is sent', async () => {
    const { stopEmbeddedDriver } = await import('../src/embeddedProvider.js');
    vi.mocked(child.kill).mockReturnValue(true);
    let stopped = false;
    const result = stopEmbeddedDriver({ proc: child, logHandlers: [] }).then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
    expect(stopped).toBe(false);
    child.signalCode = 'SIGKILL';
    child.emit('exit', null, 'SIGKILL');
    await result;
    expect(stopped).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
