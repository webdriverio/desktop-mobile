import assert from 'node:assert';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  execute,
  executeTauriCommand,
  executeTauriCommands,
  executeTauriCommandsParallel,
  executeTauriCommandWithTimeout,
  getTauriAppInfo,
  getTauriVersion,
  isTauriApiAvailable,
} from '../../src/commands/execute.js';
import { clearWindowState, setSessionProvider } from '../../src/window.js';

vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

function createMockBrowser(executeFn?: (...args: unknown[]) => unknown) {
  return {
    execute: vi.fn(executeFn ?? (() => undefined)),
  } as unknown as WebdriverIO.Browser;
}

function mockFetch(response: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: vi.fn().mockResolvedValue(response),
  });
}

describe('execute — embedded provider (direct eval)', () => {
  let browser: WebdriverIO.Browser;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    clearWindowState();
    browser = createMockBrowser();
    // embedded is the default provider; stub fetch for the HTTP client
    vi.stubGlobal('fetch', mockFetch({ value: 42 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('parameter validation', () => {
    it('should throw when script is not a string or function', async () => {
      await expect(() => execute(browser, {} as string)).rejects.toThrow(
        'Expecting script to be type of "string" or "function"',
      );
    });

    it('should throw when script is a number', async () => {
      await expect(() => execute(browser, 42 as unknown as string)).rejects.toThrow(
        'Expecting script to be type of "string" or "function"',
      );
    });

    it('should throw when browser is undefined', async () => {
      await expect(() => execute(undefined as unknown as WebdriverIO.Browser, '() => 1')).rejects.toThrow(
        'WDIO browser is not yet initialised',
      );
    });
  });

  describe('successful execution', () => {
    it('should return value from direct eval', async () => {
      vi.stubGlobal('fetch', mockFetch({ value: 99 }));
      const result = await execute<number>(browser, '() => 99');
      expect(result).toBe(99);
    });

    it('should return undefined when response has undef=true', async () => {
      vi.stubGlobal('fetch', mockFetch({ value: null, undef: true }));
      const result = await execute<undefined>(browser, '() => undefined');
      expect(result).toBeUndefined();
    });

    it('should return null value', async () => {
      vi.stubGlobal('fetch', mockFetch({ value: null }));
      const result = await execute<null>(browser, '() => null');
      expect(result).toBeNull();
    });

    it('should convert function to string and send via fetch', async () => {
      const mockFn = mockFetch({ value: 42 });
      vi.stubGlobal('fetch', mockFn);
      const fn = (_tauri: unknown, a: number) => a * 2;
      await execute<number>(browser, fn, 21);
      const body = JSON.parse(mockFn.mock.calls[0][1].body as string) as Record<string, unknown>;
      expect(typeof body.script).toBe('string');
      expect(body.script).toContain(fn.toString());
    });
  });

  describe('error handling', () => {
    it('should throw when fetch returns error field', async () => {
      vi.stubGlobal('fetch', mockFetch({ error: 'script failed' }));
      await expect(execute(browser, '() => { throw new Error() }')).rejects.toThrow('script failed');
    });

    it('should throw when fetch rejects (connection refused)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      await expect(execute(browser, '() => 1')).rejects.toThrow('ECONNREFUSED');
    });
  });

  // Regression: on macOS the first direct eval against a freshly-spawned WKWebView can
  // return the opaque WKErrorJavaScriptExceptionOccurred before the page is ready (#540).
  describe('macOS cold-webview retry (#540)', () => {
    function evalErrorThenValue(failures: number, value: unknown): ReturnType<typeof vi.fn> {
      let call = 0;
      return vi.fn().mockImplementation(() => {
        call++;
        const failing = call <= failures;
        return Promise.resolve({
          ok: !failing,
          status: failing ? 500 : 200,
          statusText: failing ? 'Internal Server Error' : 'OK',
          json: vi.fn().mockResolvedValue(failing ? { error: 'A JavaScript exception occurred' } : { value }),
        });
      });
    }

    it('retries the opaque WebKit JS exception and succeeds once the webview is ready', async () => {
      vi.useFakeTimers();
      const fetchMock = evalErrorThenValue(2, 7);
      vi.stubGlobal('fetch', fetchMock);

      const promise = execute<number>(browser, '() => 7');
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }
      const result = await promise;

      expect(result).toBe(7);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      vi.useRealTimers();
    });

    it('gives up after the retry budget and rethrows the WebKit JS exception', async () => {
      vi.useFakeTimers();
      const fetchMock = evalErrorThenValue(Number.POSITIVE_INFINITY, undefined);
      vi.stubGlobal('fetch', fetchMock);

      const promise = execute(browser, '() => 1').catch((e: Error) => e);
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }
      const result = await promise;

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/javascript exception occurred/i);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      vi.useRealTimers();
    });

    it('does not retry a genuine script error', async () => {
      vi.stubGlobal('fetch', mockFetch({ error: 'ReferenceError: foo is not defined' }, false, 500));
      await expect(execute(browser, '() => foo')).rejects.toThrow('ReferenceError: foo is not defined');
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('window label routing', () => {
    it('should send window_label when per-call option is provided', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);
      await execute(browser, '() => 1', { __wdioOptions__: true, windowLabel: 'settings' } as never);
      const body = JSON.parse(mockFn.mock.calls[0][1].body as string) as Record<string, unknown>;
      expect(body.window_label).toBe('settings');
    });

    it('should omit window_label for default session', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);
      await execute(browser, '() => 1');
      const body = JSON.parse(mockFn.mock.calls[0][1].body as string) as Record<string, unknown>;
      expect(body.window_label).toBeUndefined();
    });
  });

  describe('client caching', () => {
    it('should reuse the same client for the same browser', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);
      await execute(browser, '() => 1');
      await execute(browser, '() => 2');
      // Both calls go to the same URL (same port)
      expect(mockFn.mock.calls[0][0]).toBe(mockFn.mock.calls[1][0]);
    });

    it('should create separate clients for different browsers', async () => {
      const browser2 = createMockBrowser();
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);
      await execute(browser, '() => 1');
      await execute(browser2, '() => 2');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should create a new client when TAURI_WEBDRIVER_PORT changes between calls', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);

      process.env.TAURI_WEBDRIVER_PORT = '9000';
      await execute(browser, '() => 1');

      process.env.TAURI_WEBDRIVER_PORT = '9001';
      await execute(browser, '() => 2');

      delete process.env.TAURI_WEBDRIVER_PORT;

      expect(mockFn.mock.calls[0][0]).toBe('http://127.0.0.1:9000/wdio/eval');
      expect(mockFn.mock.calls[1][0]).toBe('http://127.0.0.1:9001/wdio/eval');
    });
  });
});

describe('execute — IPC provider (official/crabnebula)', () => {
  let browser: WebdriverIO.Browser;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    clearWindowState();
    browser = createMockBrowser();
    // Set provider to official so the IPC path is taken
    setSessionProvider(browser, 'official');
  });

  describe('parameter validation', () => {
    it('should throw when script is not a string or function', async () => {
      await expect(() => execute(browser, {} as string)).rejects.toThrow(
        'Expecting script to be type of "string" or "function"',
      );
    });

    it('should throw when script is undefined', async () => {
      await expect(() => execute(browser, undefined as unknown as string)).rejects.toThrow(
        'Expecting script to be type of "string" or "function"',
      );
    });
  });

  describe('plugin availability check', () => {
    it('should throw when plugin is never available after max retries', async () => {
      vi.useFakeTimers();
      const mockExecute = vi.fn().mockResolvedValue(false);
      browser = createMockBrowser();
      setSessionProvider(browser, 'official');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      const promise = execute(browser, '() => 1').catch((e: Error) => e);

      for (let i = 0; i < 100; i++) {
        await vi.advanceTimersByTimeAsync(50);
      }

      const result = await promise;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain(
        'Tauri plugin not available. Make sure @wdio/tauri-plugin is installed and registered in your Tauri app.',
      );
    });

    it('should succeed when plugin becomes available after retries', async () => {
      vi.useFakeTimers();
      let callCount = 0;
      const mockExecute = vi.fn().mockImplementation((..._args: unknown[]) => {
        callCount++;
        if (callCount <= 3) return Promise.resolve(false);
        if (callCount === 4) return Promise.resolve(true);
        return Promise.resolve(JSON.stringify({ __wdio_value__: 'result' }));
      });
      browser = createMockBrowser();
      setSessionProvider(browser, 'official');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      const promise = execute<string, []>(browser, '() => "result"');

      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(50);
      }
      await vi.advanceTimersByTimeAsync(0);

      const result = await promise;
      expect(result).toBe('result');
      expect(mockExecute).toHaveBeenCalledTimes(5);
    });

    it('should use cached result on second call with same browser', async () => {
      let callCount = 0;
      const mockExecute = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(true);
        return Promise.resolve(JSON.stringify({ __wdio_value__: 'result' }));
      });
      browser = createMockBrowser();
      setSessionProvider(browser, 'official');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      await execute<string, []>(browser, '() => "result"');
      const firstCallCount = callCount;

      await execute<string, []>(browser, '() => "result2"');

      expect(callCount).toBe(firstCallCount + 1);
    });

    it('should not share cache between different browser objects', async () => {
      const browser1 = createMockBrowser();
      const browser2 = createMockBrowser();
      setSessionProvider(browser1, 'official');
      setSessionProvider(browser2, 'official');
      const calls1: number[] = [];
      const calls2: number[] = [];

      let count1 = 0;
      (browser1.execute as ReturnType<typeof vi.fn>).mockImplementation(() => {
        count1++;
        calls1.push(count1);
        if (count1 === 1) return Promise.resolve(true);
        return Promise.resolve(JSON.stringify({ __wdio_value__: 'b1' }));
      });

      let count2 = 0;
      (browser2.execute as ReturnType<typeof vi.fn>).mockImplementation(() => {
        count2++;
        calls2.push(count2);
        if (count2 === 1) return Promise.resolve(true);
        return Promise.resolve(JSON.stringify({ __wdio_value__: 'b2' }));
      });

      await execute<string, []>(browser1, '() => "b1"');
      await execute<string, []>(browser2, '() => "b2"');

      expect(calls1).toHaveLength(2);
      expect(calls2).toHaveLength(2);
    });
  });

  describe('function serialization', () => {
    it('should convert functions to strings', async () => {
      const mockExecute = vi.fn();
      mockExecute.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce(JSON.stringify({ __wdio_value__: 42 }));
      browser = createMockBrowser();
      setSessionProvider(browser, 'official');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      const fn = (_tauri: unknown, a: number, b: number) => a + b;
      await execute<number, [number, number]>(browser, fn, 1, 2);

      const secondCall = mockExecute.mock.calls[1];
      expect(secondCall[1]).toBe(fn.toString());
      expect(secondCall[2]).toEqual({});
      expect(secondCall[3]).toBe('[1,2]');
    });

    it('should pass strings as-is', async () => {
      const mockExecute = vi.fn();
      mockExecute.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce(JSON.stringify({ __wdio_value__: 'hello' }));
      browser = createMockBrowser();
      setSessionProvider(browser, 'official');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      await execute<string, []>(browser, 'return "hello"');

      const secondCall = mockExecute.mock.calls[1];
      expect(secondCall[1]).toBe('return "hello"');
    });
  });

  describe('result parsing', () => {
    it('should parse __wdio_value__ from JSON response', async () => {
      const mockExecute = vi.fn();
      mockExecute.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce(JSON.stringify({ __wdio_value__: { foo: 'bar' } }));
      browser = createMockBrowser();
      setSessionProvider(browser, 'official');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      const result = await execute<{ foo: string }, []>(browser, '() => ({ foo: "bar" })');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('should return null __wdio_value__', async () => {
      const mockExecute = vi.fn();
      mockExecute.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce(JSON.stringify({ __wdio_value__: null }));
      browser = createMockBrowser();
      setSessionProvider(browser, 'official');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      const result = await execute<null, []>(browser, '() => null');
      expect(result).toBeNull();
    });

    it('should return raw result when response is not a string', async () => {
      const mockExecute = vi.fn();
      mockExecute.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce(42);
      browser = createMockBrowser();
      setSessionProvider(browser, 'official');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      const result = await execute<number, []>(browser, '() => 42');
      expect(result).toBe(42);
    });

    it('should return undefined for __wdio_undefined__ response', async () => {
      const mockExecute = vi.fn();
      mockExecute.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce(JSON.stringify({ __wdio_undefined__: true }));
      browser = createMockBrowser();
      setSessionProvider(browser, 'official');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      const result = await execute<undefined, []>(browser, '() => undefined');
      expect(result).toBeUndefined();
    });

    it('should throw when JSON parse fails on a non-JSON string', async () => {
      const mockExecute = vi.fn();
      mockExecute.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce('not-valid-json');
      browser = createMockBrowser();
      setSessionProvider(browser, 'official');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      await expect(() => execute<string, []>(browser, '() => "fail"')).rejects.toThrow(
        /Failed to parse execute result:.*raw result: not-valid-json/,
      );
    });
  });

  describe('error wrapping', () => {
    it('should throw when response contains __wdio_error__', async () => {
      const mockExecute = vi.fn();
      mockExecute.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce(JSON.stringify({ __wdio_error__: 'something went wrong' }));
      browser = createMockBrowser();
      setSessionProvider(browser, 'official');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      await expect(() => execute<string, []>(browser, '() => "fail"')).rejects.toThrow(/something went wrong/);
    });

    it('should throw when browser.execute rejects', async () => {
      const mockExecute = vi.fn();
      mockExecute.mockResolvedValueOnce(true);
      mockExecute.mockRejectedValueOnce(new Error('WebDriver session expired'));
      browser = createMockBrowser();
      setSessionProvider(browser, 'official');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      await expect(() => execute<string, []>(browser, '() => "fail"')).rejects.toThrow('WebDriver session expired');
    });
  });
});

describe('executeTauriCommand', () => {
  let browser: WebdriverIO.Browser;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearWindowState();
    browser = createMockBrowser();
    // executeTauriCommand calls execute() which uses embedded path by default
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ value: 'command-result' }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return ok result on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ value: 'command-result' }),
      }),
    );

    const result = await executeTauriCommand<string>(browser, 'my_command', 'arg1', 'arg2');
    expect(result).toEqual({ ok: true, value: 'command-result' });
  });

  it('should return error result on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ error: 'command failed' }),
      }),
    );

    const result = await executeTauriCommand<string>(browser, 'my_command');
    assert(!result.ok);
    expect(result.error).toContain('command failed');
  });

  it('should return error result when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const result = await executeTauriCommand(browser, 'my_command');
    assert(!result.ok);
    expect(result.error).toContain('ECONNREFUSED');
  });
});

describe('executeTauriCommandWithTimeout', () => {
  let browser: WebdriverIO.Browser;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearWindowState();
    browser = createMockBrowser();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return result when command completes before timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ value: 'fast-result' }),
      }),
    );

    const result = await executeTauriCommandWithTimeout<string>(browser, 'fast_command', 5000);
    expect(result).toEqual({ ok: true, value: 'fast-result' });
  });

  it('should return error result when command times out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {})),
    );

    const promise = executeTauriCommandWithTimeout<string>(browser, 'slow_command', 100);

    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    assert(!result.ok);
    expect(result.error).toContain('timeout after 100ms');

    vi.useRealTimers();
  });

  it('should use default timeout of 30000ms', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {})),
    );

    const promise = executeTauriCommandWithTimeout<string>(browser, 'slow_command');

    await vi.advanceTimersByTimeAsync(30000);

    const result = await promise;
    assert(!result.ok);
    expect(result.error).toContain('timeout after 30000ms');

    vi.useRealTimers();
  });
});

describe('executeTauriCommands', () => {
  let browser: WebdriverIO.Browser;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearWindowState();
    browser = createMockBrowser();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should execute commands sequentially and return all results', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++;
        const value = callCount === 1 ? 'result1' : 'result2';
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ value }),
        });
      }),
    );

    const results = await executeTauriCommands<string>(browser, [
      { command: 'cmd1', args: [] },
      { command: 'cmd2', args: [] },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ ok: true, value: 'result1' });
    expect(results[1]).toEqual({ ok: true, value: 'result2' });
  });

  it('should stop at first failure', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(callCount === 1 ? { error: 'cmd1 failed' } : { value: 'ok' }),
        });
      }),
    );

    const results = await executeTauriCommands<string>(browser, [
      { command: 'cmd1', args: [] },
      { command: 'cmd2', args: [] },
      { command: 'cmd3', args: [] },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
  });

  it('should use timeout variant when timeout is specified', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ value: 'timed-result' }),
      }),
    );

    const results = await executeTauriCommands<string>(browser, [{ command: 'cmd1', args: ['a'], timeout: 5000 }]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ ok: true, value: 'timed-result' });
  });

  it('should handle empty commands array', async () => {
    const results = await executeTauriCommands(browser, []);
    expect(results).toEqual([]);
  });
});

describe('executeTauriCommandsParallel', () => {
  let browser: WebdriverIO.Browser;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearWindowState();
    browser = createMockBrowser();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should execute all commands in parallel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ value: 'parallel-result' }),
      }),
    );

    const results = await executeTauriCommandsParallel<string>(browser, [
      { command: 'cmd1', args: [] },
      { command: 'cmd2', args: [] },
      { command: 'cmd3', args: [] },
    ]);

    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.ok).toBe(true);
    }
  });

  it('should return all results including failures', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(callCount === 1 ? { value: 'ok' } : { error: 'cmd2 failed' }),
        });
      }),
    );

    const results = await executeTauriCommandsParallel<string>(browser, [
      { command: 'cmd1', args: [] },
      { command: 'cmd2', args: [] },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ ok: true, value: 'ok' });
    expect(results[1].ok).toBe(false);
  });

  it('should use timeout variant when timeout is specified', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ value: 'timed-result' }),
      }),
    );

    const results = await executeTauriCommandsParallel<string>(browser, [{ command: 'cmd1', args: [], timeout: 5000 }]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ ok: true, value: 'timed-result' });
  });

  it('should handle empty commands array', async () => {
    const results = await executeTauriCommandsParallel(browser, []);
    expect(results).toEqual([]);
  });
});

describe('isTauriApiAvailable', () => {
  let browser: WebdriverIO.Browser;

  beforeEach(() => {
    vi.restoreAllMocks();
    clearWindowState();
    browser = createMockBrowser();
  });

  it('should return true when __TAURI__ is available', async () => {
    (browser.execute as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const result = await isTauriApiAvailable(browser);
    expect(result).toBe(true);
  });

  it('should return false when __TAURI__ is not available', async () => {
    (browser.execute as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const result = await isTauriApiAvailable(browser);
    expect(result).toBe(false);
  });

  it('should return false when browser.execute throws', async () => {
    (browser.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('session not found'));

    const result = await isTauriApiAvailable(browser);
    expect(result).toBe(false);
  });
});

describe('getTauriVersion', () => {
  let browser: WebdriverIO.Browser;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearWindowState();
    browser = createMockBrowser();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return version string on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ value: '2.1.0' }),
      }),
    );

    const result = await getTauriVersion(browser);
    expect(result).toEqual({ ok: true, value: '2.1.0' });
  });

  it('should return error result on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ error: 'version not found' }),
      }),
    );

    const result = await getTauriVersion(browser);
    assert(!result.ok);
    expect(result.error).toContain('version not found');
  });
});

describe('getTauriAppInfo', () => {
  let browser: WebdriverIO.Browser;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearWindowState();
    browser = createMockBrowser();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return app info on success', async () => {
    const appInfo = { name: 'my-app', version: '1.0.0' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ value: appInfo }),
      }),
    );

    const result = await getTauriAppInfo(browser);
    expect(result).toEqual({ ok: true, value: appInfo });
  });

  it('should return error result on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ error: 'app info unavailable' }),
      }),
    );

    const result = await getTauriAppInfo(browser);
    assert(!result.ok);
    expect(result.error).toContain('app info unavailable');
  });
});
