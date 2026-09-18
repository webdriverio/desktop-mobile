import { expect, multiRemoteBrowser } from '@wdio/globals';
import '@wdio/native-types';

// Two independent Electrobun instances in one worker. Run via `TEST_TYPE=multiremote`.
//
// Root fan-out (`browser.electrobun.*` across all instances) isn't wired yet:
// https://github.com/webdriverio/desktop-mobile/issues/656
//
// `globalThis as { document }` — the e2e tsconfig has no DOM lib.
type Doc = { getElementById(id: string): { id: string } | null };

const readAppTitleId = () => (globalThis as unknown as { document: Doc }).document.getElementById('app-title')?.id;

describe('Electrobun APIs using Multiremote', () => {
  it('should drive each instance independently', async () => {
    const multi = multiRemoteBrowser as WebdriverIO.MultiRemoteBrowser;

    const instanceA = multi.getInstance('instanceA');
    const instanceB = multi.getInstance('instanceB');

    expect(await instanceA.electrobun.execute(readAppTitleId)).toBe('app-title');
    expect(await instanceB.electrobun.execute(readAppTitleId)).toBe('app-title');
  });
});
