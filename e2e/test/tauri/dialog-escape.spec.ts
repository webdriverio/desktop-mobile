import process from 'node:process';
import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import '@wdio/native-types';

/**
 * The trusted-event assertion is gated to Windows + embedded, the only path that routes keys
 * through CDP; Blink needs a trusted Escape to close a modal `<dialog>`, while WebKit (macOS/Linux)
 * closes on the untrusted synthetic key too.
 */

const driverProvider = process.env.DRIVER_PROVIDER as 'official' | 'crabnebula' | 'embedded' | 'external' | undefined;

// CrabNebula's macOS key path doesn't fire the modal dialog's close-request. Tracked in
// https://github.com/webdriverio/desktop-mobile/issues/674.
const skipDialogClose = driverProvider === 'crabnebula' && process.platform === 'darwin';

type DialogEvent = {
  phase: string;
  type: string;
  key: string;
  isTrusted: boolean;
  defaultPrevented: boolean;
};

async function openDialog() {
  await browser.$('#open-dialog').click();
  await browser.$('#test-dialog').waitForDisplayed();
  const open = (await browser.execute(
    'return !!(document.querySelector("#test-dialog") && document.querySelector("#test-dialog").open)',
  )) as boolean;
  expect(open).toBe(true);
}

async function waitForDialogClosed() {
  await browser.waitUntil(
    async () => {
      const open = (await browser.execute(
        'return !!(document.querySelector("#test-dialog") && document.querySelector("#test-dialog").open)',
      )) as boolean;
      return open === false;
    },
    { timeout: 5000, timeoutMsg: 'modal <dialog> did not close after Escape' },
  );
}

describe('modal <dialog> Escape close-request', () => {
  it('should close the modal dialog when Escape is sent via browser.keys', async function () {
    if (skipDialogClose) {
      this.skip();
    }
    await openDialog();
    await browser.keys(Key.Escape);
    await waitForDialogClosed();
  });

  it('should close the modal dialog when Escape is sent via the Actions API', async function () {
    if (skipDialogClose) {
      this.skip();
    }
    await openDialog();
    await browser.action('key').down(Key.Escape).up(Key.Escape).perform();
    await waitForDialogClosed();
  });

  it('should deliver Escape as a trusted event on Windows/WebView2 (embedded)', async function () {
    if (!(process.platform === 'win32' && driverProvider === 'embedded')) {
      this.skip();
    }

    await openDialog();
    await browser.keys(Key.Escape);
    await waitForDialogClosed();

    const events = (await browser.execute('return window.__dialogEvents || []')) as DialogEvent[];
    const trustedEscapeDown = events.find(
      (event) => event.type === 'keydown' && event.key === 'Escape' && event.isTrusted === true,
    );
    expect(trustedEscapeDown).toBeDefined();

    const cancel = events.find((event) => event.type === 'cancel');
    expect(cancel).toBeDefined();
  });
});
