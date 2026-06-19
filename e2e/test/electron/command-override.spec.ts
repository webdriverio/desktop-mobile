import { browser } from '@wdio/electron-service';
import { $, expect } from '@wdio/globals';

/**
 * #422 regression guard. The wdio.electron.conf.ts `before` hook registers a user
 * overwriteCommand('click', ...) BEFORE the electron service's before() runs —
 * the ordering that caused #422. The service registers its own element-scoped
 * mock-sync override for `click`; it must COMPOSE with the user's (chain it), not
 * clobber it. If it clobbers (the bug), the user override never runs and the flag
 * stays false.
 *
 * This exercises the real WebdriverIO override storage that the shared
 * installMockSyncOverride helper reaches into — the unit tests only mock it.
 */
describe('Electron user command override composition (#422)', () => {
  it('keeps the user-registered click override (service composes, not clobbers)', async () => {
    // Prevent the real OS dialog from opening when .show-dialog is clicked.
    const mockShowOpenDialog = await browser.electron.mock('dialog', 'showOpenDialog');
    await mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    (browser as unknown as Record<string, unknown>).__userClickOverrideRan = false;

    const showDialogButton = await $('.show-dialog');
    await showDialogButton.click();

    expect((browser as unknown as Record<string, boolean>).__userClickOverrideRan).toBe(true);
  });
});
