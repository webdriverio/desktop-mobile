import { browser } from '@wdio/electron-service';

// A booted session is itself proof the probe worked: a failed probe leaves the fork browserVersion
// ('1000.0.0-probe', see wdio.probe.conf.ts), which has no Chromedriver to download, so the session
// never starts. The assertion confirms the resolved version is the binary's real one.
describe('Chromium-version binary probe', () => {
  it('should boot with the Chromium version probed from the packaged binary', async () => {
    // Free global, not an import. execute() stringifies this callback into the main process.
    // Mocha 12 require()s the spec, and tsx's CJS compile renames `import process from
    // 'node:process'` to `import_node_process`, which the main process doesn't have. The
    // bridge injects globalThis.process on Windows, where Electron doesn't expose it.
    const chromeFromBinary = await browser.electron.execute(() => globalThis.process.versions.chrome);

    expect(chromeFromBinary).toMatch(/^\d+\.\d+\.\d+/);
    expect(browser.capabilities.browserVersion).toBe(chromeFromBinary);
  });
});
