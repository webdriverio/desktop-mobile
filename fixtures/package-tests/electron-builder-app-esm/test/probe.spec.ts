import process from 'node:process';
import { browser } from '@wdio/electron-service';

// This capability set a fork `browserVersion` the Electron→Chromium map cannot resolve, so this
// session only booted because onPrepare probed the packaged binary for its Chromium version (#578).
// Had the probe failed, onPrepare would have thrown before any session started — so a live session
// is itself the proof; the assertion below confirms the resolved version is the binary's real one.
describe('Chromium-version binary probe (#578)', () => {
  it('should boot with the Chromium version probed from the packaged binary', async () => {
    const chromeFromBinary = await browser.electron.execute(() => process.versions.chrome);

    expect(chromeFromBinary).toMatch(/^\d+\.\d+\.\d+/);
    expect(browser.capabilities.browserVersion).toBe(chromeFromBinary);
  });
});
