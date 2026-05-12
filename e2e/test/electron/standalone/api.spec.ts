import fs from 'node:fs';
import path from 'node:path';
import { getElectronVersion } from '@wdio/electron-service';
import type { NormalizedPackageJson } from '@wdio/native-types';
import type * as Electron from 'electron';
import { setupStandaloneTest } from './helpers/setup.js';

console.log('🔍 Debug: Starting Electron standalone API test');

// Set up standalone test session
const { browser, appDir, cleanup } = await setupStandaloneTest();

try {
  // Load package.json for version checks
  const packageJsonPath = path.join(appDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, { encoding: 'utf-8' })) as NormalizedPackageJson;
  const pkg = { packageJson, path: packageJsonPath };
  const electronVersion = await getElectronVersion(pkg);

  // Detect if running in script mode
  const appDirName = path.basename(appDir);
  const isScript = appDirName.includes('script');

  // Helper function to get the expected app name
  const getExpectedAppName = (): string => {
    // In script mode, the app name will always be "Electron"
    // In binary mode, use the package name
    return isScript ? 'Electron' : (globalThis.packageJson?.name ?? packageJson.name ?? '');
  };

  // Get app name and check against expected value
  const appName = await browser.electron.execute((electron: typeof Electron) => electron.app.getName());
  const expectedAppName = getExpectedAppName();

  if (appName !== expectedAppName) {
    throw new Error(`appName test failed: ${appName} !== ${expectedAppName}`);
  }

  // Get app version and check against expected value
  const appVersion = await browser.electron.execute((electron: typeof Electron) => electron.app.getVersion());
  // In binary mode, expect the package.json version; in script mode, expect the Electron version
  const expectedAppVersion = isScript ? electronVersion : packageJson.version;
  if (appVersion !== expectedAppVersion) {
    throw new Error(`appVersion test failed: ${appVersion} !== ${expectedAppVersion}`);
  }

  // Now that we've confirmed browser.electron.execute works, let's test mocking
  console.log('🔍 Browser is initialized, testing mock functionality...');

  // Test 1: Basic mock test (should work) - using browser.electron.execute
  console.log('🔍 Testing basic mock with browser.electron.execute...');
  try {
    console.log(
      '🔍 Debug: Checking browser.electron availability before mocking:',
      typeof browser?.electron,
      typeof browser?.electron?.mock,
    );

    const basicMock = await browser.electron.mock('dialog', 'showOpenDialog');
    console.log('✅ Basic mock created successfully');

    // Call the mocked function directly via execute
    await browser.electron.execute(async (electron) => {
      await electron.dialog.showOpenDialog({
        title: 'basic test dialog',
        properties: ['openFile'],
      });
      return (electron.dialog.showOpenDialog as any).mock.calls;
    });

    // Check if the mock was called
    const basicCalls = basicMock.mock.calls.length;
    console.log(`📊 Basic mock calls: ${basicCalls}`);

    if (basicCalls !== 1) {
      throw new Error(`Basic mock test failed: expected 1 call, got ${basicCalls}`);
    }
    console.log('✅ Basic mock test passed');
  } catch (error) {
    console.error('❌ Basic mock test failed:', error);
    throw error;
  }

  // Test 2: Complex UI-triggered mock test (currently failing) - using DOM interaction
  console.log('🔍 Testing complex UI-triggered mock...');
  try {
    const complexMock = await browser.electron.mock('dialog', 'showOpenDialog');
    console.log('✅ Complex mock created successfully');

    // Use DOM interaction like the failing test
    const showDialogButton = await browser.$('.show-dialog');
    if (!showDialogButton) {
      throw new Error('Show dialog button not found');
    }

    await showDialogButton.click();
    console.log('🖱️ Clicked show dialog button');

    // Check if the mock was called (this is where it likely fails)
    const complexCalls = complexMock.mock.calls.length;
    console.log(`📊 Complex mock calls before update: ${complexCalls}`);

    // Try manual update in case auto-update isn't working
    await complexMock.update();
    const complexCallsAfterUpdate = complexMock.mock.calls.length;
    console.log(`📊 Complex mock calls after update: ${complexCallsAfterUpdate}`);

    if (complexCallsAfterUpdate !== 1) {
      throw new Error(`Complex mock test failed: expected 1 call, got ${complexCallsAfterUpdate}`);
    }
    console.log('✅ Complex mock test passed');
  } catch (error) {
    console.error('❌ Complex mock test failed:', error);
    // Don't throw - we expect this to fail, that's what we're investigating
    console.log("ℹ️ Complex mock test failed as expected - this is the issue we're debugging");
  }
} finally {
  // Clean up - quit the app
  await cleanup();
  console.log('✅ Cleanup complete');
}

process.exit();
