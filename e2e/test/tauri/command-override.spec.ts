import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

/**
 * Regression guard for user command-override composition (#422/#443). The
 * wdio.tauri.conf.ts / wdio.tauri-embedded.conf.ts `before` hook registers a user
 * overwriteCommand('click', ...) BEFORE the tauri service's before() runs — the
 * ordering that let the service clobber it. The service registers its own
 * element-scoped mock-sync override for `click` via installMockSyncOverride; it
 * must chain the user's override, not replace it. If it clobbers, the user
 * override never runs and the flag stays false.
 *
 * The flag lives on globalThis (shared with the config `before` hook in the same
 * worker process), not on the WDIO browser proxy — an arbitrary browser property
 * doesn't persist across every tauri provider. This exercises the real
 * WebdriverIO override storage the shared installMockSyncOverride helper reaches
 * into, which the unit tests only mock. Verified green on every provider,
 * including the external-WebKitWebDriver ones (official Linux + macOS embedded)
 * that #443 had flagged.
 */
describe('Tauri user command override composition', () => {
  it('should keep the user-registered click override and chain it', async () => {
    (globalThis as unknown as Record<string, unknown>).__userClickOverrideRan = false;

    const increment = await browser.$('#increment-button');
    await increment.click();

    expect((globalThis as unknown as Record<string, unknown>).__userClickOverrideRan).toBe(true);
  });
});
