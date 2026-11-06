import { browser, expect } from '@wdio/globals';
import { withExecuteOptions } from '@wdio/tauri-service';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const SHADOW_KEY = 'shadow-6066-11e4-a52e-4f735466cecf';

type ElementReference = { [ELEMENT_KEY]: string };

function anElementReference() {
  return { [ELEMENT_KEY]: expect.any(String) };
}

function idOf(ref: unknown) {
  return browser.$(ref as ElementReference).getAttribute('id');
}

// Workaround for #1060: CrabNebula's macOS driver sends script results back as JSON, so elements come back as `{}`
const crabNebulaOnMacOS = process.platform === 'darwin' && process.env.DRIVER_PROVIDER === 'crabnebula';
// The external providers' Linux driver is WebKitWebDriver, which sends a shadow root as an element reference (#1052)
const webKitWebDriver = process.platform === 'linux' && process.env.DRIVER_PROVIDER !== 'embedded';

// Every provider: the embedded plugin and, on the external providers, the WebDriver session turn elements in the
// result into references.
(crabNebulaOnMacOS ? describe.skip : describe)('Tauri Execute - element results from browser.tauri.execute', () => {
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

      // When WebKit fixes #1052, this check fails: drop the Linux branch then
      if (webKitWebDriver) {
        expect(result).toEqual(anElementReference());
        return;
      }
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

  it('should return a reference when the chosen window is the current one', async () => {
    const result = await browser.tauri.execute(
      () => document.querySelector('#counter'),
      withExecuteOptions({ windowLabel: 'main' }),
    );

    expect(result).toEqual(anElementReference());
    expect(await idOf(result)).toBe('counter');
  });

  it('should pass a reference from a result back to the script as its element', async () => {
    const ref = await browser.tauri.execute(() => document.querySelector('#counter'));

    const result = await browser.tauri.execute(
      (_tauri, args: { el: unknown }) => (args.el instanceof HTMLElement ? args.el.id : typeof args.el),
      { el: ref },
    );

    expect(result).toBe('counter');
  });
});

// Every provider, CrabNebula on macOS included, as these don't need a reference from a script result
describe('Tauri Execute - arguments to browser.tauri.execute', () => {
  // CrabNebula's macOS driver looks for elements only among the top-level arguments, and the service sends the user's
  // inside one array, so a reference reaches the script as a plain object (#1060). When these fail there, drop the
  // branch
  const expected = crabNebulaOnMacOS ? 'object' : 'counter';

  it('should pass a reference in an argument to the script as its element', async () => {
    const ref = { [ELEMENT_KEY]: (await browser.$('#counter')).elementId };

    const result = await browser.tauri.execute(
      (_tauri, args: { el: unknown }) => (args.el instanceof HTMLElement ? args.el.id : typeof args.el),
      { el: ref },
    );

    expect(result).toBe(expected);
  });

  it('should pass an element from browser.$() to the script as its element', async () => {
    const result = await browser.tauri.execute(
      (_tauri, el: unknown) => (el instanceof HTMLElement ? el.id : typeof el),
      await browser.$('#counter'),
    );

    expect(result).toBe(expected);
  });

  it('should pass a null argument to the script', async () => {
    expect(await browser.tauri.execute((_tauri, a: unknown, b: unknown) => [a, b], null, 1)).toEqual([null, 1]);
  });
});

// When this fails, CrabNebula's macOS driver returns references: drop this suite and run the results suite on macOS too
(crabNebulaOnMacOS ? describe : describe.skip)('Tauri Execute - element results (CrabNebula on macOS)', () => {
  it('should still return an element as an empty object', async () => {
    expect(await browser.tauri.execute(() => document.querySelector('#counter'))).toEqual({});
  });
});
