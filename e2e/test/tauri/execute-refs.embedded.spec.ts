import { browser, expect } from '@wdio/globals';

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

// The embedded driver serialises script results itself. Chromedriver sends an element as a reference.
describe('Tauri Execute - element results (embedded)', () => {
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

  it('should return a NodeList as an array of references', async () => {
    const result = (await browser.execute(() =>
      document.querySelectorAll('#counter, #increment-button'),
    )) as unknown as unknown[];

    expect(result).toEqual([anElementReference(), anElementReference()]);
    expect(await Promise.all(result.map(idOf))).toEqual(['counter', 'increment-button']);
  });

  it('should return a shadow root as a reference that shadow root commands accept', async () => {
    try {
      const result = (await browser.execute(() => {
        const host = document.createElement('div');
        host.id = 'element-results-shadow-host';
        document.body.append(host);
        host.attachShadow({ mode: 'open' }).innerHTML = '<span id="in-shadow"></span>';
        return host.shadowRoot;
      })) as unknown as Record<string, string>;

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

  it('should return an HTMLCollection from an async function as an array of references', async () => {
    const result = (await browser.execute(async () => document.getElementsByTagName('body'))) as unknown as unknown[];

    expect(result).toEqual([anElementReference()]);
    expect(await browser.$(result[0] as ElementReference).getTagName()).toBe('body');
  });
});

// Embedded only: the external providers run browser.tauri.execute() through the plugin's IPC, which returns plain JSON.
describe('Tauri Execute - element results from browser.tauri.execute (embedded)', () => {
  it('should return an element as a reference that element commands accept', async () => {
    const result = await browser.tauri.execute(() => document.querySelector('#counter'));

    expect(result).toEqual(anElementReference());
    expect(await idOf(result)).toBe('counter');
  });

  it('should return each element in an array as a reference', async () => {
    const result = (await browser.tauri.execute(() => [
      document.querySelector('#counter'),
      document.querySelector('#increment-button'),
    ])) as unknown[];

    expect(result).toEqual([anElementReference(), anElementReference()]);
    expect(await Promise.all(result.map(idOf))).toEqual(['counter', 'increment-button']);
  });

  it('should return an element next to a command result as a reference', async () => {
    const result = (await browser.tauri.execute(async ({ core }) => ({
      os: ((await core.invoke('get_platform_info')) as { os: string }).os,
      el: document.querySelector('#counter'),
    }))) as { os: string; el: unknown };

    expect(result).toEqual({ os: expect.any(String), el: anElementReference() });
    expect(await idOf(result.el)).toBe('counter');
  });

  it('should return a NodeList as an array of references', async () => {
    const result = (await browser.tauri.execute(() =>
      document.querySelectorAll('#counter, #increment-button'),
    )) as unknown as unknown[];

    expect(result).toEqual([anElementReference(), anElementReference()]);
    expect(await Promise.all(result.map(idOf))).toEqual(['counter', 'increment-button']);
  });

  it('should return a shadow root as a reference that shadow root commands accept', async () => {
    try {
      const result = (await browser.tauri.execute(() => {
        const host = document.createElement('div');
        host.id = 'tauri-execute-shadow-host';
        document.body.append(host);
        host.attachShadow({ mode: 'open' }).innerHTML = '<span id="in-shadow"></span>';
        return host.shadowRoot;
      })) as unknown as Record<string, string>;

      expect(result).toEqual({ [SHADOW_KEY]: expect.any(String) });
      const inShadow = await browser.findElementFromShadowRoot(result[SHADOW_KEY], 'css selector', '#in-shadow');
      expect(await idOf(inShadow)).toBe('in-shadow');
      expect(
        await browser.tauri.execute(
          (_tauri, root: unknown) => (root instanceof ShadowRoot ? root.querySelector('span')?.id : typeof root),
          result,
        ),
      ).toBe('in-shadow');
    } finally {
      await browser.execute(() => document.querySelector('#tauri-execute-shadow-host')?.remove());
    }
  });

  it('should return an element from a string script as a reference', async () => {
    const result = await browser.tauri.execute("document.querySelector('#counter')");

    expect(result).toEqual(anElementReference());
    expect(await idOf(result)).toBe('counter');
  });

  it('should pass a reference in an argument to the script as its element', async () => {
    const ref = await browser.tauri.execute(() => document.querySelector('#counter'));

    const result = await browser.tauri.execute(
      (_tauri, args: { el: unknown }) => (args.el instanceof HTMLElement ? args.el.id : typeof args.el),
      { el: ref },
    );

    expect(result).toBe('counter');
  });

  it('should pass an element from browser.$() to the script as its element', async () => {
    const result = await browser.tauri.execute(
      (_tauri, el: unknown) => (el instanceof HTMLElement ? el.id : typeof el),
      await browser.$('#counter'),
    );

    expect(result).toBe('counter');
  });
});
