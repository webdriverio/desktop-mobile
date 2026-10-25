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
 * Embedded WebDriver Console Limitation Tests
 *
 * These tests document the known limitation that console.trace() and console.debug()
 * are NOT captured when using the embedded WebDriver provider with WKWebView.
 *
 * Root cause: WebKit's evaluateJavaScript() bypasses JavaScript property overrides
 * for console.trace/debug. This is a known WebKit limitation.
 *
 * See: https://bugs.webkit.org/show_bug.cgi?id=22994
 *
 * This file is excluded from tauri-driver tests (which don't have this limitation).
 */
describe('Embedded WebDriver Console Limitations', () => {
  describe('Trace and Debug Limitation', () => {
    it('should document trace/debug limitation and console.info workaround', async () => {
      // WORKAROUND: Use console.info() with a prefix instead of console.trace()/debug()
      await browser.execute(() => {
        // Instead of: console.trace('TRACE message')
        // Use: console.info('[TRACE] TRACE message')
        console.info('[TRACE] TRACE message (using info as workaround)');

        // Instead of: console.debug('DEBUG message')
        // Use: console.info('[DEBUG] DEBUG message')
        console.info('[DEBUG] DEBUG message (using info as workaround)');
      });

      await browser.waitUntil(
        async () => {
          const logs = await readWdioLogs(getLogDir());
          return logs.includes('[TRACE]') && logs.includes('[DEBUG]');
        },
        { timeout: 5000, timeoutMsg: 'Workaround logs not captured' },
      );

      const logs = await readWdioLogs(getLogDir());
      expect(logs).toMatch(/\[TRACE\] TRACE message/s);
      expect(logs).toMatch(/\[DEBUG\] DEBUG message/s);
    });

    it('should capture console.info with trace-like prefix for debugging', async () => {
      // Test the workaround pattern for trace-level debugging
      await browser.execute(() => {
        console.info('[TRACE] Function entry: myFunction()');
        console.info('[TRACE] Variable state: x=1, y=2');
        console.info('[TRACE] Function exit: myFunction() returned true');
      });

      await browser.waitUntil(
        async () => {
          const logs = await readWdioLogs(getLogDir());
          return logs.includes('Function entry');
        },
        { timeout: 5000, timeoutMsg: 'Trace-like logs not captured' },
      );

      const logs = await readWdioLogs(getLogDir());
      expect(logs).toMatch(/\[TRACE\] Function entry/s);
      expect(logs).toMatch(/\[TRACE\] Variable state/s);
      expect(logs).toMatch(/\[TRACE\] Function exit/s);
    });

    it('should capture console.info with debug-like prefix for debugging', async () => {
      // Test the workaround pattern for debug-level logging
      await browser.execute(() => {
        console.info('[DEBUG] API request started');
        console.info('[DEBUG] API response received: 200 OK');
        console.info('[DEBUG] Data parsed successfully');
      });

      await browser.waitUntil(
        async () => {
          const logs = await readWdioLogs(getLogDir());
          return logs.includes('API request started');
        },
        { timeout: 5000, timeoutMsg: 'Debug-like logs not captured' },
      );

      const logs = await readWdioLogs(getLogDir());
      expect(logs).toMatch(/\[DEBUG\] API request started/s);
      expect(logs).toMatch(/\[DEBUG\] API response received/s);
      expect(logs).toMatch(/\[DEBUG\] Data parsed successfully/s);
    });
  });

  describe('Working Console Methods', () => {
    it('should reliably capture console.info in all contexts', async () => {
      await browser.execute(() => {
        console.info('Embedded INFO test');
      });

      await browser.waitUntil(
        async () => {
          const logs = await readWdioLogs(getLogDir());
          return logs.includes('Embedded INFO test');
        },
        { timeout: 5000, timeoutMsg: 'Info logs not captured' },
      );

      const logs = await readWdioLogs(getLogDir());
      expect(logs).toMatch(/Embedded INFO test/);
    });

    it('should reliably capture console.warn in all contexts', async () => {
      await browser.execute(() => {
        console.warn('Embedded WARN test');
      });

      await browser.waitUntil(
        async () => {
          const logs = await readWdioLogs(getLogDir());
          return logs.includes('Embedded WARN test');
        },
        { timeout: 5000, timeoutMsg: 'Warn logs not captured' },
      );

      const logs = await readWdioLogs(getLogDir());
      expect(logs).toMatch(/Embedded WARN test/);
    });

    it('should reliably capture console.error in all contexts', async () => {
      await browser.execute(() => {
        console.error('Embedded ERROR test');
      });

      await browser.waitUntil(
        async () => {
          const logs = await readWdioLogs(getLogDir());
          return logs.includes('Embedded ERROR test');
        },
        { timeout: 5000, timeoutMsg: 'Error logs not captured' },
      );

      const logs = await readWdioLogs(getLogDir());
      expect(logs).toMatch(/Embedded ERROR test/);
    });
  });
});
