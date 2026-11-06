import { browser, expect } from '@wdio/globals';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

type ElementReference = { [ELEMENT_KEY]: string };

function anElementReference() {
  return { [ELEMENT_KEY]: expect.any(String) };
}

// `$` turns a returned reference back into an element.
function idOf(ref: unknown) {
  return browser.$(ref as ElementReference).getAttribute('id');
}

// Chromedriver returns an element as a reference. The embedded driver serialises results itself, so it has to match.
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

    // Async functions take a separate driver path, Execute Async Script.
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

  // The service resolves a function's result inside an envelope, and the driver converts the value in it.
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
