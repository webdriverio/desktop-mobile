import { browser, expect, multiRemoteBrowser } from '@wdio/globals';
import '@wdio/native-types';

// Two independent Electrobun instances driven in one worker (multiremote). WebView2 isolates
// each instance (its own process + `LOCALAPPDATA` data dir), which the CEF renderer can't —
// so this suite is Windows-only (run via `TEST_TYPE=multiremote`). The fixture loads `mainview`
// (with `#app-title`) in each instance.
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

  it('should fan execute out to both instances', async () => {
    // A multiremote `browser.<service>.*` call runs on every instance and returns one
    // result per instance.
    const ids = await browser.electrobun.execute(readAppTitleId);

    expect(Array.isArray(ids)).toBe(true);
    expect(ids).toEqual(['app-title', 'app-title']);
  });
});
