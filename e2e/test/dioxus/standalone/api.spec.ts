import path from 'node:path';
import url from 'node:url';
import { cleanupWdioSession, createDioxusCapabilities, startWdioSession } from '@wdio/dioxus-service';
import type { DioxusAPIs } from '@wdio/native-types';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const appBinaryPath = path.join(
  __dirname,
  '../../../../fixtures/e2e-apps/dioxus/target/debug',
  process.platform === 'win32' ? 'wdio-dioxus-e2e-app.exe' : 'wdio-dioxus-e2e-app',
);

describe('Dioxus standalone API', () => {
  let standaloneSession: WebdriverIO.Browser;

  before(async () => {
    standaloneSession = await startWdioSession(
      createDioxusCapabilities(appBinaryPath, {
        appArgs: ['foo', 'bar=baz'],
        driverProvider: 'embedded',
        embeddedPort: 4447,
      }),
    );
  });

  after(async () => {
    await standaloneSession.deleteSession();
    await cleanupWdioSession(standaloneSession);
  });

  it('should execute a script and return a primitive value', async () => {
    const result = await standaloneSession.dioxus.execute('return 42');
    expect(result).toBe(42);
  });

  it('should return platform info with an os field', async () => {
    const platformInfo = await standaloneSession.dioxus.execute(({ invoke }: DioxusAPIs) =>
      invoke('get_platform_info'),
    );
    expect(typeof platformInfo === 'object' && platformInfo !== null && 'os' in platformInfo).toBe(true);
  });
});
