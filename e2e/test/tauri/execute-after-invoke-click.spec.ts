import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

/**
 * Repro for https://github.com/webdriverio/desktop-mobile/issues/591 — Bug 1.
 *
 * A real DOM `.click()` whose handler fires a Tauri `invoke()` (the `#invoke-button`
 * in the fixture) is reported to permanently wedge the very next
 * `browser.tauri.execute()` on the EMBEDDED provider — "Could not parse script
 * result", degrading the session to "no such window".
 *
 * The distinction from the existing api.spec.ts coverage matters: those tests call
 * invoke() *inside* a `browser.tauri.execute` round-trip (which resolves within the
 * same DirectEval). This spec fires invoke() from a genuine UI click event and then
 * issues a SEPARATE execute — the sequence nothing else in the suite exercises.
 *
 * Platform note: result delivery is platform-forked. macOS (wdioEvalResult message
 * handler + per-call registry) and Windows (postMessage + AsyncScriptState) demux
 * per call and stay healthy. Linux/WebKitGTK reads straight off
 * `call_async_javascript_function_future` on the glib main loop it shares with wry's
 * invoke() IPC, with no demux — so this is expected to go RED only on embedded+Linux
 * until packages/tauri-plugin-webdriver/src/platform/linux.rs is fixed.
 */
describe('#591 Bug 1: execute survives an invoke()-triggering click (embedded)', () => {
  it('baseline: DirectEval execute works before any click', async () => {
    expect(await browser.tauri.execute(() => 1 + 1)).toBe(2);
  });

  it('CONTROL: a DOM-only click leaves execute healthy (repeatable)', async () => {
    // #reset-button only mutates DOM state (count = 0) — no invoke().
    const reset = await browser.$('#reset-button');
    for (let i = 0; i < 3; i++) {
      await reset.click();
      expect(await browser.tauri.execute(() => 'alive')).toBe('alive');
    }
  });

  it('REPRO: a click that fires invoke() must not wedge the next execute', async () => {
    // Real WebDriver click → real DOM click event → handler fires Tauri invoke().
    await (await browser.$('#invoke-button')).click();

    // First script-execution command AFTER the invoke-triggering click. Per #591
    // this is where the embedded server wedges on Linux/WebKitGTK.
    expect(await browser.tauri.execute(() => 'alive-after-invoke-click')).toBe('alive-after-invoke-click');

    // Session must remain usable; the click's invoke() should have progressed.
    const state = await browser.tauri.execute('return window.__invokeClickState');
    expect(['started', 'resolved']).toContain(state);
  });

  it('REPRO (in-flight): execute during a still-pending invoke() must not wedge', async () => {
    // Click starts a ~2.5s slow_command invoke() that is still in-flight afterwards.
    await (await browser.$('#invoke-slow-button')).click();

    // Confirm the invoke is genuinely still pending before we poke execute. (This
    // read is itself a DirectEval — if the in-flight invoke has already wedged the
    // channel, this throws, which is the repro.)
    const inflight = await browser.tauri.execute('return window.__slowInvokeState');
    expect(inflight).toBe('in-flight');

    // Hammer execute across the in-flight window — the collision the report describes.
    for (let i = 0; i < 6; i++) {
      expect(await browser.tauri.execute((_tauri, n) => n, i)).toBe(i);
    }

    // The session must survive until the slow invoke resolves.
    await browser.waitUntil(
      async () => (await browser.tauri.execute('return window.__slowInvokeState')) === 'resolved',
      { timeout: 8000, timeoutMsg: 'slow invoke never resolved — session may be wedged' },
    );
  });
});
