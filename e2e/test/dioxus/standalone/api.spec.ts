import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@wdio/globals';
import { remote } from 'webdriverio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appBinaryPath = join(
  __dirname,
  '../../../../fixtures/e2e-apps/dioxus/target/debug',
  process.platform === 'win32' ? 'wdio-dioxus-e2e-app.exe' : 'wdio-dioxus-e2e-app',
);

describe('Dioxus standalone session', () => {
  let browser: WebdriverIO.Browser;

  before(async () => {
    browser = await remote({
      capabilities: {
        browserName: 'dioxus',
        'wdio:dioxusServiceOptions': {
          driverProvider: 'embedded',
          appBinaryPath,
        },
      },
      services: [['@wdio/dioxus-service']],
      logLevel: 'silent',
    });
  });

  after(async () => {
    await browser?.deleteSession();
  });

  it('should execute a script in standalone mode', async () => {
    const result = await browser.dioxus.execute('return 42');
    expect(result).toBe(42);
  });
});
