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

// The embedded driver serialises script results itself. Chromedriver sends an element as a reference.
describe('Dioxus execute — element references (embedded)', () => {
  describe('browser.execute', () => {
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

    // An async function goes through Execute Async Script.
    it('should return an element from an async function as a reference', async () => {
      const result = await browser.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return document.querySelector('#counter');
      });

      expect(result).toEqual(anElementReference());
      expect(await idOf(result)).toBe('counter');
    });

    it('should return an HTMLCollection from an async function as an array of references', async () => {
      const result = (await browser.execute(async () => document.getElementsByTagName('body'))) as unknown as unknown[];

      expect(result).toEqual([anElementReference()]);
      expect(await browser.$(result[0] as ElementReference).getTagName()).toBe('body');
    });
  });

  // A function goes through a promise that wraps its result in an envelope, so the driver converts the awaited value.
  describe('browser.dioxus.execute', () => {
    it('should return an element as a reference that element commands accept', async () => {
      const result = await browser.dioxus.execute(() => document.querySelector('#counter'));

      expect(result).toEqual(anElementReference());
      expect(await idOf(result)).toBe('counter');
    });

    it('should return an element inside an object as a reference', async () => {
      const result = await browser.dioxus.execute(() => ({ count: 1, el: document.querySelector('#counter') }));

      expect(result).toEqual({ count: 1, el: anElementReference() });
      expect(await idOf(result.el)).toBe('counter');
    });

    it('should return an element from an async function as a reference', async () => {
      const result = await browser.dioxus.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return document.querySelector('#counter');
      });

      expect(result).toEqual(anElementReference());
      expect(await idOf(result)).toBe('counter');
    });
  });
});
