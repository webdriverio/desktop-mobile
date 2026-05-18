import path from 'node:path';
import url from 'node:url';
import { assertLogContains, assertLogDoesNotContain, readWdioLogs, waitForLog } from '../../../lib/utils.js';
import { setupStandaloneTest } from './helpers/setup.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Determine log directory based on app
const appDirName = path.basename(process.env.APP_DIR || 'electron-builder');
const logDir = path.join(__dirname, '..', '..', '..', 'logs', `standalone-${appDirName}`);

console.log('🔍 Debug: Starting Electron standalone logging test');

// Set up standalone test session with log capture enabled
const { browser, cleanup } = await setupStandaloneTest({
  logConfig: {
    captureMainProcessLogs: true,
    captureRendererLogs: true,
    mainProcessLogLevel: 'info',
    rendererLogLevel: 'info',
    logDir,
  },
});

try {
  // Test 1: Capture main process logs in standalone session
  console.log('Test 1: Main process logs...');
  await browser.electron.execute(() => {
    console.info('[Test] Standalone main process INFO log');
    console.warn('[Test] Standalone main process WARN log');
    console.error('[Test] Standalone main process ERROR log');
  });

  // Wait for main process logs to appear
  const mainLogsFound = await waitForLog(logDir, /\[Electron:MainProcess\].*\[Test\].*INFO log/i, 10000);
  if (!mainLogsFound) {
    throw new Error('Main process logs not captured within timeout');
  }

  // Verify logs were captured with correct prefix
  const logs1 = await readWdioLogs(logDir);
  if (!logs1) {
    throw new Error('No logs found in output directory');
  }
  assertLogContains(logs1, /\[Electron:MainProcess\].*\[Test\].*INFO log/i);
  assertLogContains(logs1, /\[Electron:MainProcess\].*\[Test\].*WARN log/i);
  assertLogContains(logs1, /\[Electron:MainProcess\].*\[Test\].*ERROR log/i);
  console.log('✅ Main process logs test passed');

  // Test 2: Capture renderer logs in standalone session
  console.log('Test 2: Renderer logs...');
  await browser.execute(() => {
    console.info('[Test] Standalone renderer INFO log');
    console.warn('[Test] Standalone renderer WARN log');
    console.error('[Test] Standalone renderer ERROR log');
  });

  // Wait for renderer logs to appear
  const rendererLogsFound = await waitForLog(
    logDir,
    /\[Electron:Renderer\].*\[Test\].*Standalone renderer INFO/i,
    10000,
  );
  if (!rendererLogsFound) {
    throw new Error('Renderer logs not captured within timeout');
  }

  // Verify renderer logs were captured with correct prefix
  const logs2 = await readWdioLogs(logDir);
  assertLogContains(logs2, /\[Electron:Renderer\].*\[Test\].*Standalone renderer INFO/i);
  assertLogContains(logs2, /\[Electron:Renderer\].*\[Test\].*Standalone renderer WARN/i);
  assertLogContains(logs2, /\[Electron:Renderer\].*\[Test\].*Standalone renderer ERROR/i);
  console.log('✅ Renderer logs test passed');

  // Test 3: Filter logs by level in standalone session
  console.log('Test 3: Log level filtering...');
  await browser.electron.execute(() => {
    console.debug('[Test] This main DEBUG log should be filtered out');
    console.info('[Test] This main INFO log should appear');
  });
  await browser.execute(() => {
    console.debug('[Test] This renderer DEBUG log should be filtered out');
    console.info('[Test] This renderer INFO log should appear');
  });

  // Wait for logs to appear
  const filterLogsFound = await waitForLog(logDir, /\[Electron:MainProcess\].*INFO.*should appear/i, 10000);
  if (!filterLogsFound) {
    throw new Error('Logs not captured within timeout');
  }

  // Verify DEBUG logs are filtered out (info level filtering)
  const logs3 = await readWdioLogs(logDir);
  assertLogDoesNotContain(logs3, /\[Electron:MainProcess\].*DEBUG.*should be filtered/i);
  assertLogDoesNotContain(logs3, /\[Electron:Renderer\].*DEBUG.*should be filtered/i);
  assertLogContains(logs3, /\[Electron:MainProcess\].*INFO.*should appear/i);
  assertLogContains(logs3, /\[Electron:Renderer\].*INFO.*should appear/i);
  console.log('✅ Log filtering test passed');

  console.log('✅ All Electron standalone logging tests passed');
} finally {
  // Clean up - quit the app
  await cleanup();
  console.log('✅ Cleanup complete');
}

process.exit();
