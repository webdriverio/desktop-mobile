import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

/**
 * Regression guard for user command-override composition. The wdio.tauri.conf.ts
 * `before` hook registers a user overwriteCommand('click', ...) BEFORE the tauri
 * service's before() runs — the ordering that let the service clobber it. The
 * service registers its own element-scoped mock-sync override for `click`; it
 * must chain the user's override, not replace it. If it clobbers, the user
 * override never runs and the flag stays false.
 *
 * The flag lives on globalThis (shared with the config `before` hook in the same
 * worker process), not on the WDIO browser proxy — an arbitrary browser property
 * doesn't persist across every provider. This exercises the real WebdriverIO
 * override storage the shared installMockSyncOverride helper reaches into, which
 * the unit tests only mock.
 */
describe('Tauri user command override composition', () => {
  it('should keep the user-registered click override and chain it', async () => {
    (globalThis as unknown as Record<string, unknown>).__userClickOverrideRan = false;
    // DIAGNOSTIC (#422, temporary): the shared helper records install/fire facts.
    const diagBefore = ((globalThis as unknown as { __mockSyncDiag?: unknown[] }).__mockSyncDiag ?? []).length;

    await (await browser.$('#reset-button')).click();

    const diag = (globalThis as unknown as { __mockSyncDiag?: { phase: string }[] }).__mockSyncDiag ?? [];
    console.log('[DIAG422] userEnters:', JSON.stringify(diag.filter((d) => d.phase === 'userEnter')));
    console.log('[DIAG422] userErrors:', JSON.stringify(diag.filter((d) => d.phase === 'userError')));
    console.log('[DIAG422] userInstalls:', JSON.stringify(diag.filter((d) => d.phase === 'userInstall')));
    console.log('[DIAG422] installs:', JSON.stringify(diag.filter((d) => d.phase === 'install')));
    console.log('[DIAG422] firesThisClick:', JSON.stringify(diag.slice(diagBefore)));
    console.log('[DIAG422] clickSid:', (browser as unknown as { sessionId?: string }).sessionId);
    console.log('[DIAG422] flag:', (globalThis as unknown as Record<string, unknown>).__userClickOverrideRan);

    expect((globalThis as unknown as Record<string, unknown>).__userClickOverrideRan).toBe(true);
  });
});
