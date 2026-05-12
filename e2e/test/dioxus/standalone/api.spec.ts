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

const capabilities = createDioxusCapabilities(appBinaryPath, {
  appArgs: ['foo', 'bar=baz'],
  driverProvider: 'embedded',
});

const browser = await startWdioSession(capabilities);

const result = await browser.dioxus.execute('return 42');
if (result !== 42) {
  throw new Error(`execute test failed: expected 42, got ${result}`);
}
console.log('✅ execute test passed');

const platformInfo = await browser.dioxus.execute(({ invoke }: DioxusAPIs) => invoke('get_platform_info'));
if (!platformInfo || typeof platformInfo !== 'object' || !('os' in (platformInfo as object))) {
  throw new Error(`platform info test failed: got ${JSON.stringify(platformInfo)}`);
}
console.log('✅ platform info test passed:', platformInfo);

await browser.deleteSession();
await cleanupWdioSession(browser);
console.log('✅ cleanup complete');

process.exit();
