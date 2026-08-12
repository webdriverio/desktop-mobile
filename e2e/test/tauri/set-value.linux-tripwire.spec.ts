// Tripwire for #591 Bug 2 — Element Send Keys under the external provider (tauri-driver
// + native WebKitWebDriver) on Linux.
//
// On external + Linux, upstream tauri-driver's proxy to WebKitWebDriver drops the W3C
// `text` field on POST /element/{id}/value, so setValue()/addValue()/clearValue() fail
// with "Missing text parameter". @wdio/tauri-service is a pure orchestrator here and
// never touches that body (our own embedded driver handles `text` correctly — see
// set-value.spec.ts). The positive spec therefore skips this cell; this spec is the
// inverse: it runs ONLY on external + Linux and asserts setValue STILL fails. While the
// upstream bug is open it passes; the moment setValue succeeds it fails — the signal to
// remove this tripwire, drop the external+Linux skip in set-value.spec.ts, and update #591.
//
// Scoping: WebKitWebDriver-specific. The external provider off Linux (Windows/WebView2)
// is unaffected, so the inverse assertion would false-fire there — hence the guard below
// and the config exclusion outside external+Linux.
import { browser } from '@wdio/globals';
import '@wdio/native-types';
import process from 'node:process';

const isExternalLinux = process.platform === 'linux' && process.env.DRIVER_PROVIDER === 'external';
const MISSING_TEXT = /Missing text parameter/i;

describe('#591 Bug 2 setValue tripwire (upstream tauri-driver)', () => {
  it('setValue should STILL fail with "Missing text parameter" on external+Linux (fails when upstream is fixed)', async function () {
    if (!isExternalLinux) {
      this.skip();
    }

    await browser.execute(() => {
      // @ts-expect-error document is a browser-context global
      const el = document.getElementById('repro-input');
      if (el) {
        el.value = '';
      }
    });

    const input = await browser.$('#repro-input');

    let failedWithMissingText = false;
    try {
      await input.setValue('hello');
    } catch (err) {
      // Only the specific "Missing text parameter" failure is the healthy state while the
      // upstream bug is open. Any other error (session crash, I/O, …) is a real failure —
      // re-throw so it can't masquerade as a green tripwire.
      if (err instanceof Error && MISSING_TEXT.test(err.message)) {
        failedWithMissingText = true;
      } else {
        throw err;
      }
    }

    if (!failedWithMissingText) {
      throw new Error(
        'setValue() no longer fails with "Missing text parameter" on external tauri-driver + ' +
          'WebKitWebDriver — the upstream bug looks fixed. Remove this tripwire, drop the ' +
          'external+Linux skip in set-value.spec.ts, and update #591.',
      );
    }
  });
});
