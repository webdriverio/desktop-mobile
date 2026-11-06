import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execute, executeWithElementRefs } from '../../src/commands/execute.js';
import { CONSOLE_WRAPPER_SCRIPT } from '../../src/scripts/console-wrapper.js';
import { clearWindowState } from '../../src/window.js';
import { setCurrentWindowLabel, setSessionProvider } from '../../src/windowState.js';

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
    executeAsyncScript: vi.fn(),
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

  describe('element references', () => {
    const ref = { 'element-6066-11e4-a52e-4f735466cecf': 'p-0' };

    function sentBody(mockFn: ReturnType<typeof vi.fn>) {
      return JSON.parse(mockFn.mock.calls[0][1].body as string) as Record<string, unknown>;
    }

    it("should send the session's ID and the arguments, for the plugin to turn nodes into references and back", async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);
      const sessionBrowser = Object.assign(createMockBrowser(), { sessionId: 'session-1' });

      await executeWithElementRefs(sessionBrowser, (_tauri, el: unknown) => el, ref);

      expect(sentBody(mockFn)).toMatchObject({ session_id: 'session-1', args: [ref] });
    });

    it('should send the arguments without the execute options', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);
      const sessionBrowser = Object.assign(createMockBrowser(), { sessionId: 'session-1' });

      await executeWithElementRefs(
        sessionBrowser,
        'return arguments[0]',
        { __wdioOptions__: true, windowLabel: 'second' },
        ref,
      );

      expect(sentBody(mockFn)).toMatchObject({ window_label: 'second', args: [ref] });
    });

    it('should send a WebdriverIO element in the arguments as its reference', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);
      const sessionBrowser = Object.assign(createMockBrowser(), { sessionId: 'session-1' });
      const element = { selector: '#counter', elementId: 'p-0', parent: sessionBrowser };

      await executeWithElementRefs(sessionBrowser, (_tauri, el: unknown) => el, element);

      const body = sentBody(mockFn);
      expect(body.args).toEqual([ref]);
      expect(body.script).toContain(JSON.stringify([ref]));
    });

    it('should leave arguments without a reference inlined in the script alone', async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);
      const sessionBrowser = Object.assign(createMockBrowser(), { sessionId: 'session-1' });

      await executeWithElementRefs(sessionBrowser, (_tauri, data: string) => data, 'x'.repeat(1000));

      const body = sentBody(mockFn);
      expect(body).toMatchObject({ session_id: 'session-1' });
      expect(body).not.toHaveProperty('args');
      expect(body.script).toContain('x'.repeat(1000));
    });

    it("should send no session or arguments for the service's own scripts", async () => {
      const mockFn = mockFetch({ value: 1 });
      vi.stubGlobal('fetch', mockFn);
      const sessionBrowser = Object.assign(createMockBrowser(), { sessionId: 'session-1' });

      await execute(sessionBrowser, (_tauri, n: number) => n, 1);

      expect(sentBody(mockFn)).not.toHaveProperty('session_id');
      expect(sentBody(mockFn)).not.toHaveProperty('args');
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

describe('execute — external and CrabNebula providers (WebDriver)', () => {
  let browser: WebdriverIO.Browser;

  function externalBrowser(outcome?: unknown) {
    const b = createMockBrowser(() => true);
    setSessionProvider(b, 'external');
    (b.executeAsyncScript as ReturnType<typeof vi.fn>).mockResolvedValue(outcome ?? { ok: true, value: null });
    return b;
  }

  function sentScript(b: WebdriverIO.Browser): string {
    return (b.executeAsyncScript as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  }

  function sentArgs(b: WebdriverIO.Browser): unknown[] {
    return (b.executeAsyncScript as ReturnType<typeof vi.fn>).mock.calls[0][1] as unknown[];
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    clearWindowState();
    browser = externalBrowser();
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
      (browser.execute as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const promise = execute(browser, '() => 1').catch((e: Error) => e);

      for (let i = 0; i < 100; i++) {
        await vi.advanceTimersByTimeAsync(50);
      }

      const result = await promise;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain(
        'Tauri plugin not available. Make sure @wdio/tauri-plugin is installed and registered in your Tauri app.',
      );
      expect(browser.executeAsyncScript).not.toHaveBeenCalled();
    });

    it('should succeed when plugin becomes available after retries', async () => {
      vi.useFakeTimers();
      (browser.execute as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      (browser.executeAsyncScript as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, value: 'result' });

      const promise = execute<string, []>(browser, '() => "result"');

      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(50);
      }

      expect(await promise).toBe('result');
      expect(browser.execute).toHaveBeenCalledTimes(4);
      expect(browser.executeAsyncScript).toHaveBeenCalledTimes(1);
    });

    it('should use cached result on second call with same browser', async () => {
      await execute(browser, '() => 1');
      await execute(browser, '() => 2');

      expect(browser.execute).toHaveBeenCalledTimes(1);
      expect(browser.executeAsyncScript).toHaveBeenCalledTimes(2);
    });

    it('should not share cache between different browser objects', async () => {
      const browser1 = externalBrowser();
      const browser2 = externalBrowser();

      await execute(browser1, '() => 1');
      await execute(browser2, '() => 2');

      expect(browser1.execute).toHaveBeenCalledTimes(1);
      expect(browser2.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('browser.tauri.execute(), in the page', () => {
    it("should run a function in the page with the user's args as the script's own arguments", async () => {
      const fn = (_tauri: unknown, a: number, b: number) => a + b;
      await executeWithElementRefs<number, [number, number]>(browser, fn, 1, 2);

      expect(sentScript(browser)).toContain(`await (${fn.toString()})(__wdio_tauri, ...__wdio_args)`);
      expect(sentArgs(browser)).toEqual([1, 2]);
    });

    it('should send an element as a reference, for the driver to turn into the element', async () => {
      const ref = { 'element-6066-11e4-a52e-4f735466cecf': 'el-1' };
      const element = { elementId: 'el-1', selector: '#counter' } as unknown as WebdriverIO.Element;

      await executeWithElementRefs(browser, (_tauri, el: unknown) => el, element);

      expect(sentArgs(browser)).toEqual([ref]);
    });

    it('should run a string script in the page', async () => {
      await executeWithElementRefs<string, []>(browser, 'return "hello"');

      expect(sentScript(browser)).toContain('(async function() { return "hello" }).apply(null, __wdio_args)');
    });

    it('should install console forwarding before the script', async () => {
      await executeWithElementRefs(browser, '() => 1');

      expect(sentScript(browser).startsWith(CONSOLE_WRAPPER_SCRIPT)).toBe(true);
    });

    it('should leave out the IPC route when no window is chosen', async () => {
      await executeWithElementRefs(browser, '() => 1');

      expect(sentScript(browser)).not.toContain('wdioTauri.execute');
      expect(sentArgs(browser)).toEqual([]);
    });

    it('should send a per-call window label to the page, which picks the route', async () => {
      await executeWithElementRefs(
        browser,
        '(tauri, a) => a',
        { __wdioOptions__: true, windowLabel: 'popup' } as never,
        7,
      );

      expect(sentScript(browser)).toContain('window.wdioTauri.execute(');
      expect(sentArgs(browser)).toEqual(['popup', '(tauri, a) => a', '[7]', 7]);
    });

    it("should send the session's window label after a switch", async () => {
      setCurrentWindowLabel(browser, 'settings');

      await executeWithElementRefs(browser, '() => 1');

      expect(sentArgs(browser)).toEqual(['settings', '() => 1', '[]']);
    });
  });

  // The service's own scripts, such as the focus check before each element command, go through the plugin, which
  // answers at once in a frame or page without it
  describe("the service's own scripts, through the plugin", () => {
    it('should send the script and its args to the plugin, with no window chosen', async () => {
      await execute(browser, '(tauri, a) => a', 7);

      expect(sentScript(browser)).toContain('window.wdioTauri.execute(');
      expect(sentArgs(browser)).toEqual([null, '(tauri, a) => a', '[7]']);
    });

    it("should send the session's window label after a switch", async () => {
      setCurrentWindowLabel(browser, 'settings');

      await execute(browser, '() => 1');

      expect(sentArgs(browser)).toEqual(['settings', '() => 1', '[]']);
    });
  });

  describe('result', () => {
    it('should return the value as the driver sends it, element references included', async () => {
      const ref = { 'element-6066-11e4-a52e-4f735466cecf': 'el-1' };
      browser = externalBrowser({ ok: true, value: { count: 1, el: ref } });

      expect(await execute(browser, () => ({ count: 1, el: document.body }))).toEqual({ count: 1, el: ref });
    });

    it('should return null', async () => {
      browser = externalBrowser({ ok: true, value: null, undef: false });

      expect(await execute(browser, '() => null')).toBeNull();
    });

    it('should return undefined when the script returned undefined', async () => {
      browser = externalBrowser({ ok: true, value: null, undef: true });

      expect(await execute(browser, '() => undefined')).toBeUndefined();
    });

    it("should throw the script's error", async () => {
      browser = externalBrowser({ ok: false, error: 'Test error from execute' });

      await expect(execute(browser, '() => { throw new Error("x") }')).rejects.toMatchObject({
        message: 'Test error from execute',
      });
    });

    it('should reject when Execute Async Script rejects', async () => {
      (browser.executeAsyncScript as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('script timeout'));

      await expect(execute(browser, '() => 1')).rejects.toMatchObject({ message: 'script timeout' });
    });
  });
});
