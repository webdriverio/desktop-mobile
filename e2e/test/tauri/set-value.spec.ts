import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';
import process from 'node:process';

/**
 * Positive coverage for Element Send Keys (setValue / addValue / clearValue) against
 * the fixture's `#repro-input`. Motivated by issue #591 Bug 2.
 *
 * All three route through POST /session/{id}/element/{id}/value with a W3C `{ text }`
 * body. This passes on the embedded provider (our own W3C-correct send_keys handler)
 * on every platform, and on the external provider off the WebKitWebDriver path
 * (e.g. Windows/WebView2).
 *
 * The external + Linux cell is known-broken UPSTREAM: tauri-driver's proxy to
 * WebKitWebDriver drops `text` ("Missing text parameter"). That cell is asserted
 * instead by set-value.linux-tripwire.spec.ts, so it is skipped here to keep the
 * green suite green.
 */
const isExternalLinux = process.env.DRIVER_PROVIDER === 'external' && process.platform === 'linux';

async function resetInput() {
  await browser.execute(() => {
    // @ts-expect-error document is a browser-context global
    const el = document.getElementById('repro-input');
    if (el) {
      el.value = '';
    }
  });
}

describe('#591 Bug 2: Element Send Keys', () => {
  beforeEach(async function () {
    if (isExternalLinux) {
      this.skip();
    }
    await resetInput();
  });

  it('setValue() types into a text input', async () => {
    const input = await browser.$('#repro-input');
    await input.setValue('hello');
    await expect(input).toHaveValue('hello');
  });

  it('addValue() appends to a text input', async () => {
    const input = await browser.$('#repro-input');
    await input.setValue('foo');
    await input.addValue('bar');
    await expect(input).toHaveValue('foobar');
  });

  it('clearValue() empties a text input', async () => {
    const input = await browser.$('#repro-input');
    await input.setValue('to-be-cleared');
    await input.clearValue();
    await expect(input).toHaveValue('');
  });

  it('WORKAROUND: browser.keys() (Actions API) types into the same input', async () => {
    const input = await browser.$('#repro-input');
    await input.click();
    await browser.keys('hello'.split(''));
    await expect(input).toHaveValue('hello');
  });
});
