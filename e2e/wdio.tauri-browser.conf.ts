import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, extname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Options } from '@wdio/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixtureRoot = resolvePath(__dirname, '..', 'fixtures', 'e2e-apps', 'tauri-browser');
const port = 1421;
const devServerUrl = `http://localhost:${port}`;

let staticServer: Server | undefined;

function startStaticServer(rootPath: string): Promise<Server> {
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
  };
  // Enumerate files up front and look them up by request URL into the map.
  // Keeps user-controlled input out of `readFileSync` and satisfies CodeQL.
  const allowed = new Map<string, string>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        allowed.set(`/${rel}`, abs);
        if (rel === 'index.html') allowed.set('/', abs);
      }
    }
  };
  walk(rootPath, '');

  const server = createServer((req, res) => {
    const key = (req.url ?? '/').split('?')[0];
    const absolute = allowed.get(key);
    if (!absolute) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    res.setHeader('Content-Type', mimeTypes[extname(absolute)] ?? 'application/octet-stream');
    res.end(readFileSync(absolute));
  });
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', () => resolveListen(server));
  });
}

/**
 * On Linux/macOS, list running processes to confirm browser mode is not
 * spawning the Tauri driver stack — `tauri-driver`, the platform webview driver
 * (`msedgedriver` on Windows / `WebKitWebDriver` on Linux), or a Tauri app
 * binary. Browser mode drives real Chrome via chromedriver instead, so none of
 * these should appear. Skip on Windows where `ps` doesn't exist; CI on Windows
 * relies on the launcher integration test (no driver constructed in browser mode).
 */
function assertNoTauriDriverProcesses(): void {
  if (process.platform === 'win32') return;
  try {
    const psOutput = execSync('ps -A -o command=', { encoding: 'utf-8' });
    const offenders = psOutput
      .split('\n')
      .filter((line) => /tauri-driver|msedgedriver|WebKitWebDriver/i.test(line))
      .filter((line) => !line.includes('wdio.tauri-browser.conf.ts'));
    if (offenders.length > 0) {
      throw new Error(`Browser-mode run should not spawn Tauri driver processes, but found:\n${offenders.join('\n')}`);
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
  specs: ['./test/tauri-browser/*.spec.ts'],
  exclude: [],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'wdio:tauriServiceOptions': {
        mode: 'browser',
        devServerUrl,
      },
    },
  ] as unknown as Options.Testrunner['capabilities'],
  logLevel: 'info',
  outputDir: join(__dirname, 'logs', 'tauri-browser'),
  bail: 0,
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  autoXvfb: true,
  services: ['tauri'],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  async onPrepare() {
    if (!existsSync(fixtureRoot)) {
      throw new Error(`Fixture not found: ${fixtureRoot}`);
    }
    staticServer = await startStaticServer(fixtureRoot);
    console.log(`Browser-mode static server listening on ${devServerUrl}`);
  },
  async beforeSession() {
    assertNoTauriDriverProcesses();
  },
  async onComplete() {
    if (staticServer) {
      await new Promise<void>((resolveClose) => staticServer?.close(() => resolveClose()));
      console.log('Browser-mode static server stopped');
    }
  },
};
