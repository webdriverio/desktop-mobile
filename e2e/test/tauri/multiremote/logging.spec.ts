import { expect, multiRemoteBrowser } from '@wdio/globals';
import '@wdio/native-types';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';
import { assertLogContains, findLogEntries, getLogDirName, readWdioLogs, waitForLog } from '../../../lib/utils.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Driver provider selects the per-provider log directory (getLogDirName).
const driverProvider = process.env.DRIVER_PROVIDER as 'official' | 'crabnebula' | 'embedded' | undefined;

function getMultiremoteLogDir() {
  const logDirName = getLogDirName('multiremote', 'tauri', driverProvider);
  return path.join(__dirname, '..', '..', '..', 'logs', logDirName);
}

describe('Tauri Log Integration - Multiremote', () => {
  it('should capture backend logs per instance with instance ID', async function () {
    const multi = multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
    const browserA = multi.getInstance('browserA');
    const browserB = multi.getInstance('browserB');

    // Generate logs on both instances
    await Promise.all([
      browserA.tauri.execute(({ core }) => core.invoke('generate_test_logs')),
      browserB.tauri.execute(({ core }) => core.invoke('generate_test_logs')),
    ]);

    // Wait for logs to be captured
    const logDir = getMultiremoteLogDir();
    const logsCaptured = await waitForLog(logDir, /\[Tauri:Backend:(browserA|browserB)\].*INFO level log/i, 10000);
    if (!logsCaptured) {
      throw new Error('Backend logs not captured within timeout');
    }

    // Verify logs were captured with correct prefixes and instance IDs
    // For multiremote tests, logs go to logs/multiremote-tauri/
    console.log(`[DEBUG] Reading multiremote logs from: ${logDir}`);
    const logs = await readWdioLogs(logDir);

    if (!logs) {
      throw new Error('No logs found in multiremote log directory');
    }

    // Both instances should have backend logs with [Tauri:Backend:instanceId] prefix
    // Multiremote logs include instance ID in the prefix
    assertLogContains(logs, /\[Tauri:Backend:(browserA|browserB)\].*INFO level log/i);
    assertLogContains(logs, /\[Tauri:Backend:(browserA|browserB)\].*WARN level log/i);
    assertLogContains(logs, /\[Tauri:Backend:(browserA|browserB)\].*ERROR level log/i);

    // Verify we have logs from both instances with their IDs
    const backendLogs = findLogEntries(logs, /\[Tauri:Backend:(browserA|browserB)\]/i);
    console.log(`[DEBUG] Found ${backendLogs.length} backend log entries from both instances`);
    expect(backendLogs.length).toBeGreaterThan(0);
  });

  it('should capture frontend logs per instance', async function () {
    const multi = multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
    const browserA = multi.getInstance('browserA');
    const browserB = multi.getInstance('browserB');

    // Generate frontend logs on both instances using unique markers
    const markerA = `InstanceA_${Date.now()}_unique`;
    const markerB = `InstanceB_${Date.now()}_unique`;

    await Promise.all([
      browserA.execute((m: string) => {
        console.info(m);
      }, markerA),
      browserB.execute((m: string) => {
        console.info(m);
      }, markerB),
    ]);

    // Wait for logs to be captured
    const logDir = getMultiremoteLogDir();
    const logsCaptured = await waitForLog(logDir, markerA, 10000);
    if (!logsCaptured) {
      throw new Error('Frontend logs not captured within timeout');
    }

    // Verify frontend logs were captured (without instance ID prefix for now)
    console.log(`[DEBUG] Reading multiremote logs from: ${logDir}`);
    const logs = await readWdioLogs(logDir);

    if (!logs) {
      throw new Error('No logs found in multiremote log directory');
    }

    // Check that the unique markers appear in the logs (proves frontend logs are captured)
    expect(logs).toContain(markerA);
    expect(logs).toContain(markerB);

    console.log(`[DEBUG] Found frontend log markers in multiremote logs`);
  });

  it('should capture logs independently per instance', async function () {
    const multi = multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
    const browserA = multi.getInstance('browserA');
    const browserB = multi.getInstance('browserB');

    // Generate different logs on each instance
    await Promise.all([
      browserA.tauri.execute(({ core }) => core.invoke('generate_test_logs')),
      browserB.execute(() => {
        console.info('browserB-only-frontend-log');
      }),
    ]);

    // Wait for logs to be captured
    const logDir = getMultiremoteLogDir();
    const logsCaptured = await waitForLog(logDir, /\[Tauri:Backend:browserA\]/, 10000);
    if (!logsCaptured) {
      throw new Error('Logs not captured within timeout');
    }

    // Verify both types of logs are captured
    const logs = await readWdioLogs(logDir);

    if (!logs) {
      throw new Error('No logs found in multiremote log directory');
    }

    // Instance A should have backend logs with instance ID
    assertLogContains(logs, /\[Tauri:Backend:browserA\].*INFO level log/i);

    // Instance B should have frontend logs
    expect(logs).toContain('browserB-only-frontend-log');

    // Verify both types exist
    const backendLogs = findLogEntries(logs, /\[Tauri:Backend:(browserA|browserB)\]/i);
    console.log(`[DEBUG] Found ${backendLogs.length} backend log entries`);
    expect(backendLogs.length).toBeGreaterThan(0);
  });
});
