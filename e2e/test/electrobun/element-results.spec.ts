import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

type ElementReference = { [ELEMENT_KEY]: string };

function anElementReference() {
  return { [ELEMENT_KEY]: expect.any(String) };
}

// `$` turns a reference into an element.
function idOf(ref: unknown) {
  return browser.$(ref as ElementReference).getAttribute('id');
}

// The script runs over CDP (or the Linux eval channel); the service gets its DOM nodes' references from the session.
describe('Electrobun execute — element results', () => {
  it('should return an element as a reference that element commands accept', async () => {
    const result = await browser.electrobun.execute(() => document.querySelector('#counter'));

    expect(result).toEqual(anElementReference());
    expect(await idOf(result)).toBe('counter');
  });

  it('should return each element in an array as a reference', async () => {
    const result = (await browser.electrobun.execute(() => [
      document.querySelector('#counter'),
      document.querySelector('#increment-button'),
    ])) as unknown[];

    expect(result).toEqual([anElementReference(), anElementReference()]);
    expect(await Promise.all(result.map(idOf))).toEqual(['counter', 'increment-button']);
  });

  it('should return an element inside an object as a reference', async () => {
    const result = await browser.electrobun.execute(() => ({ count: 1, el: document.querySelector('#counter') }));

    expect(result).toEqual({ count: 1, el: anElementReference() });
    expect(await idOf(result.el)).toBe('counter');
  });

  it('should return a NodeList as an array of references', async () => {
    const result = (await browser.electrobun.execute(() =>
      document.querySelectorAll('#counter, #increment-button'),
    )) as unknown as unknown[];

    expect(result).toEqual([anElementReference(), anElementReference()]);
    expect(await Promise.all(result.map(idOf))).toEqual(['counter', 'increment-button']);
  });

  it('should return an element from an async function as a reference', async () => {
    const result = await browser.electrobun.execute(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return document.querySelector('#counter');
    });

    expect(result).toEqual(anElementReference());
    expect(await idOf(result)).toBe('counter');
  });

  it('should return an element from a string script as a reference', async () => {
    const result = await browser.electrobun.execute('return document.querySelector("#increment-button")');

    expect(result).toEqual(anElementReference());
    expect(await idOf(result)).toBe('increment-button');
  });
});
