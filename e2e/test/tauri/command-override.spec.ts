import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

/**
 * #422 regression guard. The wdio.tauri.conf.ts `before` hook registers a user
 * overwriteCommand('click', ...) BEFORE the tauri service's before() runs — the
 * exact ordering that caused #422. The service registers its own element-scoped
 * mock-sync override for `click`; it must COMPOSE with the user's (chain it),
 * not clobber it. If it clobbers (the bug), the user override never runs and the
 * flag stays false.
 *
 * This exercises the real WebdriverIO override storage that the shared
 * installMockSyncOverride helper reaches into — the unit tests only mock it.
 */
describe('Tauri user command override composition (#422)', () => {
  it('keeps the user-registered click override (service composes, not clobbers)', async () => {
    (browser as unknown as Record<string, unknown>).__userClickOverrideRan = false;

    await (await browser.$('#reset-button')).click();

    expect((browser as unknown as Record<string, boolean>).__userClickOverrideRan).toBe(true);
  });
});
