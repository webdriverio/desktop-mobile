#!/usr/bin/env node
/**
 * Packs the services and tests them with the apps in fixtures/package-tests, each installed in isolation.
 *
 * Usage: node scripts/test-package.ts [--package=<fixture>] [--module-type=<cjs|esm|both>] [--mode=<native|browser>]
 *   [--skip-build] [--service=<electron|tauri|dioxus|electrobun|react-native|flutter|all>]
 *
 * `--service=all`, the default, covers electron, tauri and dioxus.
 */

import { execSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);
const rootDir = normalize(join(__dirname, '..'));

const SANDBOX_CONFIG_FILE = 'pnpm-workspace.sandbox.yaml';

interface WorkspaceConfig {
  overrides?: Record<string, string>;
  allowBuilds?: Record<string, boolean>;
  [key: string]: unknown;
}

function readWorkspaceConfig(dir: string, fileName = 'pnpm-workspace.yaml'): WorkspaceConfig {
  const workspaceYamlPath = join(dir, fileName);
  if (!existsSync(workspaceYamlPath)) {
    return {};
  }
  return (parseYaml(readFileSync(workspaceYamlPath, 'utf-8')) as WorkspaceConfig) ?? {};
}

// Bounds every child command, so a hung one (e.g. pnpm after a dropped registry connection) fails fast instead of
// holding the CI job for hours. Raise it with PACKAGE_TEST_COMMAND_TIMEOUT_MS, e.g. for a cold Rust build.
const COMMAND_TIMEOUT_MS = Number(process.env.PACKAGE_TEST_COMMAND_TIMEOUT_MS) || 30 * 60_000;

// Workspace overrides, such as a pinned transitive fix, must reach the sandbox install too. Path-based specs are
// dropped: they're relative to the monorepo and can't resolve from the temp dir.
function readWorkspaceOverrides(): Record<string, string> {
  const overrides = readWorkspaceConfig(rootDir).overrides ?? {};
  return Object.fromEntries(
    Object.entries(overrides).filter(
      ([, value]) =>
        typeof value === 'string' &&
        !value.startsWith('file:') &&
        !value.startsWith('link:') &&
        !value.startsWith('workspace:'),
    ),
  );
}

interface TestOptions {
  package?: string;
  skipBuild?: boolean;
  service?: 'electron' | 'tauri' | 'dioxus' | 'electrobun' | 'react-native' | 'flutter' | 'all';
  moduleType?: 'cjs' | 'esm' | 'both';
  // 'browser' serves the fixture's browser/ directory and runs its wdio.browser.conf.ts instead of launching the app.
  mode?: 'native' | 'browser';
}

function log(message: string) {
  console.log(`🔧 ${message}`);
}

function execCommand(command: string, cwd: string, description: string) {
  log(`${description}...`);

  // On Windows, pnpm sometimes exits non-zero in the sandbox without printing an error, so retry it once.
  const isPnpm = command.startsWith('pnpm ');
  const maxAttempts = isPnpm && process.platform === 'win32' ? 2 : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    try {
      execSync(command, {
        cwd: normalize(cwd),
        stdio: 'inherit',
        encoding: 'utf-8',
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        timeout: COMMAND_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      });
      if (attempt > 1) {
        log(`(retry ${attempt - 1} succeeded)`);
      }
      log(`✅ ${description} completed`);
      return;
    } catch (error) {
      // Retrying a hang just spends the budget twice, so a timeout is terminal.
      if (Date.now() - startedAt >= COMMAND_TIMEOUT_MS) {
        throw new Error(`${description} exceeded ${COMMAND_TIMEOUT_MS / 60_000} minutes and was killed: ${command}`);
      }
      lastError = error;
      if (attempt < maxAttempts) {
        console.error(`⚠️  ${description} failed on attempt ${attempt}; retrying after 2s...`);
        // Synchronous sleep without spawning a child — we're in a sync codepath.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
      }
    }
  }
  {
    const error = lastError;
    console.error(`❌ ${description} failed:`);
    if (error instanceof Error) {
      console.error(error.message);
      if ('stderr' in error && error.stderr) {
        console.error(error.stderr);
      }
    }
    throw error;
  }
}

// For browser mode, whose static server runs in this process: execSync would block the event loop for the whole
// wdio run, so the server could never answer Chrome.
function execCommandAsync(command: string, cwd: string, description: string): Promise<void> {
  log(`${description}...`);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, {
      cwd: normalize(cwd),
      stdio: 'inherit',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(
        new Error(`${description} exceeded ${COMMAND_TIMEOUT_MS / 60_000} minutes and was killed: ${command}`),
      );
    }, COMMAND_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        log(`✅ ${description} completed`);
        resolvePromise();
      } else {
        rejectPromise(new Error(`${description} failed with exit code ${code}`));
      }
    });
  });
}

async function buildAndPackService(
  service: 'electron' | 'tauri' | 'dioxus' | 'electrobun' | 'react-native' | 'flutter' | 'all' = 'all',
): Promise<{
  electronServicePath?: string;
  tauriServicePath?: string;
  dioxusServicePath?: string;
  electrobunServicePath?: string;
  reactNativeServicePath?: string;
  flutterServicePath?: string;
  utilsPath: string;
  spyPath: string;
  corePath: string;
  mobileCorePath?: string;
  typesPath?: string;
  cdpBridgePath?: string;
}> {
  log(`Building and packing services and dependencies (service: ${service})...`);

  try {
    const buildFilters: Record<
      'electron' | 'tauri' | 'dioxus' | 'electrobun' | 'react-native' | 'flutter' | 'all',
      string
    > = {
      electron: '--filter=@wdio/electron-service --filter=@wdio/native-spy --filter=@wdio/native-core',
      tauri: '--filter=@wdio/tauri-service --filter=@wdio/native-core',
      dioxus: '--filter=@wdio/dioxus-service --filter=@wdio/native-core',
      electrobun: '--filter=@wdio/electrobun-service --filter=@wdio/native-spy --filter=@wdio/native-core',
      'react-native':
        '--filter=@wdio/react-native-service --filter=@wdio/native-spy --filter=@wdio/native-core --filter=@wdio/native-mobile-core',
      flutter:
        '--filter=@wdio/flutter-service --filter=@wdio/native-spy --filter=@wdio/native-core --filter=@wdio/native-mobile-core',
      all: '--filter=./packages/*',
    };
    execCommand(`pnpm turbo run build ${buildFilters[service]}`, rootDir, `Building packages for ${service}`);

    const utilsDir = normalize(join(rootDir, 'packages', 'native-utils'));
    if (!existsSync(utilsDir)) {
      throw new Error(`Utils directory does not exist: ${utilsDir}`);
    }
    execCommand('pnpm pack', utilsDir, 'Packing @wdio/native-utils');

    const spyDir = normalize(join(rootDir, 'packages', 'native-spy'));
    if (!existsSync(spyDir)) {
      throw new Error(`Spy directory does not exist: ${spyDir}`);
    }
    execCommand('pnpm pack', spyDir, 'Packing @wdio/native-spy');

    const coreDir = normalize(join(rootDir, 'packages', 'native-core'));
    if (!existsSync(coreDir)) {
      throw new Error(`Core directory does not exist: ${coreDir}`);
    }
    execCommand('pnpm pack', coreDir, 'Packing @wdio/native-core');

    const findTgzFile = (dir: string, prefix: string): string => {
      const files = readdirSync(dir);
      const tgzFile = files.find((f) => f.startsWith(prefix) && f.endsWith('.tgz'));
      if (!tgzFile) {
        throw new Error(`Could not find ${prefix} .tgz file in ${dir}`);
      }
      return normalize(join(dir, tgzFile));
    };

    const utilsPath = findTgzFile(utilsDir, 'wdio-native-utils-');
    const spyPath = findTgzFile(spyDir, 'wdio-native-spy-');
    const corePath = findTgzFile(coreDir, 'wdio-native-core-');

    const result: {
      electronServicePath?: string;
      tauriServicePath?: string;
      dioxusServicePath?: string;
      electrobunServicePath?: string;
      reactNativeServicePath?: string;
      flutterServicePath?: string;
      utilsPath: string;
      spyPath: string;
      corePath: string;
      mobileCorePath?: string;
      typesPath?: string;
      cdpBridgePath?: string;
    } = { utilsPath, spyPath, corePath };

    if (service === 'electron' || service === 'all') {
      const electronServiceDir = normalize(join(rootDir, 'packages', 'electron-service'));
      const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
      const cdpBridgeDir = normalize(join(rootDir, 'packages', 'native-cdp-bridge'));

      if (!existsSync(typesDir)) {
        throw new Error(`Types directory does not exist: ${typesDir}`);
      }
      if (!existsSync(cdpBridgeDir)) {
        throw new Error(`CDP Bridge directory does not exist: ${cdpBridgeDir}`);
      }

      execCommand('pnpm pack', typesDir, 'Packing @wdio/native-types');
      execCommand('pnpm pack', cdpBridgeDir, 'Packing @wdio/native-cdp-bridge');
      execCommand('pnpm pack', electronServiceDir, 'Packing @wdio/electron-service');

      result.electronServicePath = findTgzFile(electronServiceDir, 'wdio-electron-service-');
      result.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
      result.cdpBridgePath = findTgzFile(cdpBridgeDir, 'wdio-native-cdp-bridge-');
    }

    if (service === 'tauri' || service === 'all') {
      const tauriServiceDir = normalize(join(rootDir, 'packages', 'tauri-service'));
      const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
      if (!existsSync(tauriServiceDir)) {
        throw new Error(`Tauri service directory does not exist: ${tauriServiceDir}`);
      }
      if (!existsSync(typesDir)) {
        throw new Error(`Types directory does not exist: ${typesDir}`);
      }
      execCommand('pnpm pack', typesDir, 'Packing @wdio/native-types');
      execCommand('pnpm pack', tauriServiceDir, 'Packing @wdio/tauri-service');
      result.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
      result.tauriServicePath = findTgzFile(tauriServiceDir, 'wdio-tauri-service-');
    }

    if (service === 'dioxus' || service === 'all') {
      const dioxusServiceDir = normalize(join(rootDir, 'packages', 'dioxus-service'));
      if (!existsSync(dioxusServiceDir)) {
        throw new Error(`Dioxus service directory does not exist: ${dioxusServiceDir}`);
      }
      const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
      if (!existsSync(typesDir)) {
        throw new Error(`Types directory does not exist: ${typesDir}`);
      }
      if (!result.typesPath) {
        execCommand('pnpm pack', typesDir, 'Packing @wdio/native-types');
        result.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
      }
      execCommand('pnpm pack', dioxusServiceDir, 'Packing @wdio/dioxus-service');
      result.dioxusServicePath = findTgzFile(dioxusServiceDir, 'wdio-dioxus-service-');
    }

    if (service === 'electrobun') {
      const electrobunServiceDir = normalize(join(rootDir, 'packages', 'electrobun-service'));
      const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
      const cdpBridgeDir = normalize(join(rootDir, 'packages', 'native-cdp-bridge'));
      if (!existsSync(electrobunServiceDir)) {
        throw new Error(`Electrobun service directory does not exist: ${electrobunServiceDir}`);
      }
      if (!existsSync(cdpBridgeDir)) {
        throw new Error(`Electrobun CDP Bridge directory does not exist: ${cdpBridgeDir}`);
      }
      execCommand('pnpm pack', typesDir, 'Packing @wdio/native-types');
      execCommand('pnpm pack', cdpBridgeDir, 'Packing @wdio/native-cdp-bridge');
      execCommand('pnpm pack', electrobunServiceDir, 'Packing @wdio/electrobun-service');
      result.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
      result.cdpBridgePath = findTgzFile(cdpBridgeDir, 'wdio-native-cdp-bridge-');
      result.electrobunServicePath = findTgzFile(electrobunServiceDir, 'wdio-electrobun-service-');
    }

    if (service === 'react-native') {
      const rnServiceDir = normalize(join(rootDir, 'packages', 'react-native-service'));
      const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
      const cdpBridgeDir = normalize(join(rootDir, 'packages', 'native-cdp-bridge'));
      const mobileCoreDir = normalize(join(rootDir, 'packages', 'native-mobile-core'));
      if (!existsSync(rnServiceDir)) {
        throw new Error(`React Native service directory does not exist: ${rnServiceDir}`);
      }
      if (!existsSync(cdpBridgeDir)) {
        throw new Error(`React Native CDP Bridge directory does not exist: ${cdpBridgeDir}`);
      }
      execCommand('pnpm pack', typesDir, 'Packing @wdio/native-types');
      execCommand('pnpm pack', cdpBridgeDir, 'Packing @wdio/native-cdp-bridge');
      execCommand('pnpm pack', mobileCoreDir, 'Packing @wdio/native-mobile-core');
      execCommand('pnpm pack', rnServiceDir, 'Packing @wdio/react-native-service');
      result.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
      result.cdpBridgePath = findTgzFile(cdpBridgeDir, 'wdio-native-cdp-bridge-');
      result.mobileCorePath = findTgzFile(mobileCoreDir, 'wdio-native-mobile-core-');
      result.reactNativeServicePath = findTgzFile(rnServiceDir, 'wdio-react-native-service-');
    }

    if (service === 'flutter') {
      const flutterServiceDir = normalize(join(rootDir, 'packages', 'flutter-service'));
      const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
      const mobileCoreDir = normalize(join(rootDir, 'packages', 'native-mobile-core'));
      if (!existsSync(flutterServiceDir)) {
        throw new Error(`Flutter service directory does not exist: ${flutterServiceDir}`);
      }
      execCommand('pnpm pack', typesDir, 'Packing @wdio/native-types');
      execCommand('pnpm pack', mobileCoreDir, 'Packing @wdio/native-mobile-core');
      execCommand('pnpm pack', flutterServiceDir, 'Packing @wdio/flutter-service');
      result.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
      result.mobileCorePath = findTgzFile(mobileCoreDir, 'wdio-native-mobile-core-');
      result.flutterServicePath = findTgzFile(flutterServiceDir, 'wdio-flutter-service-');
    }

    log(`📦 Packages packed:`);
    log(`   Utils: ${utilsPath}`);
    log(`   Spy: ${spyPath}`);
    log(`   Core: ${corePath}`);
    if (result.electronServicePath) {
      log(`   Electron Service: ${result.electronServicePath}`);
      log(`   Types: ${result.typesPath}`);
      log(`   CDP Bridge: ${result.cdpBridgePath}`);
    }
    if (result.tauriServicePath) {
      log(`   Tauri Service: ${result.tauriServicePath}`);
      if (result.typesPath) {
        log(`   Types: ${result.typesPath}`);
      }
    }
    if (result.dioxusServicePath) {
      log(`   Dioxus Service: ${result.dioxusServicePath}`);
      if (result.typesPath) {
        log(`   Types: ${result.typesPath}`);
      }
    }
    if (result.electrobunServicePath) {
      log(`   Electrobun Service: ${result.electrobunServicePath}`);
      log(`   Types: ${result.typesPath}`);
      log(`   CDP Bridge: ${result.cdpBridgePath}`);
    }
    if (result.reactNativeServicePath) {
      log(`   React Native Service: ${result.reactNativeServicePath}`);
      log(`   Types: ${result.typesPath}`);
      log(`   CDP Bridge: ${result.cdpBridgePath}`);
    }

    return result;
  } catch (error) {
    console.error('❌ Failed in buildAndPackService:');
    if (error instanceof Error) {
      console.error(error.message);
    }
    throw error;
  }
}

// Serves only the files listed at startup, so a request path never reaches readFileSync.
async function startStaticServer(rootPath: string, port: number): Promise<Server> {
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  const allowed = new Map<string, string>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        allowed.set(`/${rel}`, abs);
        if (rel === 'index.html') {
          allowed.set('/', abs);
        }
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
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', () => resolveListen());
  });
  return server;
}

async function testExample(
  packagePath: string,
  packages: {
    electronServicePath?: string;
    tauriServicePath?: string;
    dioxusServicePath?: string;
    electrobunServicePath?: string;
    reactNativeServicePath?: string;
    flutterServicePath?: string;
    utilsPath: string;
    spyPath: string;
    corePath: string;
    mobileCorePath?: string;
    typesPath?: string;
    cdpBridgePath?: string;
  },
  service: 'electron' | 'tauri' | 'dioxus' | 'electrobun' | 'react-native' | 'flutter',
  skipBuild: boolean,
  mode: 'native' | 'browser' = 'native',
) {
  const packageName = packagePath.split(/[/\\]/).pop();
  if (!packageName) {
    throw new Error(`Invalid package path: ${packagePath}`);
  }

  log(`Testing package: ${packageName}`);

  if (!existsSync(packagePath)) {
    throw new Error(`Package not found: ${packagePath}`);
  }

  // Workaround for vitejs/vite#10802; drop once a fix lands. On Windows, tmpdir() is an 8.3 short path that vite
  // leaves unresolved in config.root, so the HTML build fails unless the base is canonicalised first.
  const testId = Date.now();
  const tempBase = process.platform === 'win32' ? realpathSync.native(tmpdir()) : tmpdir();
  const tempDir = normalize(join(tempBase, `wdio-package-test-${testId}`));
  const packageDir = normalize(join(tempDir, packageName));

  const logsDir = join(packageDir, 'logs');

  try {
    log(`Creating isolated test environment at ${tempDir}`);
    mkdirSync(tempDir, { recursive: true });
    cpSync(packagePath, packageDir, { recursive: true });

    // Fixtures keep sandbox-only pnpm settings under a name pnpm ignores: a real pnpm-workspace.yaml would make the
    // fixture its own workspace root inside the monorepo, stranding its `workspace:*` dependencies.
    const fixtureConfig = readWorkspaceConfig(packageDir, SANDBOX_CONFIG_FILE);
    rmSync(join(packageDir, SANDBOX_CONFIG_FILE), { force: true });

    const packageJsonPath = join(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      throw new Error(`package.json not found at ${packageJsonPath}`);
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    // The fixture's file: overrides are relative to the monorepo and can't resolve from the temp dir.
    const sourceOverrides: Record<string, string> = fixtureConfig.overrides ?? {};
    const preservedOverrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(sourceOverrides)) {
      if (!value.startsWith('file:')) {
        preservedOverrides[key] = value;
        log(`  Preserving source override: ${key}@${value}`);
      }
    }

    const workspaceOverrides = readWorkspaceOverrides();
    for (const [key, value] of Object.entries(workspaceOverrides)) {
      log(`  Applying workspace override: ${key}@${value}`);
    }

    // Precedence, lowest first: workspace, fixture, then the packed tarballs under test.
    const overrides: Record<string, string> = { ...workspaceOverrides, ...preservedOverrides };
    const localPackages = new Set<string>();
    const useLocal = (name: string, tarball: string) => {
      overrides[name] = `file:${tarball}`;
      localPackages.add(name);
    };
    useLocal('@wdio/native-utils', packages.utilsPath);
    useLocal('@wdio/native-spy', packages.spyPath);
    useLocal('@wdio/native-core', packages.corePath);

    // To test a patched @wdio/utils, `npm pack` it from a webdriverio checkout into the repo root.
    const wdioUtilsTarballs = readdirSync(rootDir).filter((entry) => /^wdio-utils-.+\.tgz$/.test(entry));
    if (wdioUtilsTarballs.length > 1) {
      throw new Error(
        `Found ${wdioUtilsTarballs.length} @wdio/utils tarballs in ${rootDir} (${wdioUtilsTarballs.join(', ')}). ` +
          'Leave only the one to test.',
      );
    }
    if (wdioUtilsTarballs.length === 1) {
      const wdioUtilsTarball = join(rootDir, wdioUtilsTarballs[0]);
      useLocal('@wdio/utils', wdioUtilsTarball);
      log(`  Adding @wdio/utils override: ${wdioUtilsTarball}`);
    }

    if (service === 'electron') {
      if (!packages.electronServicePath || !packages.typesPath || !packages.cdpBridgePath) {
        throw new Error('Electron service packages not available');
      }
      useLocal('@wdio/native-types', packages.typesPath);
      useLocal('@wdio/native-cdp-bridge', packages.cdpBridgePath);
      useLocal('@wdio/electron-service', packages.electronServicePath);
    } else if (service === 'tauri') {
      if (!packages.tauriServicePath || !packages.typesPath) {
        throw new Error('Tauri service packages not available');
      }
      useLocal('@wdio/native-types', packages.typesPath);
      useLocal('@wdio/tauri-service', packages.tauriServicePath);
    } else if (service === 'dioxus') {
      if (!packages.dioxusServicePath || !packages.typesPath) {
        throw new Error('Dioxus service packages not available');
      }
      useLocal('@wdio/native-types', packages.typesPath);
      useLocal('@wdio/dioxus-service', packages.dioxusServicePath);
    } else if (service === 'electrobun') {
      if (!packages.electrobunServicePath || !packages.typesPath || !packages.cdpBridgePath) {
        throw new Error('Electrobun service packages not available');
      }
      useLocal('@wdio/native-types', packages.typesPath);
      useLocal('@wdio/native-cdp-bridge', packages.cdpBridgePath);
      useLocal('@wdio/electrobun-service', packages.electrobunServicePath);
    } else if (service === 'react-native') {
      if (
        !packages.reactNativeServicePath ||
        !packages.typesPath ||
        !packages.cdpBridgePath ||
        !packages.mobileCorePath
      ) {
        throw new Error('React Native service packages not available');
      }
      useLocal('@wdio/native-types', packages.typesPath);
      useLocal('@wdio/native-cdp-bridge', packages.cdpBridgePath);
      useLocal('@wdio/native-mobile-core', packages.mobileCorePath);
      useLocal('@wdio/react-native-service', packages.reactNativeServicePath);
    } else if (service === 'flutter') {
      if (!packages.flutterServicePath || !packages.typesPath || !packages.mobileCorePath) {
        throw new Error('Flutter service packages not available');
      }
      useLocal('@wdio/native-types', packages.typesPath);
      useLocal('@wdio/native-mobile-core', packages.mobileCorePath);
      useLocal('@wdio/flutter-service', packages.flutterServicePath);
    }

    // The sandbox is its own workspace root, so pnpm resolves `workspace:` specs against it and overrides can't
    // redirect them. Point them at the tarballs directly.
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const deps: Record<string, string> | undefined = packageJson[field];
      if (!deps) {
        continue;
      }
      for (const [name, spec] of Object.entries(deps)) {
        if (typeof spec !== 'string' || !spec.startsWith('workspace:')) {
          continue;
        }
        const resolved = overrides[name];
        if (!resolved) {
          throw new Error(`No packed tarball available for workspace dependency "${name}" in ${packageName}`);
        }
        deps[name] = resolved;
        log(`  Resolving workspace dependency: ${name} -> ${resolved}`);
      }
    }
    // Depend on each local tarball here rather than `pnpm add`-ing its path, so no path goes through a shell.
    for (const name of localPackages) {
      const field =
        ['dependencies', 'devDependencies', 'optionalDependencies'].find((f) => packageJson[f]?.[name]) ??
        'dependencies';
      packageJson[field] = { ...packageJson[field], [name]: overrides[name] };
    }
    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // pnpm reads settings only from pnpm-workspace.yaml, and silently ignores a `pnpm` field in package.json.
    writeFileSync(
      join(packageDir, 'pnpm-workspace.yaml'),
      stringifyYaml({
        ...fixtureConfig,
        // pnpm rejects a workspace config with no packages field.
        packages: fixtureConfig.packages ?? ['.'],
        allowBuilds: { ...readWorkspaceConfig(rootDir).allowBuilds, ...fixtureConfig.allowBuilds },
        overrides,
        // Every local package under test is injected above as a `file:` spec.
        blockExoticSubdeps: false,
        // Build policy belongs to the monorepo root, not a throwaway sandbox — an
        // undeclared transitive build here should not fail the package test.
        strictDepBuilds: false,
      }),
    );

    execCommand('pnpm install', packageDir, `Installing dependencies for ${packageName}`);

    mkdirSync(logsDir, { recursive: true });
    log(`✅ Created logs directory: ${logsDir}`);

    // The Tauri plugins are relative path dependencies, so copy them into the sandbox and point Cargo.toml there.
    if (service === 'tauri') {
      const cargoTomlPath = join(packageDir, 'src-tauri', 'Cargo.toml');

      if (existsSync(cargoTomlPath)) {
        let cargoToml = readFileSync(cargoTomlPath, 'utf-8');
        const tauriPlugins: { crate: string; packageDir: string }[] = [
          { crate: 'tauri-plugin-wdio', packageDir: 'tauri-plugin' },
          { crate: 'tauri-plugin-wdio-webdriver', packageDir: 'tauri-plugin-webdriver' },
        ];

        let cargoTomlModified = false;
        for (const { crate, packageDir: pluginPackageDir } of tauriPlugins) {
          const pluginSourceDir = join(rootDir, 'packages', pluginPackageDir);
          const pluginDestDir = join(tempDir, 'packages', pluginPackageDir);
          const pathPattern = new RegExp(
            `(${crate}\\s*=\\s*\\{\\s*path\\s*=\\s*)"\\.\\./\\.\\./\\.\\./\\.\\./packages/${pluginPackageDir}"(\\s*\\})`,
          );

          if (!pathPattern.test(cargoToml)) {
            continue;
          }

          if (!existsSync(pluginSourceDir)) {
            log(`⚠️  Plugin source not found at ${pluginSourceDir}`);
            continue;
          }

          log(`Copying ${crate} source for Rust dependency resolution...`);
          mkdirSync(dirname(pluginDestDir), { recursive: true });
          cpSync(pluginSourceDir, pluginDestDir, { recursive: true });
          log(`✅ ${crate} source copied to ${pluginDestDir}`);

          const permissionsDir = join(pluginDestDir, 'permissions');
          if (existsSync(permissionsDir)) {
            log(`✅ ${crate} permissions directory found at ${permissionsDir}`);
          } else {
            log(`⚠️  ${crate} permissions directory not found at ${permissionsDir}`);
          }

          const absolutePluginPath = normalize(pluginDestDir);
          cargoToml = cargoToml.replace(pathPattern, `$1"${absolutePluginPath}"$2`);
          cargoTomlModified = true;
          log(`✅ Updated Cargo.toml ${crate} path dependency to absolute path: ${absolutePluginPath}`);
        }

        if (cargoTomlModified) {
          writeFileSync(cargoTomlPath, cargoToml);
        }
      }
    }

    // Copy the crates with their sibling layout, so their own `../dioxus-*` path deps still resolve.
    if (service === 'dioxus') {
      const cargoTomlPath = join(packageDir, 'src-dioxus', 'Cargo.toml');

      if (existsSync(cargoTomlPath)) {
        let cargoToml = readFileSync(cargoTomlPath, 'utf-8');
        if (cargoToml.includes('wdio-dioxus') && cargoToml.includes('path =')) {
          for (const crateDir of ['dioxus-wdio', 'dioxus-embedded-driver', 'dioxus-bridge']) {
            const sourceDir = join(rootDir, 'packages', crateDir);
            if (existsSync(sourceDir)) {
              cpSync(sourceDir, join(tempDir, 'packages', crateDir), { recursive: true });
              log(`✅ ${crateDir} source copied for Rust dependency resolution`);
            } else {
              log(`⚠️  ${crateDir} source not found at ${sourceDir}`);
            }
          }

          const oldPathPattern =
            /(wdio-dioxus\s*=\s*\{\s*path\s*=\s*)"\.\.\/\.\.\/\.\.\/\.\.\/packages\/dioxus-wdio"(\s*[,}])/;
          if (oldPathPattern.test(cargoToml)) {
            const absoluteCratePath = normalize(join(tempDir, 'packages', 'dioxus-wdio')).replace(/\\/g, '/');
            cargoToml = cargoToml.replace(oldPathPattern, `$1"${absoluteCratePath}"$2`);
            writeFileSync(cargoTomlPath, cargoToml);
            log(`✅ Updated Cargo.toml path dependency to: ${absoluteCratePath}`);
          } else {
            log(
              `⚠️  Could not rewrite wdio-dioxus path dep — pattern did not match. Cargo build may fail if the relative path is unreachable from the isolated environment.`,
            );
          }
        }
      }
    }

    // Browser mode tests the static frontend in Chrome, so it needs no app build.
    if (service === 'tauri' && mode === 'native') {
      const pluginSourceDir = join(rootDir, 'packages', 'tauri-plugin');
      const pluginDistJsDir = join(pluginSourceDir, 'dist-js');

      const pluginDestParentDir = join(tempDir, 'packages', 'tauri-plugin');
      const pluginDestJsDir = join(pluginDestParentDir, 'dist-js');
      if (existsSync(pluginDistJsDir)) {
        log(`Copying plugin JavaScript to isolated environment...`);
        mkdirSync(pluginDestParentDir, { recursive: true });
        if (existsSync(pluginDestJsDir)) {
          rmSync(pluginDestJsDir, { recursive: true, force: true });
        }
        cpSync(pluginDistJsDir, pluginDestJsDir, { recursive: true });
        log(`✅ Plugin JavaScript copied successfully`);
      } else {
        throw new Error(`Plugin JavaScript build not found at ${pluginDistJsDir}`);
      }

      if (packageJson.scripts?.['build:web']) {
        execCommand('pnpm build:web', packageDir, `Building web frontend for ${packageName}`);
      }

      const sourceTargetDir = join(rootDir, 'fixtures', 'package-tests', 'tauri-app', 'target');
      const destTargetDir = join(packageDir, 'target');

      if (existsSync(sourceTargetDir)) {
        log(`Copying pre-built Tauri binary from ${sourceTargetDir}...`);
        mkdirSync(destTargetDir, { recursive: true });
        cpSync(sourceTargetDir, destTargetDir, { recursive: true });
        log(`✅ Pre-built Tauri binary copied successfully`);
      } else {
        log(`⚠️  Pre-built Tauri binary not found at ${sourceTargetDir}, will build instead`);
        if (packageJson.scripts?.build) {
          const srcTauriDir = join(packageDir, 'src-tauri');
          const capabilitiesDir = join(srcTauriDir, 'capabilities');
          const capabilitiesFile = join(capabilitiesDir, 'default.json');
          const genDir = join(srcTauriDir, 'gen');
          const buildRs = join(srcTauriDir, 'build.rs');
          const cargoToml = join(srcTauriDir, 'Cargo.toml');

          log(`🔍 Debugging Tauri app build environment before build...`);
          log(`   src-tauri directory: ${srcTauriDir} (exists: ${existsSync(srcTauriDir)})`);
          log(`   capabilities directory: ${capabilitiesDir} (exists: ${existsSync(capabilitiesDir)})`);
          log(`   capabilities/default.json: ${capabilitiesFile} (exists: ${existsSync(capabilitiesFile)})`);
          log(`   gen directory: ${genDir} (exists: ${existsSync(genDir)})`);
          log(`   build.rs: ${buildRs} (exists: ${existsSync(buildRs)})`);
          log(`   Cargo.toml: ${cargoToml} (exists: ${existsSync(cargoToml)})`);

          if (existsSync(capabilitiesFile)) {
            try {
              const capabilitiesContent = readFileSync(capabilitiesFile, 'utf-8');
              const capabilitiesJson = JSON.parse(capabilitiesContent) as {
                identifier?: string;
                permissions?: string[];
              };
              log(`   ✅ Capabilities file is valid JSON`);
              log(`   ✅ Capability identifier: ${capabilitiesJson.identifier}`);
              log(`   ✅ Capability has ${capabilitiesJson.permissions?.length || 0} permissions`);

              const pluginPerms = capabilitiesJson.permissions?.filter((p) => p.startsWith('wdio:'));
              if (pluginPerms && pluginPerms.length > 0) {
                log(`   ✅ References ${pluginPerms.length} plugin permissions: ${pluginPerms.join(', ')}`);
              } else {
                log(`   ⚠️  No plugin permissions referenced in capabilities file`);
              }
            } catch (error) {
              log(`   ❌ Capabilities file is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          const pluginPath = join(tempDir, 'packages', 'tauri-plugin');
          log(`   Plugin path: ${pluginPath} (exists: ${existsSync(pluginPath)})`);
          if (existsSync(pluginPath)) {
            const pluginPermissions = join(pluginPath, 'permissions');
            log(`   Plugin permissions: ${pluginPermissions} (exists: ${existsSync(pluginPermissions)})`);
          }

          if (existsSync(cargoToml)) {
            const cargoTomlContent = readFileSync(cargoToml, 'utf-8');
            if (cargoTomlContent.includes('tauri-plugin-wdio')) {
              log(`   ✅ Plugin dependency found in Cargo.toml`);
            } else {
              log(`   ❌ Plugin dependency NOT found in Cargo.toml`);
            }
          }

          execCommand('pnpm build', packageDir, `Building ${packageName} app`);

          const aclManifest = join(genDir, 'schemas', 'acl-manifests.json');
          log(`🔍 Debugging Tauri app build results...`);
          log(`   gen directory: ${genDir} (exists: ${existsSync(genDir)})`);
          if (existsSync(genDir)) {
            log(`   ✅ gen directory created`);
            if (existsSync(aclManifest)) {
              log(`   ✅ ACL manifest created: ${aclManifest}`);
              try {
                const manifestContent = readFileSync(aclManifest, 'utf-8');
                const manifestJson = JSON.parse(manifestContent) as Record<string, unknown>;
                log(`   ✅ ACL manifest is valid JSON`);
                if (manifestJson.wdio) {
                  log(`   ✅ Plugin (wdio) found in ACL manifest`);
                } else {
                  log(`   ⚠️  Plugin (wdio) NOT found in ACL manifest`);
                }
                if (manifestJson.default) {
                  log(`   ✅ Default capability found in ACL manifest`);
                } else {
                  log(`   ❌ Default capability NOT found in ACL manifest`);
                }
              } catch (error) {
                log(`   ❌ ACL manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
              }
            } else {
              log(`   ❌ ACL manifest NOT created: ${aclManifest}`);
            }
          } else {
            log(`   ❌ gen directory NOT created - this indicates ACL manifest generation failed`);
          }
        }
      }
    } else if (service === 'dioxus' && mode === 'native') {
      // With --skip-build, CI has already downloaded the binary as a separate artifact.
      const sourceTargetDir = join(rootDir, 'fixtures', 'package-tests', 'dioxus-app', 'target');
      const destTargetDir = join(packageDir, 'target');
      if (skipBuild) {
        if (!existsSync(sourceTargetDir)) {
          throw new Error(
            `Pre-built Dioxus binary not found at ${sourceTargetDir}. ` +
              'Was the build artifact downloaded and extracted correctly?',
          );
        }
        log(`Copying pre-built Dioxus binary from ${sourceTargetDir}...`);
        mkdirSync(destTargetDir, { recursive: true });
        cpSync(sourceTargetDir, destTargetDir, { recursive: true });
        log(`✅ Pre-built Dioxus binary copied successfully`);
      } else if (packageJson.scripts?.build) {
        execCommand('pnpm build', packageDir, `Building ${packageName} app`);
      }
    } else if (service === 'electrobun' && mode === 'native') {
      // CI builds the CEF bundle as a separate macOS artifact, since the CEF download is slow.
      const sourceBuildDir = join(rootDir, 'fixtures', 'package-tests', 'electrobun-app', 'build');
      const destBuildDir = join(packageDir, 'build');
      if (skipBuild) {
        if (!existsSync(sourceBuildDir)) {
          throw new Error(
            `Pre-built Electrobun bundle not found at ${sourceBuildDir}. ` +
              'Was the build artifact downloaded and extracted correctly?',
          );
        }
        log(`Copying pre-built Electrobun bundle from ${sourceBuildDir}...`);
        mkdirSync(destBuildDir, { recursive: true });
        cpSync(sourceBuildDir, destBuildDir, { recursive: true });
        log(`✅ Pre-built Electrobun bundle copied successfully`);
      } else if (packageJson.scripts?.build) {
        execCommand('pnpm build', packageDir, `Building ${packageName} app`);
      }
    } else if (packageJson.scripts?.build && mode === 'native') {
      execCommand('pnpm build', packageDir, `Building ${packageName} app`);
    }

    let staticServer: Server | undefined;
    if (mode === 'browser') {
      const browserDir = join(packageDir, 'browser');
      if (!existsSync(browserDir)) {
        throw new Error(`Browser-mode requested but no browser/ directory in ${packageName}. Expected ${browserDir}.`);
      }
      log(`Starting static server for ${packageName} from ${browserDir} on http://localhost:5173`);
      staticServer = await startStaticServer(browserDir, 5173);
    }

    try {
      const testScript =
        mode === 'browser'
          ? 'pnpm test:browser'
          : service === 'tauri' && process.platform === 'darwin'
            ? 'pnpm test:embedded'
            : 'pnpm test';
      if (mode === 'browser') {
        await execCommandAsync(testScript, packageDir, `Running ${mode} tests for ${packageName}`);
      } else {
        execCommand(testScript, packageDir, `Running ${mode} tests for ${packageName}`);
      }
    } finally {
      if (staticServer) {
        const server = staticServer;
        await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
        log(`Stopped static server for ${packageName}`);
      }
    }

    log(`✅ ${packageName} tests passed!`);

    // Copy the logs where CI uploads them from, before the temp dir is removed.
    log(`🔍 Checking for logs in: ${logsDir}`);
    if (existsSync(logsDir)) {
      const allFiles = readdirSync(logsDir);
      const logFiles = allFiles.filter((f) => f.endsWith('.log'));
      log(`📋 Found ${logFiles.length} log files: ${logFiles.join(', ')}`);

      if (logFiles.length > 0) {
        const ciLogsDir = join(rootDir, 'logs', 'package-tests');
        mkdirSync(ciLogsDir, { recursive: true });

        for (const logFile of logFiles) {
          const srcPath = join(logsDir, logFile);
          const destPath = join(ciLogsDir, `${packageName}-${logFile}`);
          cpSync(srcPath, destPath);
          log(`📋 Preserved log: ${destPath}`);
        }
      } else {
        log(`⚠️  No .log files found in ${logsDir}, found files: ${allFiles.join(', ')}`);
      }
    } else {
      log(`⚠️  Logs directory does not exist: ${logsDir}`);
    }
  } catch (error) {
    console.error(`❌ Error testing ${packageName}:`);
    if (error instanceof Error) {
      console.error(error.message);
    }

    log(`🔍 Checking for failure logs in: ${logsDir}`);
    if (existsSync(logsDir)) {
      const allFiles = readdirSync(logsDir);
      const logFiles = allFiles.filter((f) => f.endsWith('.log'));
      log(`📋 Found ${logFiles.length} failure log files: ${logFiles.join(', ')}`);

      if (logFiles.length > 0) {
        const ciLogsDir = join(rootDir, 'logs', 'package-tests');
        mkdirSync(ciLogsDir, { recursive: true });

        for (const logFile of logFiles) {
          const srcPath = join(logsDir, logFile);
          const destPath = join(ciLogsDir, `${packageName}-${logFile}`);
          cpSync(srcPath, destPath);
          log(`📋 Preserved failure log: ${destPath}`);
        }
      } else {
        log(`⚠️  No .log files found in ${logsDir}, found files: ${allFiles.join(', ')}`);
      }
    } else {
      log(`⚠️  Logs directory does not exist: ${logsDir}`);
    }

    throw error;
  } finally {
    const logsSourceDir = join(packageDir, 'logs');
    if (existsSync(logsSourceDir)) {
      const logsDestDir = join(packagePath, `logs-${testId}`);
      try {
        mkdirSync(dirname(logsDestDir), { recursive: true });
        cpSync(logsSourceDir, logsDestDir, { recursive: true });
        log(`📋 Copied logs to ${logsDestDir}`);
      } catch (logError) {
        console.error(`⚠️  Failed to copy logs: ${logError instanceof Error ? logError.message : String(logError)}`);
      }
    }

    if (existsSync(tempDir)) {
      log(`Cleaning up isolated test environment`);
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (_cleanupError) {
        console.error(`Failed to clean up temp directory: ${tempDir}`);
      }
    }
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const serviceArg = args.find((arg) => arg.startsWith('--service='))?.split('=')[1];

    let service: 'electron' | 'tauri' | 'dioxus' | 'electrobun' | 'react-native' | 'flutter' | 'all' = 'all';
    if (serviceArg) {
      if (
        serviceArg === 'electron' ||
        serviceArg === 'tauri' ||
        serviceArg === 'dioxus' ||
        serviceArg === 'electrobun' ||
        serviceArg === 'react-native' ||
        serviceArg === 'flutter' ||
        serviceArg === 'all'
      ) {
        service = serviceArg;
      } else {
        throw new Error(
          `Invalid service value: ${serviceArg}. Must be 'electron', 'tauri', 'dioxus', 'electrobun', 'react-native', 'flutter', or 'all'`,
        );
      }
    }

    const moduleTypeArg = args.find((arg) => arg.startsWith('--module-type='))?.split('=')[1];
    let moduleType: 'cjs' | 'esm' | 'both' = 'both';
    if (moduleTypeArg) {
      if (moduleTypeArg === 'cjs' || moduleTypeArg === 'esm' || moduleTypeArg === 'both') {
        moduleType = moduleTypeArg;
      } else {
        throw new Error(`Invalid module-type value: ${moduleTypeArg}. Must be 'cjs', 'esm', or 'both'`);
      }
    }

    const modeArg = args.find((arg) => arg.startsWith('--mode='))?.split('=')[1];
    let mode: 'native' | 'browser' = 'native';
    if (modeArg) {
      if (modeArg === 'native' || modeArg === 'browser') {
        mode = modeArg;
      } else {
        throw new Error(`Invalid mode value: ${modeArg}. Must be 'native' or 'browser'`);
      }
    }

    const options: TestOptions = {
      package: args.find((arg) => arg.startsWith('--package='))?.split('=')[1],
      skipBuild: args.includes('--skip-build'),
      service,
      moduleType,
      mode,
    };

    let packages: {
      electronServicePath?: string;
      tauriServicePath?: string;
      dioxusServicePath?: string;
      electrobunServicePath?: string;
      reactNativeServicePath?: string;
      flutterServicePath?: string;
      utilsPath: string;
      spyPath: string;
      corePath: string;
      mobileCorePath?: string;
      typesPath?: string;
      cdpBridgePath?: string;
    };
    if (options.skipBuild) {
      const findTgzFile = (dir: string, prefix: string): string => {
        const files = readdirSync(dir);
        const tgzFile = files.find((f) => f.startsWith(prefix) && f.endsWith('.tgz'));
        if (!tgzFile) {
          throw new Error(`No ${prefix} .tgz file found. Run without --skip-build first.`);
        }
        return normalize(join(dir, tgzFile));
      };

      const utilsDir = normalize(join(rootDir, 'packages', 'native-utils'));
      const spyDir = normalize(join(rootDir, 'packages', 'native-spy'));
      const coreDir = normalize(join(rootDir, 'packages', 'native-core'));
      packages = {
        utilsPath: findTgzFile(utilsDir, 'wdio-native-utils-'),
        spyPath: findTgzFile(spyDir, 'wdio-native-spy-'),
        corePath: findTgzFile(coreDir, 'wdio-native-core-'),
      };

      if (options.service === 'electron' || options.service === 'all') {
        const electronServiceDir = normalize(join(rootDir, 'packages', 'electron-service'));
        const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
        const cdpBridgeDir = normalize(join(rootDir, 'packages', 'native-cdp-bridge'));
        packages.electronServicePath = findTgzFile(electronServiceDir, 'wdio-electron-service-');
        packages.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
        packages.cdpBridgePath = findTgzFile(cdpBridgeDir, 'wdio-native-cdp-bridge-');
      }

      if (options.service === 'tauri' || options.service === 'all') {
        const tauriServiceDir = normalize(join(rootDir, 'packages', 'tauri-service'));
        const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
        packages.tauriServicePath = findTgzFile(tauriServiceDir, 'wdio-tauri-service-');
        packages.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
      }

      if (options.service === 'dioxus' || options.service === 'all') {
        const dioxusServiceDir = normalize(join(rootDir, 'packages', 'dioxus-service'));
        const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
        packages.dioxusServicePath = findTgzFile(dioxusServiceDir, 'wdio-dioxus-service-');
        packages.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
      }

      if (options.service === 'electrobun') {
        const electrobunServiceDir = normalize(join(rootDir, 'packages', 'electrobun-service'));
        const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
        const cdpBridgeDir = normalize(join(rootDir, 'packages', 'native-cdp-bridge'));
        packages.electrobunServicePath = findTgzFile(electrobunServiceDir, 'wdio-electrobun-service-');
        packages.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
        packages.cdpBridgePath = findTgzFile(cdpBridgeDir, 'wdio-native-cdp-bridge-');
      }

      if (options.service === 'react-native') {
        const rnServiceDir = normalize(join(rootDir, 'packages', 'react-native-service'));
        const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
        const cdpBridgeDir = normalize(join(rootDir, 'packages', 'native-cdp-bridge'));
        const mobileCoreDir = normalize(join(rootDir, 'packages', 'native-mobile-core'));
        packages.reactNativeServicePath = findTgzFile(rnServiceDir, 'wdio-react-native-service-');
        packages.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
        packages.cdpBridgePath = findTgzFile(cdpBridgeDir, 'wdio-native-cdp-bridge-');
        packages.mobileCorePath = findTgzFile(mobileCoreDir, 'wdio-native-mobile-core-');
      }

      if (options.service === 'flutter') {
        const flutterServiceDir = normalize(join(rootDir, 'packages', 'flutter-service'));
        const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
        const mobileCoreDir = normalize(join(rootDir, 'packages', 'native-mobile-core'));
        packages.flutterServicePath = findTgzFile(flutterServiceDir, 'wdio-flutter-service-');
        packages.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
        packages.mobileCorePath = findTgzFile(mobileCoreDir, 'wdio-native-mobile-core-');
      }

      log(`📦 Using existing packages:`);
      log(`   Utils: ${packages.utilsPath}`);
      log(`   Spy: ${packages.spyPath}`);
      log(`   Core: ${packages.corePath}`);
      if (packages.electronServicePath) {
        log(`   Electron Service: ${packages.electronServicePath}`);
        log(`   Types: ${packages.typesPath}`);
        log(`   CDP Bridge: ${packages.cdpBridgePath}`);
      }
      if (packages.tauriServicePath) {
        log(`   Tauri Service: ${packages.tauriServicePath}`);
      }
      if (packages.dioxusServicePath) {
        log(`   Dioxus Service: ${packages.dioxusServicePath}`);
      }
      if (packages.electrobunServicePath) {
        log(`   Electrobun Service: ${packages.electrobunServicePath}`);
        log(`   CDP Bridge: ${packages.cdpBridgePath}`);
      }
      if (packages.reactNativeServicePath) {
        log(`   React Native Service: ${packages.reactNativeServicePath}`);
        log(`   CDP Bridge: ${packages.cdpBridgePath}`);
      }
    } else {
      packages = await buildAndPackService(options.service);
    }

    const packagesDir = normalize(join(rootDir, 'fixtures', 'package-tests'));
    if (!existsSync(packagesDir)) {
      throw new Error(`Packages directory not found: ${packagesDir}`);
    }

    const packageTestDirs = readdirSync(packagesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .filter((name) => !name.startsWith('.'));

    let filteredDirs = packageTestDirs;
    if (options.service === 'electron') {
      filteredDirs = packageTestDirs.filter((name) => name.startsWith('electron-'));
    } else if (options.service === 'tauri') {
      filteredDirs = packageTestDirs.filter((name) => name.startsWith('tauri-'));
    } else if (options.service === 'dioxus') {
      filteredDirs = packageTestDirs.filter((name) => name.startsWith('dioxus-'));
    } else if (options.service === 'electrobun') {
      filteredDirs = packageTestDirs.filter((name) => name.startsWith('electrobun-'));
    } else if (options.service === 'react-native') {
      filteredDirs = packageTestDirs.filter((name) => name.startsWith('react-native-'));
    } else if (options.service === 'flutter') {
      filteredDirs = packageTestDirs.filter((name) => name.startsWith('flutter-'));
    } else {
      // The other services need a device or a specific OS, so `all` doesn't pack them and leaves their fixtures out.
      filteredDirs = packageTestDirs.filter(
        (name) => !name.startsWith('electrobun-') && !name.startsWith('react-native-') && !name.startsWith('flutter-'),
      );
    }

    if (options.service === 'electron' || options.service === 'all') {
      if (options.moduleType === 'cjs') {
        filteredDirs = filteredDirs.filter((name) => name.endsWith('-cjs') || !name.match(/-cjs$|-esm$/));
      } else if (options.moduleType === 'esm') {
        filteredDirs = filteredDirs.filter((name) => name.endsWith('-esm') || !name.match(/-cjs$|-esm$/));
      }
    }

    if (options.mode === 'browser') {
      filteredDirs = filteredDirs.filter((name) => existsSync(join(packagesDir, name, 'wdio.browser.conf.ts')));
    }

    let packagesToTest = options.package ? filteredDirs.filter((name) => name === options.package) : filteredDirs;

    if (
      options.moduleType === 'both' &&
      !options.package &&
      (options.service === 'electron' || options.service === 'all')
    ) {
      const expandedPackages: string[] = [];
      const seenBaseNames = new Set<string>();

      for (const dir of packagesToTest) {
        if (dir.endsWith('-cjs') || dir.endsWith('-esm')) {
          const baseName = dir.replace(/-cjs$|-esm$/, '');
          if (!seenBaseNames.has(baseName)) {
            seenBaseNames.add(baseName);
            const cjsVariant = `${baseName}-cjs`;
            const esmVariant = `${baseName}-esm`;
            if (filteredDirs.includes(cjsVariant)) {
              expandedPackages.push(cjsVariant);
            }
            if (filteredDirs.includes(esmVariant)) {
              expandedPackages.push(esmVariant);
            }
          }
        } else {
          expandedPackages.push(dir);
        }
      }

      packagesToTest = expandedPackages.length > 0 ? expandedPackages : packagesToTest;
    }

    if (packagesToTest.length === 0) {
      if (options.package) {
        throw new Error(`Package '${options.package}' not found. Available: ${packageTestDirs.join(', ')}`);
      } else {
        throw new Error(`No packages found in ${packagesDir}`);
      }
    }

    log(`Found packages to test: ${packagesToTest.join(', ')}`);

    for (const packageName of packagesToTest) {
      const packagePath = normalize(join(packagesDir, packageName));

      const packageJsonPath = join(packagePath, 'package.json');
      if (!existsSync(packageJsonPath)) {
        log(`⏭️  Skipping ${packageName} (no package.json found)`);
        continue;
      }

      const servicePrefixes = [
        ['tauri-', 'tauri'],
        ['dioxus-', 'dioxus'],
        ['electrobun-', 'electrobun'],
        ['react-native-', 'react-native'],
        ['flutter-', 'flutter'],
      ] as const;
      const detectedService: 'electron' | 'tauri' | 'dioxus' | 'electrobun' | 'react-native' | 'flutter' =
        servicePrefixes.find(([prefix]) => packageName.startsWith(prefix))?.[1] ?? 'electron';

      if (detectedService === 'electron') {
        const moduleType = packageName.endsWith('-cjs') ? 'CJS' : packageName.endsWith('-esm') ? 'ESM' : 'Unknown';
        log(`Testing ${packageName} (${moduleType})`);
      }

      await testExample(packagePath, packages, detectedService, options.skipBuild ?? false, options.mode);
    }

    log(`🎉 All package tests completed successfully!`);
  } catch (error) {
    console.error('❌ Package testing failed:');
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exit(1);
  }
}

// A Windows path needs file:/// before its drive letter.
const isMainModule = (() => {
  try {
    const scriptPath = normalize(process.argv[1]);
    const scriptUrl =
      process.platform === 'win32' ? `file:///${scriptPath.replace(/\\/g, '/')}` : `file://${scriptPath}`;
    return import.meta.url === scriptUrl;
  } catch (_error) {
    return __filename === process.argv[1] || __filename === normalize(process.argv[1]);
  }
})();

if (isMainModule) {
  main().catch((error) => {
    console.error('❌ Unhandled error in main:');
    console.error(error);
    process.exit(1);
  });
}
