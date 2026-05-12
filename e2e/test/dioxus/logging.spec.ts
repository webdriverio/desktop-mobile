import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import { getLogDirName, readWdioLogs } from '../../lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Dioxus logging', () => {
  it('should capture frontend console logs', async () => {
    await browser.execute(() => console.info('[WDIO:Frontend] test-frontend-log'));
    const logDir = join(__dirname, '../../logs', getLogDirName('standard', 'dioxus', 'embedded'));
    const logs = await readWdioLogs(logDir);
    expect(logs.includes('test-frontend-log')).toBe(true);
  });

  it('should capture backend logs via generate_test_logs', async () => {
    await browser.dioxus.execute(({ invoke }) => invoke('generate_test_logs'));
    const logDir = join(__dirname, '../../logs', getLogDirName('standard', 'dioxus', 'embedded'));
    await browser.waitUntil(
      async () => {
        const logs = await readWdioLogs(logDir);
        return logs.includes('test-info-log');
      },
      { timeout: 5000, timeoutMsg: 'backend log not captured within 5 s' },
    );
  });
});
