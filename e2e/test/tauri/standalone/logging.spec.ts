import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';
import { cleanupWdioSession, createTauriCapabilities, startWdioSession } from '@wdio/tauri-service';
import '@wdio/native-types';
import { xvfb } from '@wdio/xvfb';
import {
  assertLogContains,
  getLogDirName,
  readWdioLogs,
  resolveTauriFixtureBinary,
  waitForLog,
} from '../../../lib/utils.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

process.env.TEST = 'true';

// Tauri app directory
const appDir = path.join(__dirname, '..', '..', '..', '..', 'fixtures', 'e2e-apps', 'tauri');

if (!fs.existsSync(appDir)) {
  throw new Error(`Tauri app directory not found: ${appDir}`);
}

// Resolve binary path
const appBinaryPath = resolveTauriFixtureBinary(appDir);

// Get driver provider from environment
const driverProvider = process.env.DRIVER_PROVIDER as 'official' | 'crabnebula' | 'embedded';

// CrabNebula forwards an isolated session's app stdout/stderr lazily, so its logs can take
// well over 10s to arrive; the busy standard suite flushes far faster. Give these specs headroom.
const CN_LOG_TIMEOUT_MS = 30000;

// Create session options with log capture enabled
const sessionOptions = createTauriCapabilities(appBinaryPath, {
  appArgs: ['foo', 'bar=baz'],
  driverProvider,
  autoInstallTauriDriver: true,
});

// Enable log capture
const appDirName = path.basename(appDir);
const testType = 'standalone';
const logDirName = getLogDirName(testType, appDirName, driverProvider);
const logDir = path.join(__dirname, '..', '..', '..', 'logs', logDirName);
if (sessionOptions['wdio:tauriServiceOptions']) {
  sessionOptions['wdio:tauriServiceOptions'].captureBackendLogs = true;
  sessionOptions['wdio:tauriServiceOptions'].captureFrontendLogs = true;
  sessionOptions['wdio:tauriServiceOptions'].backendLogLevel = 'info';
  sessionOptions['wdio:tauriServiceOptions'].frontendLogLevel = 'info';
  sessionOptions['wdio:tauriServiceOptions'].logDir = logDir;
  console.log(`[DEBUG] Setting logDir to: ${logDir}`);
}

// Initialize xvfb if running on Linux
if (process.platform === 'linux') {
  await xvfb.init();
}

console.log('🔍 Debug: Starting Tauri standalone logging test');

const browser = await startWdioSession(sessionOptions);

try {
  // Wait for browser to be fully initialized and logs to be ready
  await browser.tauri.execute(({ core }) => core.invoke('get_platform_info'));
  await browser.waitUntil(
    async () => {
      const logs = await readWdioLogs(logDir);
      return logs.length > 0;
    },
    { timeout: 10000, timeoutMsg: 'Log infrastructure not ready' },
  );

  console.log(`[DEBUG] Test will read logs from: ${logDir}`);
  console.log(`[DEBUG] appDir: ${appDir}`);
  console.log(`[DEBUG] appDirName: ${appDirName}`);
  console.log(`[DEBUG] __dirname: ${__dirname}`);
  console.log(`[DEBUG] driverProvider: ${driverProvider}`);

  // Test 1: Capture backend logs in standalone session
  console.log('Test 1: Backend logs...');
  await browser.tauri.execute(({ core }) => core.invoke('generate_test_logs'));

  // Wait for backend logs to appear (match [Tauri:Backend] or [Tauri:Backend:worker-id])
  const backendLogsFound = await waitForLog(logDir, /\[Tauri:Backend[^\]]*\].*INFO level log/i, CN_LOG_TIMEOUT_MS);
  if (!backendLogsFound) {
    throw new Error('Backend logs not captured within timeout');
  }

  // Verify logs were captured with correct prefix
  console.log(`[DEBUG] Reading logs from: ${logDir}`);
  console.log(`[DEBUG] Directory exists: ${fs.existsSync(logDir)}`);
  if (fs.existsSync(logDir)) {
    const files = fs.readdirSync(logDir, { withFileTypes: true });
    console.log(
      `[DEBUG] Files in directory: ${files.map((f) => `${f.name} (${f.isDirectory() ? 'dir' : 'file'})`).join(', ')}`,
    );
  }
  const logs1 = await readWdioLogs(logDir);
  if (!logs1) {
    throw new Error('No logs found in output directory');
  }
  // Match [Tauri:Backend] or [Tauri:Backend:worker-id] format (with optional worker suffix)
  assertLogContains(logs1, /\[Tauri:Backend[^\]]*\].*INFO level log/i);
  assertLogContains(logs1, /\[Tauri:Backend[^\]]*\].*WARN level log/i);
  assertLogContains(logs1, /\[Tauri:Backend[^\]]*\].*ERROR level log/i);
  console.log('✅ Backend logs test passed');

  // Test 2: Capture frontend logs in standalone session
  // Frontend logs are captured via the event bridge: console → frontend-log event → Rust → stderr
  console.log('Test 2: Frontend logs...');
  await browser.execute(() => {
    console.info('[Test] Standalone frontend INFO log');
    console.warn('[Test] Standalone frontend WARN log');
    console.error('[Test] Standalone frontend ERROR log');
  });

  // Wait for frontend logs to appear
  const frontendLogsFound = await waitForLog(
    logDir,
    /\[Tauri:Frontend[^\]]*\].*Standalone frontend INFO/i,
    CN_LOG_TIMEOUT_MS,
  );
  if (!frontendLogsFound) {
    throw new Error('Frontend logs not captured within timeout');
  }

  // Verify frontend logs were captured with correct prefix
  const logs2 = await readWdioLogs(logDir);
  assertLogContains(logs2, /\[Tauri:Frontend[^\]]*\].*Standalone frontend INFO/i);
  assertLogContains(logs2, /\[Tauri:Frontend[^\]]*\].*Standalone frontend WARN/i);
  assertLogContains(logs2, /\[Tauri:Frontend[^\]]*\].*Standalone frontend ERROR/i);
  console.log('✅ Frontend logs test passed');

  // Test 3: Log level filtering - Using backend logs for verification
  console.log('Test 3: Backend log level filtering...');
  await browser.tauri.execute(({ core }) => core.invoke('generate_test_logs'));

  // Wait for backend logs to appear (match [Tauri:Backend] or [Tauri:Backend:worker-id])
  const backendFilterLogsFound = await waitForLog(logDir, /\[Tauri:Backend[^\]]*\].*INFO.*log/i, CN_LOG_TIMEOUT_MS);
  if (!backendFilterLogsFound) {
    throw new Error('Backend logs not captured within timeout');
  }

  // Verify backend logs were captured with correct prefix and levels
  // Match [Tauri:Backend] or [Tauri:Backend:worker-id] format (with optional worker suffix)
  const logs3 = await readWdioLogs(logDir);
  assertLogContains(logs3, /\[Tauri:Backend[^\]]*\].*INFO.*log/i);
  assertLogContains(logs3, /\[Tauri:Backend[^\]]*\].*WARN.*log/i);
  assertLogContains(logs3, /\[Tauri:Backend[^\]]*\].*ERROR.*log/i);
  console.log('✅ Backend log filtering test passed');

  console.log('✅ All Tauri standalone logging tests passed');
} finally {
  // Clean up - quit the app and stop tauri-driver. cleanupWdioSession() drives the
  // service's afterSession, which restores mocks (a live-session round-trip) and then
  // deletes the session itself — so we must NOT deleteSession() first, or that mock
  // restore runs against a dead session and retries "Session not found" for the full
  // connectionRetryCount (~60s) before teardown continues.
  await cleanupWdioSession(browser);
  console.log('✅ Cleanup complete');
}

// On Windows, webdriverio's remote() leaves internal handles that prevent Node.js
// from exiting naturally. Call process.exit() to ensure the test terminates.
// On other platforms, this also ensures clean exit after standalone tests.
process.exit();
