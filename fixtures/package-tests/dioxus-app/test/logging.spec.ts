import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logsDir = join(__dirname, '..', 'logs');

function readAllLogs(): string {
  if (!existsSync(logsDir)) return '';
  return readdirSync(logsDir)
    .filter((f) => f.endsWith('.log'))
    .map((f) => readFileSync(join(logsDir, f), 'utf-8'))
    .join('\n');
}

describe('Dioxus log capture (package smoke)', () => {
  it('should capture frontend console logs', async () => {
    await browser.execute(() => console.info('[WDIO:Frontend] pkg-test-frontend-log'));
    await browser.pause(200);
  });

  it('should capture backend logs via generate_test_logs', async () => {
    await browser.dioxus.execute(({ invoke }) => invoke('generate_test_logs'));
    await browser.waitUntil(async () => readAllLogs().includes('pkg-test-info-log'), {
      timeout: 5000,
      timeoutMsg: 'backend log not captured within 5s',
    });
    expect(readAllLogs()).toContain('pkg-test-info-log');
  });
});
