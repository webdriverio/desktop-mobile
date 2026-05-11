import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, extname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Options } from '@wdio/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixtureRoot = resolvePath(__dirname, '..', 'fixtures', 'e2e-apps', 'electron-browser');
const port = 5174;
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
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    const filePath = url === '/' || url === '' ? 'index.html' : url.replace(/^\//, '').split('?')[0];
    const absolute = resolvePath(rootPath, filePath);
    if (!absolute.startsWith(rootPath) || !existsSync(absolute)) {
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
 * spawning Electron or pointing ChromeDriver at an Electron binary. Skip on
 * Windows where `ps` doesn't exist; CI on Windows can rely on the absence of
 * Electron-version detection in the launcher integration test.
 */
function assertNoElectronProcesses(): void {
  if (process.platform === 'win32') return;
  try {
    const psOutput = execSync('ps -A -o command=', { encoding: 'utf-8' });
    const offenders = psOutput
      .split('\n')
      .filter((line) => /electron|tauri-driver|msedgedriver/i.test(line))
      .filter((line) => !line.includes('chromedriver') || /\.app\/|\/Electron|\bElectron\b/.test(line))
      .filter((line) => !line.includes('wdio.electron-browser.conf.ts'));
    if (offenders.length > 0) {
      throw new Error(`Browser-mode run should not spawn Electron processes, but found:\n${offenders.join('\n')}`);
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
  specs: ['./test/electron-browser/*.spec.ts'],
  exclude: [],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'electron',
      'wdio:electronServiceOptions': {
        mode: 'browser',
        devServerUrl,
      },
    },
  ],
  logLevel: 'info',
  outputDir: join(__dirname, 'logs', 'electron-browser'),
  bail: 0,
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  autoXvfb: true,
  services: ['electron'],
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
    assertNoElectronProcesses();
  },
  async onComplete() {
    if (staticServer) {
      await new Promise<void>((resolveClose) => staticServer?.close(() => resolveClose()));
      console.log('Browser-mode static server stopped');
    }
  },
};
