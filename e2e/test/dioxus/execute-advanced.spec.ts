import { browser, expect } from '@wdio/globals';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

type ElementReference = { [ELEMENT_KEY]: string };

function anElementReference() {
  return { [ELEMENT_KEY]: expect.any(String) };
}

// WebdriverIO returns a script's result as the driver sends it; `$` turns a reference into an element.
function idOf(ref: unknown) {
  return browser.$(ref as ElementReference).getAttribute('id');
}

describe('Dioxus execute — advanced', () => {
  it('should execute expression string', async () => {
    expect(await browser.dioxus.execute('return 1 + 2 + 3')).toBe(6);
  });

  it('should execute multi-statement string', async () => {
    const r = await browser.dioxus.execute(`
      const x = 10;
      const y = 20;
      return x + y;
    `);
    expect(r).toBe(30);
  });

  it('should receive dioxus APIs even with no user args', async () => {
    const r = await browser.dioxus.execute((dx) => ({ hasInvoke: typeof dx?.invoke === 'function' }));
    expect(r.hasInvoke).toBe(true);
  });

  it('should forward multiple user args', async () => {
    const r = await browser.dioxus.execute((_dx, a, b, c) => [a, b, c], 'x', 'y', 'z');
    expect(r).toEqual(['x', 'y', 'z']);
  });

  it('should handle null / undefined return', async () => {
    expect(await browser.dioxus.execute('return null')).toBeNull();
  });

  it('should throw for bridge errors surfaced in functions', async () => {
    await expect(
      browser.dioxus.execute((_dx, msg) => {
        throw new Error(msg as string);
      }, 'test-error'),
    ).rejects.toThrow('test-error');
  });
});

// The embedded driver serialises script results itself. Chromedriver sends an element as a reference.
describe('Dioxus execute — element results (embedded)', () => {
  before(function () {
    if (process.env.DRIVER_PROVIDER !== 'embedded') {
      this.skip();
    }
  });

  it('should return an element as a reference that element commands accept', async () => {
    const result = await browser.execute(() => document.querySelector('#counter'));

    expect(result).toEqual(anElementReference());
    expect(await idOf(result)).toBe('counter');
  });

  it('should return each element in an array as a reference', async () => {
    const result = (await browser.execute(() => [
      document.querySelector('#counter'),
      document.querySelector('#increment-button'),
    ])) as unknown[];

    expect(result).toEqual([anElementReference(), anElementReference()]);
    expect(await Promise.all(result.map(idOf))).toEqual(['counter', 'increment-button']);
  });

  it('should return an element inside an object as a reference', async () => {
    const result = (await browser.execute(() => ({ count: 1, el: document.querySelector('#counter') }))) as {
      count: number;
      el: unknown;
    };

    expect(result).toEqual({ count: 1, el: anElementReference() });
    expect(await idOf(result.el)).toBe('counter');
  });

  // An async function goes through Execute Async Script.
  it('should return an element from an async function as a reference', async () => {
    const result = await browser.execute(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return document.querySelector('#counter');
    });

    expect(result).toEqual(anElementReference());
    expect(await idOf(result)).toBe('counter');
  });
});
