import { browser, expect } from '@wdio/globals';
import { withExecuteOptions } from '@wdio/tauri-service';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

type ElementReference = { [ELEMENT_KEY]: string };

function anElementReference() {
  return { [ELEMENT_KEY]: expect.any(String) };
}

function idOf(ref: unknown) {
  return browser.$(ref as ElementReference).getAttribute('id');
}

// CrabNebula's macOS driver sends script results back as JSON, so elements come back as `{}`
const crabNebulaOnMacOS = process.platform === 'darwin' && process.env.DRIVER_PROVIDER === 'crabnebula';
const withRefs = crabNebulaOnMacOS ? describe.skip : describe;

// The external and CrabNebula providers run the script through the WebDriver session, so the driver serialises
// elements. The embedded provider's cases are in execute-refs.embedded.spec.ts.
withRefs('Tauri Execute - element results from browser.tauri.execute (external providers)', () => {
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
});

// When this fails, CrabNebula's macOS driver returns references: drop this suite and run the one above on macOS too
(crabNebulaOnMacOS ? describe : describe.skip)('Tauri Execute - element results (CrabNebula on macOS)', () => {
  it('should still return an element as an empty object', async () => {
    expect(await browser.tauri.execute(() => document.querySelector('#counter'))).toEqual({});
  });
});
