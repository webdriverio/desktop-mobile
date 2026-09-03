import process from 'node:process';
import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import '@wdio/native-types';

/**
 * #612 — a synthesized Escape must close a modal `<dialog>` opened with `showModal()`.
 *
 * The embedded driver used to dispatch keys as JS `KeyboardEvent`s (`isTrusted: false`). On
 * Windows/WebView2 (Blink) CloseWatcher ignores an untrusted Escape, so the dialog never closed;
 * macOS/WKWebView and Linux/WebKitGTK are lenient and close it anyway, and the external
 * (msedgedriver / WebKitWebDriver) path sends trusted keys. The Windows CDP key path makes the
 * Escape trusted. The behavioural specs run on every provider/OS — they were RED only on
 * Windows + embedded before the fix.
 */

const driverProvider = process.env.DRIVER_PROVIDER as 'official' | 'crabnebula' | 'embedded' | 'external' | undefined;

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

describe('modal <dialog> Escape close-request (#612)', () => {
  it('browser.keys(Escape) closes the modal dialog', async () => {
    await openDialog();
    await browser.keys(Key.Escape);
    await waitForDialogClosed();
  });

  it('key Actions API (down/up Escape) closes the modal dialog', async () => {
    await openDialog();
    await browser.action('key').down(Key.Escape).up(Key.Escape).perform();
    await waitForDialogClosed();
  });

  // Mechanism guard: only the Windows + embedded path is the one the fix newly routes through CDP
  // to make keys trusted. Elsewhere the key is untrusted (WebKit closes anyway) or already trusted
  // (external msedgedriver), so asserting isTrusted there would test the platform, not the fix.
  it('Escape reaches the page as a trusted event on Windows/WebView2 (embedded)', async function () {
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
