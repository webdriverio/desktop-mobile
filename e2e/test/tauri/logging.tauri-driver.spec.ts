import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';
import { getLogDirName, readWdioLogs } from '../../lib/utils.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const driverProvider = process.env.DRIVER_PROVIDER as 'external' | 'crabnebula' | 'embedded' | undefined;

function getLogDir() {
  const logDirName = getLogDirName('standard', 'tauri', driverProvider);
  return path.join(__dirname, '..', '..', 'logs', logDirName);
}

/**
 * Tauri-Driver Console Capture Tests
 *
 * These tests verify console method capture works correctly with tauri-driver.
 * Includes tests for console.trace() and console.debug() which are NOT captured
 * in embedded WebDriver mode due to WebKit's evaluateJavaScript() bypassing
 * JavaScript property overrides.
 *
 * This file is excluded from embedded WebDriver tests.
 *
 * See: https://bugs.webkit.org/show_bug.cgi?id=22994
 */
describe('Console Trace and Debug Capture', () => {
  it('should capture console.trace from browser.execute', async () => {
    await browser.execute(() => {
      console.trace('TRACE from execute');
    });

    await browser.waitUntil(
      async () => {
        const logs = await readWdioLogs(getLogDir());
        return logs.includes('TRACE from execute');
      },
      { timeout: 5000, timeoutMsg: 'Trace logs not captured' },
    );

    const logs = await readWdioLogs(getLogDir());
    expect(logs).toMatch(/\[Tauri:Frontend[^\]]*\].*TRACE from execute/s);
  });

  it('should capture console.debug from browser.execute', async () => {
    await browser.execute(() => {
      console.debug('DEBUG from execute');
    });

    await browser.waitUntil(
      async () => {
        const logs = await readWdioLogs(getLogDir());
        return logs.includes('DEBUG from execute');
      },
      { timeout: 5000, timeoutMsg: 'Debug logs not captured' },
    );

    const logs = await readWdioLogs(getLogDir());
    expect(logs).toMatch(/\[Tauri:Frontend[^\]]*\].*DEBUG from execute/s);
  });

  it('should capture all console methods in a single call', async () => {
    await browser.execute(() => {
      console.trace('ALL TRACE from execute');
      console.debug('ALL DEBUG from execute');
      console.info('ALL INFO from execute');
      console.warn('ALL WARN from execute');
      console.error('ALL ERROR from execute');
    });

    await browser.waitUntil(
      async () => {
        const logs = await readWdioLogs(getLogDir());
        return logs.includes('ALL TRACE from execute');
      },
      { timeout: 5000, timeoutMsg: 'Console logs not captured' },
    );

    const logs = await readWdioLogs(getLogDir());
    expect(logs).toMatch(/\[Tauri:Frontend[^\]]*\].*ALL TRACE from execute/s);
    expect(logs).toMatch(/\[Tauri:Frontend[^\]]*\].*ALL DEBUG from execute/s);
    expect(logs).toMatch(/\[Tauri:Frontend[^\]]*\].*ALL INFO from execute/s);
    expect(logs).toMatch(/\[Tauri:Frontend[^\]]*\].*ALL WARN from execute/s);
    expect(logs).toMatch(/\[Tauri:Frontend[^\]]*\].*ALL ERROR from execute/s);
  });
});
