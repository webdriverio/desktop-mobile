import process from 'node:process';
import { browser } from '@wdio/electron-service';

// A booted session is itself proof the probe worked (onPrepare throws otherwise, see
// wdio.probe.conf.ts); the assertion confirms the resolved version is the binary's real one.
describe('Chromium-version binary probe', () => {
  it('should boot with the Chromium version probed from the packaged binary', async () => {
    const chromeFromBinary = await browser.electron.execute(() => process.versions.chrome);

    expect(chromeFromBinary).toMatch(/^\d+\.\d+\.\d+/);
    expect(browser.capabilities.browserVersion).toBe(chromeFromBinary);
  });
});
