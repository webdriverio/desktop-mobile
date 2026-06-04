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
describe('Electrobun Log Integration', () => {
  describe('Backend Log Capture', () => {
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

  describe('Log Infrastructure', () => {
    it('should have a non-empty log directory', async () => {
      const logs = await readWdioLogs(getLogDir());
      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
