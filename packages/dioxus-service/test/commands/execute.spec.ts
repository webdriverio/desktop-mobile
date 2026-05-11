import { describe, expect, it, vi } from 'vitest';

import { execute } from '../../src/commands/execute.js';

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
    expect(forwardedArgs).toEqual([42]);
  });

  it('should embed an error message when the bridge is not installed', async () => {
    const browser = browserStub();
    await execute(browser, (dx) => dx.invoke('__ping'));

    const [wrappedScript] = vi.mocked(browser.execute).mock.calls[0] as [string];
    expect(wrappedScript).toContain('window.__WDIO_DIOXUS__.invoke is not installed');
    expect(wrappedScript).toContain('wdio_dioxus_bridge::install');
  });

  it('should return the value produced by browser.execute', async () => {
    const browser = browserStub({ hello: 'world' });
    await expect(execute(browser, 'return {}')).resolves.toEqual({ hello: 'world' });
  });

  it('should forward multiple positional args to browser.execute', async () => {
    const browser = browserStub();
    await execute(browser, (_dx, _a: number, _b: string, _c: boolean) => null, 1, 'two', true);

    const [, ...forwarded] = vi.mocked(browser.execute).mock.calls[0] as [string, ...unknown[]];
    expect(forwarded).toEqual([1, 'two', true]);
  });
});
