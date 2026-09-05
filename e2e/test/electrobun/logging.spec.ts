import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';
import path from 'node:path';
import url from 'node:url';
import { getLogDirName, readWdioLogs } from '../../lib/utils.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function getLogDir() {
  const testType = (process.env.TEST_TYPE as string) || 'standard';
  const logDirName = getLogDirName(testType, 'electrobun');
  return path.join(__dirname, '..', '..', 'logs', logDirName);
}

// The service forwards the Electrobun Bun backend's stdout/stderr into the WDIO
// log when `captureBackendLogs` is set (wdio.electrobun.conf.ts). The fixture's
// Bun backend (fixtures/e2e-apps/electrobun/src/bun/index.ts) prints '[e2e]'
// startup lines, which the launcher tags with a '[backend]' prefix.
// Skipped on Linux: the WebKitGTK/W3C driver owns the app process, so the service can't forward its stdout.
const describeBackend = process.platform === 'linux' ? describe.skip : describe;
// Frontend log capture on Linux/WebKitGTK is an injected console shim (no CDP console events over
// W3C). Assert it intercepts real console.* in the live webview; the drain into the WDIO log is
// unit-tested (webdriverEval.spec) and runs at session teardown.
const describeFrontend = process.platform === 'linux' ? describe : describe.skip;

describe('Electrobun Log Integration', () => {
  describeBackend('Backend Log Capture', () => {
    it('should capture the Bun backend stdout in the WDIO log', async () => {
      await browser.waitUntil(
        async () => {
          const logs = await readWdioLogs(getLogDir());
          return logs.includes('[backend]');
        },
        { timeout: 10000, timeoutMsg: 'Backend logs not captured' },
      );

      const logs = await readWdioLogs(getLogDir());
      expect(logs).toMatch(/\[backend\].*\[e2e\]/s);
    });

    it('should capture the backend ready marker', async () => {
      const logs = await readWdioLogs(getLogDir());
      expect(logs).toContain('bun backend ready');
    });
  });

  describeFrontend('Frontend Log Capture (WebKitGTK console shim)', () => {
    it('should capture webview console.* via the injected shim', async () => {
      const marker = `wdio-shim-${Date.now()}`;
      await browser.electrobun.execute((_eb, m) => {
        console.log(m, 'from-log');
        console.warn(m, 'from-warn');
        console.error(m, 'from-error');
      }, marker);

      type LogEntry = { level: string; args: string[] };
      const captured = (await browser.electrobun.execute(
        () => (globalThis as unknown as { __WDIO_ELECTROBUN_LOGS__?: LogEntry[] }).__WDIO_ELECTROBUN_LOGS__ ?? [],
      )) as LogEntry[];

      const levels = captured.filter((e) => e.args.some((a) => a.includes(marker))).map((e) => e.level);
      expect(levels).toContain('log');
      expect(levels).toContain('warn');
      expect(levels).toContain('error');
    });
  });

  describe('Log Infrastructure', () => {
    it('should have a non-empty log directory', async () => {
      const logs = await readWdioLogs(getLogDir());
      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
