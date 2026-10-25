import { describe, expect, it, vi } from 'vitest';
import { executeAsync } from '../src/executeAsync.js';

function createBrowser(result: unknown = 'ok') {
  const executeAsyncScript = vi.fn().mockResolvedValue(result);
  return { browser: { executeAsyncScript } as unknown as WebdriverIO.Browser, executeAsyncScript };
}

describe('executeAsync', () => {
  it('should send a string script as it is', async () => {
    const { browser, executeAsyncScript } = createBrowser();
    await executeAsync(browser, 'arguments[arguments.length - 1](1)', 'a', 2);
    expect(executeAsyncScript).toHaveBeenCalledWith('arguments[arguments.length - 1](1)', ['a', 2]);
  });

  it('should call a function script with the arguments and the done callback', async () => {
    const { browser, executeAsyncScript } = createBrowser();
    const script = (value: string, done: (v: string) => void) => done(value);
    await executeAsync(browser, script, 'x');
    const [body] = executeAsyncScript.mock.calls[0];
    expect(body).toBe(`return (${script}).apply(null, arguments)`);
    const done = vi.fn();
    new Function(body).apply(null, ['x', done]);
    expect(done).toHaveBeenCalledWith('x');
  });

  it('should return the script result', async () => {
    const { browser } = createBrowser({ label: 'main' });
    await expect(executeAsync(browser, 'x')).resolves.toEqual({ label: 'main' });
  });

  it('should send an element as an element reference', async () => {
    const { browser, executeAsyncScript } = createBrowser();
    const element = { selector: '#button', elementId: 'el-1', click: vi.fn() };
    await executeAsync(browser, 'x', element, { selector: 'not an element' });
    expect(executeAsyncScript).toHaveBeenCalledWith('x', [
      { 'element-6066-11e4-a52e-4f735466cecf': 'el-1' },
      { selector: 'not an element' },
    ]);
  });

  it('should reject an element that was not found', async () => {
    const { browser, executeAsyncScript } = createBrowser();
    await expect(executeAsync(browser, 'x', { selector: '#missing', elementId: undefined })).rejects.toMatchObject({
      message: `The element with selector "#missing" you are trying to pass into the execute method wasn't found`,
    });
    expect(executeAsyncScript).not.toHaveBeenCalled();
  });
});
