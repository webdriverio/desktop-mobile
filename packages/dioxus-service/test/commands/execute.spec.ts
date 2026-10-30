import { describe, expect, it, vi } from 'vitest';

import { execute, markAsEmbedded, runInterceptorScript } from '../../src/commands/execute.js';
import { makeWebviewBrowser } from '../fakeWebview.js';

function browserStub(returnValue: unknown = undefined): WebdriverIO.Browser {
  const execute = vi.fn().mockResolvedValue(returnValue);
  return { execute } as unknown as WebdriverIO.Browser;
}

function embeddedBrowserStub(returnValue: unknown = undefined): WebdriverIO.Browser {
  const browser = browserStub(returnValue);
  markAsEmbedded(browser);
  return browser;
}

describe('execute command', () => {
  it('should pass through a string script unmodified', async () => {
    const browser = browserStub('result');
    const result = await execute(browser, 'return 1 + 2', 'arg1');

    expect(browser.execute).toHaveBeenCalledWith('return 1 + 2', 'arg1');
    expect(result).toBe('result');
  });

  it('should wrap a function script with the dx-injection scaffold', async () => {
    const browser = browserStub('value');

    await execute(
      browser,
      function userFn(dx, x: number) {
        return dx.invoke('echo', x);
      },
      42,
    );

    const [wrappedScript, ...forwardedArgs] = vi.mocked(browser.execute).mock.calls[0] as [string, ...unknown[]];
    expect(typeof wrappedScript).toBe('string');
    expect(wrappedScript).toContain('window.__WDIO_DIOXUS__');
    expect(wrappedScript).toContain('userFn');
    expect(wrappedScript).toContain('dx.invoke');
    // Args are inlined into the wrapper script as JSON literals — no extra
    // positional args are forwarded to browser.execute. This keeps the
    // wrapper portable across WDIO versions that may wrap the script body
    // in an arrow function (where `arguments` would be unavailable).
    expect(forwardedArgs).toEqual([]);
    expect(wrappedScript).toContain('userFn(dx, 42)');
  });

  it('should embed an error message when the bridge is not installed', async () => {
    const browser = browserStub();
    await execute(browser, (dx) => dx.invoke('__ping'));

    const [wrappedScript] = vi.mocked(browser.execute).mock.calls[0] as [string];
    expect(wrappedScript).toContain('window.__WDIO_DIOXUS__.invoke is not installed');
    expect(wrappedScript).toContain('wdio_dioxus::install(config)');
  });

  it('should unwrap the embedded envelope for function-form scripts', async () => {
    const browser = embeddedBrowserStub({ __wdio_value__: { hello: 'world' } });
    await expect(execute(browser, (_dx) => ({ hello: 'world' }))).resolves.toEqual({ hello: 'world' });
  });

  it('should return a plain object as-is on the external driver path (string-form)', async () => {
    const browser = browserStub({ hello: 'world' });
    await expect(execute(browser, 'return {}')).resolves.toEqual({ hello: 'world' });
  });

  it('should return a plain object as-is on the external driver path (function-form)', async () => {
    const browser = browserStub({ hello: 'world' });
    await expect(execute(browser, (_dx) => ({ hello: 'world' }))).resolves.toEqual({ hello: 'world' });
  });

  it('should return undefined when embedded function-form returns undefined', async () => {
    const browser = embeddedBrowserStub({});
    await expect(execute(browser, (_dx) => undefined)).resolves.toBeUndefined();
  });

  it('should return null when embedded function-form returns null', async () => {
    const browser = embeddedBrowserStub({ __wdio_value__: null });
    await expect(execute(browser, (_dx) => null)).resolves.toBeNull();
  });

  it('should inline multiple positional args as JSON into the wrapper', async () => {
    const browser = browserStub();
    await execute(browser, (_dx, _a: number, _b: string, _c: boolean) => null, 1, 'two', true);

    const [wrappedScript, ...forwarded] = vi.mocked(browser.execute).mock.calls[0] as [string, ...unknown[]];
    // No forwarded positional args — they're inlined into the wrapper.
    expect(forwarded).toEqual([]);
    expect(wrappedScript).toContain('userFn(dx, 1, "two", true)');
  });

  it('should JSON-serialise complex args inline', async () => {
    const browser = browserStub();
    await execute(browser, (_dx, _payload: { greeting: string }) => null, { greeting: 'hello' });

    const [wrappedScript] = vi.mocked(browser.execute).mock.calls[0] as [string];
    expect(wrappedScript).toContain('userFn(dx, {"greeting":"hello"})');
  });

  it('should throw a service-attributed error when an arg is not JSON-serialisable', async () => {
    const browser = browserStub();
    const circular: { self?: unknown } = {};
    circular.self = circular;

    await expect(execute(browser, (_dx, _p: unknown) => null, 'ok', circular)).rejects.toThrow(
      /\[wdio-dioxus-service\].*argument at index 1 is not JSON-serialisable/,
    );
    expect(browser.execute).not.toHaveBeenCalled();
  });
});

describe('runInterceptorScript', () => {
  it('should call the script with dx and resolve with its settled result', async () => {
    const browser = makeWebviewBrowser({ __WDIO_DIOXUS__: { platform: 'test' } });

    await expect(
      runInterceptorScript(browser, 'async (dx) => { await Promise.resolve(); return dx.platform; }'),
    ).resolves.toBe('test');
  });

  it("should reject with the script's error message when it rejects", async () => {
    const browser = makeWebviewBrowser({});

    await expect(runInterceptorScript(browser, 'async () => { throw new Error("boom"); }')).rejects.toMatchObject({
      message: 'boom',
    });
  });

  it("should reject with the script's error message when it throws synchronously", async () => {
    const browser = makeWebviewBrowser({});

    await expect(runInterceptorScript(browser, '() => { throw new Error("boom"); }')).rejects.toMatchObject({
      message: 'boom',
    });
  });

  it('should resolve with one result per instance on the multiremote root', async () => {
    const browser = browserStub([{ __wdio_value__: 'a' }, {}]);

    await expect(runInterceptorScript(browser, '() => "a"')).resolves.toEqual(['a', undefined]);
  });

  it('should reject when the script rejects in any instance on the multiremote root', async () => {
    const browser = browserStub([{ __wdio_value__: 'a' }, { __wdio_error__: 'boom' }]);

    await expect(runInterceptorScript(browser, '() => "a"')).rejects.toMatchObject({ message: 'boom' });
  });

  it("should resolve with the envelope's value", async () => {
    const browser = browserStub({ __wdio_value__: { calls: [['a']], results: [], invocationCallOrder: [1] } });
    const result = await runInterceptorScript(browser, '(_dx) => ({ calls: [["a"]] })');
    expect(result).toEqual({ calls: [['a']], results: [], invocationCallOrder: [1] });
  });

  it('should resolve with undefined when the envelope is empty', async () => {
    const browser = browserStub({});
    await expect(runInterceptorScript(browser, '() => undefined')).resolves.toBeUndefined();
  });
});
