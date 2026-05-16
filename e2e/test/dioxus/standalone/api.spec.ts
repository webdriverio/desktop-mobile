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

try {
  const result = await browser.dioxus.execute('return 42');
  if (result !== 42) {
    throw new Error(`Execute test failed: expected 42, got ${result}`);
  }

  const platformInfo = await browser.dioxus.execute(({ invoke }: DioxusAPIs) => invoke('get_platform_info'));
  if (typeof platformInfo !== 'object' || platformInfo === null || !('os' in platformInfo)) {
    throw new Error(`Platform info test failed: expected object with os field, got ${JSON.stringify(platformInfo)}`);
  }
} finally {
  await browser.deleteSession().catch((e: Error) => console.error(`deleteSession failed: ${e.message}`));
  await cleanupWdioSession(browser);
}

console.log('✅ Cleanup complete');

// On Windows, webdriverio leaves internal handles that prevent clean exit without this.
// Node 24 + Windows can trip `UV_HANDLE_CLOSING` in src/win/async.c during
// process.exit() if libuv pipe handles from WDIO's HTTP keepalive sockets are
// closed mid-teardown. Flush microtasks + one macrotask tick before exit so
// any pending close callbacks settle first. run-matrix.ts also tolerates
// the assertion as a pass when "✅ Cleanup complete" has been printed.
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setTimeout(resolve, 50));
process.exit(0);
