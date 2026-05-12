import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import { getLogDirName, readWdioLogs } from '../../lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Only 'embedded' gets a log-dir prefix; 'external' and unset both map to the
// prefix-less directory that wdio.dioxus.conf.ts writes via getLogDirName(..., 'official').
const logProvider = process.env.DRIVER_PROVIDER === 'embedded' ? ('embedded' as const) : undefined;

function getLogDir() {
  return join(__dirname, '../../logs', getLogDirName('standard', 'dioxus', logProvider));
}

describe('Dioxus logging', () => {
  it('should capture frontend console logs', async () => {
    await browser.execute(() => console.info('[WDIO:Frontend] test-frontend-log'));
    const logs = await readWdioLogs(getLogDir());
    expect(logs.includes('test-frontend-log')).toBe(true);
  });

  it('should capture backend logs via generate_test_logs', async () => {
    await browser.dioxus.execute(({ invoke }) => invoke('generate_test_logs'));
    await browser.waitUntil(
      async () => {
        const logs = await readWdioLogs(getLogDir());
        return logs.includes('test-info-log');
      },
      { timeout: 5000, timeoutMsg: 'backend log not captured within 5 s' },
    );
  });
});
