import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';
import { cleanupWdioSession, createTauriCapabilities, getTauriBinaryPath, startWdioSession } from '@wdio/tauri-service';
import '@wdio/native-types';
import { xvfb } from '@wdio/xvfb';

// Get the directory name once at the top
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

process.env.TEST = 'true';

console.log('🔍 Debug: Starting standalone test for Tauri');

// Tauri app directory (always use tauri app, no exampleDir variation needed)
const appDir = path.join(__dirname, '..', '..', '..', '..', 'fixtures', 'e2e-apps', 'tauri');

if (!fs.existsSync(appDir)) {
  throw new Error(`Tauri app directory not found: ${appDir}`);
}

// Resolve binary path
const appBinaryPath = await getTauriBinaryPath(appDir);
console.log(`🔍 Using Tauri binary: ${appBinaryPath}`);

// Create session options
const driverProvider = process.env.DRIVER_PROVIDER as 'official' | 'crabnebula' | 'embedded';
const sessionOptions = createTauriCapabilities(appBinaryPath, {
  appArgs: ['foo', 'bar=baz'],
  driverProvider,
  autoInstallTauriDriver: true,
});

// Initialize xvfb if running on Linux
if (process.platform === 'linux') {
  console.log('🔍 Linux detected: initializing xvfb for standalone tests...');
  await xvfb.init();
}

console.log('🔍 Debug: Starting session with options:', JSON.stringify(sessionOptions, null, 2));
const browser = await startWdioSession(sessionOptions);

try {
  // Wait a moment to ensure browser is fully initialized with all service capabilities
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Test execute with new function syntax
  const platformInfo = await browser.tauri.execute(({ core }) => core.invoke('get_platform_info'));

  if (!platformInfo || typeof platformInfo !== 'object') {
    throw new Error(`Platform info test failed: expected object, got ${typeof platformInfo}`);
  }

  if (!('os' in platformInfo)) {
    throw new Error(`Platform info test failed: missing 'os' property`);
  }

  if (!('arch' in platformInfo)) {
    throw new Error(`Platform info test failed: missing 'arch' property`);
  }

  console.log('✅ Platform info test passed:', platformInfo);

  // Test that execute works in standalone mode
  const simpleResult = await browser.tauri.execute(() => 1 + 2);
  if (simpleResult !== 3) {
    throw new Error(`Simple execute test failed: expected 3, got ${simpleResult}`);
  }

  console.log('✅ Simple execute test passed');
} finally {
  // Clean up - quit the app and stop tauri-driver
  await browser.deleteSession();
  await cleanupWdioSession(browser);
  console.log('✅ Cleanup complete');
}

// On Windows, webdriverio's remote() leaves internal handles that prevent Node.js
// from exiting naturally. Call process.exit() to ensure the test terminates.
// On other platforms, this also ensures clean exit after standalone tests.
//
// Node 24 + Windows can trip `UV_HANDLE_CLOSING` in src/win/async.c during
// process.exit() if libuv pipe handles from WDIO's HTTP keepalive sockets are
// closed mid-teardown. Flush microtasks + give one macrotask tick before exit
// so any pending close callbacks settle first. run-matrix.ts also tolerates
// the assertion as a pass when "✅ Cleanup complete" has been printed.
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setTimeout(resolve, 50));
process.exit(0);
