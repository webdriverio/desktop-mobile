import { expect, multiRemoteBrowser } from '@wdio/globals';
import '@wdio/native-types';
import type { PageWindow } from '../../../lib/pageGlobals.js';

// Two independent Electrobun instances in one worker. Run via `TEST_TYPE=multiremote`.
//
// Root fan-out (`browser.electrobun.*` across all instances) isn't wired yet:
// https://github.com/webdriverio/desktop-mobile/issues/656

const readAppTitleId = () => (globalThis as unknown as PageWindow).document.getElementById('app-title')?.id;

describe('Electrobun APIs using Multiremote', () => {
  it('should drive each instance independently', async () => {
    const multi = multiRemoteBrowser as WebdriverIO.MultiRemoteBrowser;

    const instanceA = multi.getInstance('instanceA');
    const instanceB = multi.getInstance('instanceB');

    expect(await instanceA.electrobun.execute(readAppTitleId)).toBe('app-title');
    expect(await instanceB.electrobun.execute(readAppTitleId)).toBe('app-title');
  });
});
