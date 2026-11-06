import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const SHADOW_KEY = 'shadow-6066-11e4-a52e-4f735466cecf';

type ElementReference = { [ELEMENT_KEY]: string };

function anElementReference() {
  return { [ELEMENT_KEY]: expect.any(String) };
}

function idOf(ref: unknown) {
  return browser.$(ref as ElementReference).getAttribute('id');
}

// The script runs over CDP, or the eval channel on Linux, and the service reads its DOM nodes' references
// through the WebDriver session.
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

  it('should return an element that appears twice as the same reference both times', async () => {
    const result = (await browser.electrobun.execute(() => {
      const counter = document.querySelector('#counter');
      return [counter, { again: counter }];
    })) as unknown as [ElementReference, { again: ElementReference }];

    expect(result).toEqual([anElementReference(), { again: anElementReference() }]);
    expect(result[1].again).toEqual(result[0]);
    expect(await idOf(result[1].again)).toBe('counter');
  });

  it('should return a shadow root as a reference that shadow root commands accept', async () => {
    try {
      const result = (await browser.electrobun.execute(() => {
        const host = document.createElement('div');
        host.id = 'element-results-shadow-host';
        document.body.append(host);
        host.attachShadow({ mode: 'open' }).innerHTML = '<span id="in-shadow"></span>';
        return host.shadowRoot;
      })) as unknown as Record<string, string>;

      // WebKitWebDriver sends a shadow root as an element reference (#1052). When WebKit fixes that, this check
      // fails: drop the Linux branch then, and close the issue.
      if (process.platform === 'linux') {
        expect(result).toEqual(anElementReference());
        return;
      }
      expect(result).toEqual({ [SHADOW_KEY]: expect.any(String) });
      const inShadow = await browser.findElementFromShadowRoot(result[SHADOW_KEY], 'css selector', '#in-shadow');
      expect(await idOf(inShadow)).toBe('in-shadow');
    } finally {
      await browser.electrobun.execute(() => document.querySelector('#element-results-shadow-host')?.remove());
    }
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
