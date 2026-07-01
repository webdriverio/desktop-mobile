import { execSync } from 'node:child_process';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Options } from '@wdio/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixtureRoot = resolvePath(__dirname, '..', 'fixtures', 'e2e-apps', 'dioxus-browser');
const port = 8088;
const devServerUrl = `http://localhost:${port}`;
// Dogfood the service-managed `devServer` option (#417): the launcher spawns this static server,
// waits until `devServerUrl` is reachable, and tears down the whole process tree on completion —
// replacing the in-process onPrepare/onComplete server the other browser confs still hand-manage.
// `reuseExistingServer` defaults to `!CI`, so CI exercises the real spawn + process-group teardown.
const staticServer = resolvePath(__dirname, 'scripts', 'static-server.mjs');
const devServer = `node "${staticServer}" "${fixtureRoot}" ${port}`;

/**
 * On Linux/macOS, list running processes to confirm browser mode is not
 * spawning the Dioxus driver stack — the embedded-driver app binary
 * (`wdio-dioxus-*`), the external `wdio-dioxus-driver` proxy, or the platform
 * webview driver (`msedgedriver` on Windows / `WebKitWebDriver` on Linux) the
 * external provider drives. Browser mode runs real Chrome via chromedriver, so
 * none of these should appear. Skip on Windows where `ps` doesn't exist; CI on
 * Windows relies on the launcher integration test (no driver constructed in
 * browser mode).
 */
function assertNoDioxusDriverProcesses(): void {
  if (process.platform === 'win32') return;
  try {
    const psOutput = execSync('ps -A -o command=', { encoding: 'utf-8' });
    const offenders = psOutput
      .split('\n')
      .filter((line) => /wdio-dioxus|dioxus-driver|msedgedriver|WebKitWebDriver/i.test(line))
      .filter((line) => !line.includes('wdio.dioxus-browser.conf.ts'));
    if (offenders.length > 0) {
      throw new Error(`Browser-mode run should not spawn Dioxus driver processes, but found:\n${offenders.join('\n')}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Browser-mode run should')) {
      throw error;
    }
    // ps failed for some other reason — log but don't fail the run.
    console.warn(`Could not run ps for process-presence check: ${error}`);
  }
}

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./test/dioxus-browser/*.spec.ts'],
  exclude: [],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'dioxus',
      'wdio:dioxusServiceOptions': {
        mode: 'browser',
        devServerUrl,
        devServer,
      },
    },
  ] as unknown as Options.Testrunner['capabilities'],
  logLevel: 'info',
  outputDir: join(__dirname, 'logs', 'dioxus-browser'),
  bail: 0,
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  autoXvfb: true,
  services: ['@wdio/dioxus-service'],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  async beforeSession() {
    assertNoDioxusDriverProcesses();
  },
};
