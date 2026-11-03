import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const SHADOW_KEY = 'shadow-6066-11e4-a52e-4f735466cecf';

type ElementReference = { [ELEMENT_KEY]: string };

function anElementReference() {
  return { [ELEMENT_KEY]: expect.any(String) };
}

// WebdriverIO returns a script's result as the driver sends it; `$` turns a reference into an element.
function idOf(ref: unknown) {
  return browser.$(ref as ElementReference).getAttribute('id');
}

describe('Tauri Execute - Advanced Patterns', () => {
  it('should pass multiple parameters to execute function', async () => {
    const result = await browser.tauri.execute((_tauri, a, b, c) => a + b + c, 10, 20, 30);
    expect(result).toBe(60);
  });

  it('should handle destructured parameters', async () => {
    const result = await browser.tauri.execute((_tauri, { name, value }) => `${name}: ${value}`, {
      name: 'test',
      value: 42,
    });
    expect(result).toBe('test: 42');
  });

  it('should execute async function with multiple Tauri commands', async () => {
    const result = await browser.tauri.execute(async ({ core }) => {
      const info1 = (await core.invoke('get_platform_info')) as { os: string };
      const info2 = (await core.invoke('get_platform_info')) as { os: string };
      return { os: info1.os, same: info1.os === info2.os };
    });
    expect(result?.same).toBe(true);
    expect(result?.os).toBeTruthy();
  });

  it('should handle functions with inner function declarations', async () => {
    // Note: Using string form to avoid TypeScript/esbuild __name transpilation issues
    const result = await browser.tauri.execute(`(tauri) => {
      function helper(x) { return x * 2; }
      return helper(21);
    }`);
    expect(result).toBe(42);
  });

  it('should handle functions with inner arrow functions', async () => {
    // Note: Using string form to avoid TypeScript/esbuild __name transpilation issues
    const result = await browser.tauri.execute(`(tauri) => {
      const helper = (x) => x * 2;
      return helper(21);
    }`);
    expect(result).toBe(42);
  });

  it('should propagate errors from execute function', async () => {
    await expect(
      browser.tauri.execute(() => {
        throw new Error('Test error from execute');
      }),
    ).rejects.toThrow('Test error from execute');
  });

  it('should handle promise rejections in execute', async () => {
    await expect(
      browser.tauri.execute(async () => {
        return await Promise.reject(new Error('Async error'));
      }),
    ).rejects.toThrow('Async error');
  });

  it('should provide clear error for invalid Tauri commands', async () => {
    await expect(browser.tauri.execute(({ core }) => core.invoke('nonexistent_command'))).rejects.toThrow();
  });
});

// The embedded driver serialises script results itself. Chromedriver sends an element as a reference.
describe('Tauri Execute - element results (embedded)', () => {
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

  it('should return a shadow root as a reference that shadow root commands accept', async () => {
    const result = (await browser.execute(() => {
      const host = document.createElement('div');
      host.id = 'element-results-shadow-host';
      document.body.append(host);
      host.attachShadow({ mode: 'open' }).innerHTML = '<span id="in-shadow"></span>';
      return host.shadowRoot;
    })) as unknown as Record<string, string>;

    try {
      expect(result).toEqual({ [SHADOW_KEY]: expect.any(String) });
      const inShadow = await browser.findElementFromShadowRoot(result[SHADOW_KEY], 'css selector', '#in-shadow');
      expect(await idOf(inShadow)).toBe('in-shadow');
    } finally {
      await browser.execute(() => document.querySelector('#element-results-shadow-host')?.remove());
    }
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

  it('should return elements nested in an async function result as references', async () => {
    const result = (await browser.execute(async () => ({
      list: [document.querySelector('#counter')],
    }))) as { list: unknown[] };

    expect(result).toEqual({ list: [anElementReference()] });
    expect(await idOf(result.list[0])).toBe('counter');
  });
});
