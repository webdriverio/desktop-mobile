import path from 'node:path';
import process from 'node:process';
import url from 'node:url';
import { cleanupWdioSession, createDioxusCapabilities, startWdioSession } from '@wdio/dioxus-service';
import type { DioxusAPIs } from '@wdio/native-types';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const appBinaryPath = path.join(
  __dirname,
  '../../../../fixtures/e2e-apps/dioxus/target/debug',
  process.platform === 'win32' ? 'wdio-dioxus-e2e-app.exe' : 'wdio-dioxus-e2e-app',
);

const browser = await startWdioSession(
  createDioxusCapabilities(appBinaryPath, {
    appArgs: ['foo', 'bar=baz'],
    driverProvider: 'embedded',
    embeddedPort: 4447,
  }),
);

const result = await browser.dioxus.execute('return 42');
if (result !== 42) {
  throw new Error(`Execute test failed: expected 42, got ${result}`);
}

const platformInfo = await browser.dioxus.execute(({ invoke }: DioxusAPIs) => invoke('get_platform_info'));
if (typeof platformInfo !== 'object' || platformInfo === null || !('os' in platformInfo)) {
  throw new Error(`Platform info test failed: expected object with os field, got ${JSON.stringify(platformInfo)}`);
}

await browser.deleteSession();
await cleanupWdioSession(browser);

// On Windows, webdriverio leaves internal handles that prevent clean exit without this.
process.exit();
