import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execute } from '../../src/commands/execute.js';
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

function createMockBrowser(executeFn?: (...args: unknown[]) => unknown, port?: number) {
  return {
    execute: vi.fn(executeFn ?? (() => undefined)),
    options: { port },
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
          json: vi.fn().mockResolvedValue(failing ? { error: 'A JavaScript exception occurred. (code 4)' } : { value }),
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

    it('does not retry an enriched WebKit exception (real detail after the code)', async () => {
      // describe_ns_error appends the real message/location after "(code N)", so this is a
      // deterministic exception, not the opaque cold-webview one — it must fail immediately.
      vi.stubGlobal(
        'fetch',
        mockFetch(
          { error: 'A JavaScript exception occurred. (code 4): ReferenceError: foo is not defined @ 5:10' },
          false,
          500,
        ),
      );
      await expect(execute(browser, '() => foo')).rejects.toThrow(/ReferenceError: foo is not defined/);
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

  describe('port selection', () => {
    afterEach(() => {
      delete process.env.TAURI_WEBDRIVER_PORT;
    });

    it("should evaluate on the session's own port", async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);
      await execute(createMockBrowser(undefined, 45783), '() => 1');
      expect(mockFn.mock.calls[0][0]).toBe('http://127.0.0.1:45783/wdio/eval');
    });

    it('should prefer the session port over TAURI_WEBDRIVER_PORT', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);
      process.env.TAURI_WEBDRIVER_PORT = '9000';
      await execute(createMockBrowser(undefined, 45783), '() => 1');
      expect(mockFn.mock.calls[0][0]).toBe('http://127.0.0.1:45783/wdio/eval');
    });

    it('should evaluate each multiremote instance on its own port', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);
      await execute(createMockBrowser(undefined, 4445), '() => 1');
      await execute(createMockBrowser(undefined, 4446), '() => 2');
      expect(mockFn.mock.calls[0][0]).toBe('http://127.0.0.1:4445/wdio/eval');
      expect(mockFn.mock.calls[1][0]).toBe('http://127.0.0.1:4446/wdio/eval');
    });

    it('should fall back to TAURI_WEBDRIVER_PORT when the session has no port', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);
      process.env.TAURI_WEBDRIVER_PORT = '9000';
      await execute(browser, '() => 1');
      expect(mockFn.mock.calls[0][0]).toBe('http://127.0.0.1:9000/wdio/eval');
    });

    it('should fall back to 4445 when neither the session nor the env var sets a port', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);
      await execute(browser, '() => 1');
      expect(mockFn.mock.calls[0][0]).toBe('http://127.0.0.1:4445/wdio/eval');
    });
  });
});

describe('execute — IPC provider (external/crabnebula)', () => {
  let browser: WebdriverIO.Browser;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    clearWindowState();
    browser = createMockBrowser();
    // Set provider to external so the IPC path is taken
    setSessionProvider(browser, 'external');
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
      setSessionProvider(browser, 'external');
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
        if (callCount <= 3) {
          return Promise.resolve(false);
        }
        if (callCount === 4) {
          return Promise.resolve(true);
        }
        return Promise.resolve(JSON.stringify({ __wdio_value__: 'result' }));
      });
      browser = createMockBrowser();
      setSessionProvider(browser, 'external');
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
        if (callCount === 1) {
          return Promise.resolve(true);
        }
        return Promise.resolve(JSON.stringify({ __wdio_value__: 'result' }));
      });
      browser = createMockBrowser();
      setSessionProvider(browser, 'external');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      await execute<string, []>(browser, '() => "result"');
      const firstCallCount = callCount;

      await execute<string, []>(browser, '() => "result2"');

      expect(callCount).toBe(firstCallCount + 1);
    });

    it('should not share cache between different browser objects', async () => {
      const browser1 = createMockBrowser();
      const browser2 = createMockBrowser();
      setSessionProvider(browser1, 'external');
      setSessionProvider(browser2, 'external');
      const calls1: number[] = [];
      const calls2: number[] = [];

      let count1 = 0;
      (browser1.execute as ReturnType<typeof vi.fn>).mockImplementation(() => {
        count1++;
        calls1.push(count1);
        if (count1 === 1) {
          return Promise.resolve(true);
        }
        return Promise.resolve(JSON.stringify({ __wdio_value__: 'b1' }));
      });

      let count2 = 0;
      (browser2.execute as ReturnType<typeof vi.fn>).mockImplementation(() => {
        count2++;
        calls2.push(count2);
        if (count2 === 1) {
          return Promise.resolve(true);
        }
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
      setSessionProvider(browser, 'external');
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
      setSessionProvider(browser, 'external');
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
      setSessionProvider(browser, 'external');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      const result = await execute<{ foo: string }, []>(browser, '() => ({ foo: "bar" })');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('should return null __wdio_value__', async () => {
      const mockExecute = vi.fn();
      mockExecute.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce(JSON.stringify({ __wdio_value__: null }));
      browser = createMockBrowser();
      setSessionProvider(browser, 'external');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      const result = await execute<null, []>(browser, '() => null');
      expect(result).toBeNull();
    });

    it('should return raw result when response is not a string', async () => {
      const mockExecute = vi.fn();
      mockExecute.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce(42);
      browser = createMockBrowser();
      setSessionProvider(browser, 'external');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      const result = await execute<number, []>(browser, '() => 42');
      expect(result).toBe(42);
    });

    it('should return undefined for __wdio_undefined__ response', async () => {
      const mockExecute = vi.fn();
      mockExecute.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce(JSON.stringify({ __wdio_undefined__: true }));
      browser = createMockBrowser();
      setSessionProvider(browser, 'external');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      const result = await execute<undefined, []>(browser, '() => undefined');
      expect(result).toBeUndefined();
    });

    it('should throw when JSON parse fails on a non-JSON string', async () => {
      const mockExecute = vi.fn();
      mockExecute.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce('not-valid-json');
      browser = createMockBrowser();
      setSessionProvider(browser, 'external');
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
      setSessionProvider(browser, 'external');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      await expect(() => execute<string, []>(browser, '() => "fail"')).rejects.toThrow(/something went wrong/);
    });

    it('should throw when browser.execute rejects', async () => {
      const mockExecute = vi.fn();
      mockExecute.mockResolvedValueOnce(true);
      mockExecute.mockRejectedValueOnce(new Error('WebDriver session expired'));
      browser = createMockBrowser();
      setSessionProvider(browser, 'external');
      (browser.execute as ReturnType<typeof vi.fn>).mockImplementation(mockExecute);

      await expect(() => execute<string, []>(browser, '() => "fail"')).rejects.toThrow('WebDriver session expired');
    });
  });
});
