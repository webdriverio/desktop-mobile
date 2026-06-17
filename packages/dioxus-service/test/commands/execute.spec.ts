import { describe, expect, it, vi } from 'vitest';

import { execute, runInterceptorScript } from '../../src/commands/execute.js';

function browserStub(returnValue: unknown = undefined): WebdriverIO.Browser {
  const execute = vi.fn().mockResolvedValue(returnValue);
  return { execute } as unknown as WebdriverIO.Browser;
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
    expect(wrappedScript).toContain('wdio_dioxus_bridge::install');
  });

  it('should return the value produced by browser.execute', async () => {
    const browser = browserStub({ __wdio_value__: { hello: 'world' } });
    await expect(execute(browser, 'return {}')).resolves.toEqual({ hello: 'world' });
  });

  it('should return undefined when the embedded driver returns the empty envelope (undefined result)', async () => {
    const browser = browserStub({});
    await expect(execute(browser, 'return undefined')).resolves.toBeUndefined();
  });

  it('should return null when the embedded driver returns a null-valued envelope', async () => {
    const browser = browserStub({ __wdio_value__: null });
    await expect(execute(browser, 'return null')).resolves.toBeNull();
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
  it('should wrap the script as `return (script)()` so arrow functions actually invoke', async () => {
    const browser = browserStub('ok');
    const adapterScript = '(_dx) => { window.__wdio_mocks__.greet = 42; }';

    await runInterceptorScript(browser, adapterScript);

    const [actualScript] = vi.mocked(browser.execute).mock.calls[0] as [string];
    expect(actualScript).toBe(`return (${adapterScript})()`);
  });

  it('should return the value produced by browser.execute', async () => {
    const browser = browserStub({ __wdio_value__: { calls: [['a']], results: [], invocationCallOrder: [1] } });
    const result = await runInterceptorScript(browser, '(_dx) => ({ calls: [["a"]] })');
    expect(result).toEqual({ calls: [['a']], results: [], invocationCallOrder: [1] });
  });

  it('should return undefined when the embedded driver returns the empty envelope', async () => {
    const browser = browserStub({});
    await expect(runInterceptorScript(browser, '() => undefined')).resolves.toBeUndefined();
  });
});
