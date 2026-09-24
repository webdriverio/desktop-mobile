import process from 'node:process';
import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import '@wdio/native-types';

/**
 * Exercises element send-keys against a real `<input>`:
 *  - value round-trips (plain text via setValue/addValue) on every provider and platform;
 *  - a special key (Enter) submits the form via a *trusted* event — gated to Windows/WebView2 +
 *    embedded, the only path that routes keys through CDP. Implicit form submission is a
 *    trusted-input gate, so Blink submits only for a trusted Enter, exactly as it needs a trusted
 *    Escape to close a modal `<dialog>` (see dialog-escape.spec.ts).
 */

const driverProvider = process.env.DRIVER_PROVIDER as 'official' | 'crabnebula' | 'embedded' | 'external' | undefined;

type FormEvent = {
  type: string;
  isTrusted: boolean;
  value: string;
};

describe('element send-keys', () => {
  beforeEach(async () => {
    await browser.execute(
      'var el = document.querySelector("#text-input"); if (el) { el.value = ""; } window.__formEvents = [];',
    );
  });

  it('should set an input value with setValue', async () => {
    const input = browser.$('#text-input');
    await input.setValue('hello');
    expect(await input.getValue()).toBe('hello');
  });

  it('should append to an input value with addValue', async () => {
    const input = browser.$('#text-input');
    await input.setValue('foo');
    await input.addValue('bar');
    expect(await input.getValue()).toBe('foobar');
  });

  it('should submit the form via a trusted Enter on Windows/WebView2 (embedded)', async function () {
    if (!(process.platform === 'win32' && driverProvider === 'embedded')) {
      this.skip();
    }

    const input = browser.$('#text-input');
    await input.setValue('query');
    await input.addValue(Key.Enter);

    await browser.waitUntil(
      async () => {
        const events = (await browser.execute('return window.__formEvents || []')) as unknown as FormEvent[];
        return events.some((event) => event.type === 'submit');
      },
      { timeout: 5000, timeoutMsg: 'form did not submit after a trusted Enter' },
    );

    const events = (await browser.execute('return window.__formEvents || []')) as unknown as FormEvent[];
    const submit = events.find((event) => event.type === 'submit');
    expect(submit).toBeDefined();
    expect(submit?.isTrusted).toBe(true);
    expect(submit?.value).toBe('query');
  });
});
