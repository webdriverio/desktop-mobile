#!/usr/bin/env node
/**
 * Script to test the wdio-electron-service, wdio-tauri-service, and wdio-dioxus-service packages in the package test apps
 * Usage: node scripts/test-package.ts [--package=<package-name>] [--service=<electron|tauri|dioxus|electrobun|all>] [--module-type=<cjs|esm|both>] [--mode=<native|browser>] [--skip-build]
 *
 * Examples:
 * node scripts/test-package.ts
 * node scripts/test-package.ts --service=electron
 * node scripts/test-package.ts --service=electron --module-type=cjs
 * node scripts/test-package.ts --service=electron --module-type=esm
 * node scripts/test-package.ts --service=electron --mode=browser
 * node scripts/test-package.ts --service=tauri
 * node scripts/test-package.ts --service=dioxus
 * node scripts/test-package.ts --service=electrobun  (macOS only)
 * node scripts/test-package.ts --package=electron-builder-app-cjs
 * node scripts/test-package.ts --package=electron-builder-app-esm
 * node scripts/test-package.ts --package=tauri-app --skip-build
 * node scripts/test-package.ts --package=dioxus-app --skip-build
 */

import { execSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// Add global error handlers to catch silent failures
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Fix Windows path handling for fileURLToPath
const __filename = (() => {
  try {
    const url = import.meta.url;
    return process.platform === 'win32' ? fileURLToPath(url) : fileURLToPath(url);
  } catch (_error) {
    return process.argv[1];
  }
})();

const __dirname = dirname(__filename);
const rootDir = normalize(join(__dirname, '..'));

/**
 * Reads version overrides from the workspace's pnpm-workspace.yaml so the isolated
 * package-test install resolves the same dependency versions as the monorepo.
 * Without this, a transitive version fix pinned at the workspace level never reaches
 * the sandbox, so a fixture can resolve a known-broken dependency and fail in ways
 * that don't reproduce locally. file:/link:/workspace: specs are skipped — they
 * point at monorepo-relative paths that can't resolve from the temp dir.
 */
function readWorkspaceOverrides(): Record<string, string> {
  const workspaceYamlPath = join(rootDir, 'pnpm-workspace.yaml');
  if (!existsSync(workspaceYamlPath)) {
    return {};
  }
  const parsed = parseYaml(readFileSync(workspaceYamlPath, 'utf-8')) as { overrides?: Record<string, string> };
  const overrides = parsed?.overrides ?? {};
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
  /** 'native' runs the existing app-launch tests. 'browser' starts a static
   * HTTP server against the fixture's `browser/` directory and runs the
   * browser-mode wdio config. Picks up any fixture (Electron or Tauri) that
   * provides a wdio.browser.conf.ts and a browser/ directory. */
  mode?: 'native' | 'browser';
}

function log(message: string) {
  console.log(`🔧 ${message}`);
}

function execCommand(command: string, cwd: string, description: string) {
  log(`${description}...`);

  // On Windows, pnpm install in isolated package-test environments
  // intermittently exits non-zero without printing its actual error to
  // stderr (AV interference / global-store contention is suspected). Retry
  // once for pnpm commands before surfacing the failure.
  const isPnpm = command.startsWith('pnpm ');
  const maxAttempts = isPnpm && process.platform === 'win32' ? 2 : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      execSync(command, {
        cwd: normalize(cwd),
        stdio: 'inherit',
        encoding: 'utf-8',
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      });
      if (attempt > 1) log(`(retry ${attempt - 1} succeeded)`);
      log(`✅ ${description} completed`);
      return;
    } catch (error) {
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

/**
 * Async variant of execCommand for browser-mode tests, where the static dev server runs in
 * THIS process. execSync would block the event loop for the entire wdio run, so the in-process
 * server could never answer Chrome and the page navigation would time out. spawn keeps the loop
 * free; we await the child's exit and surface a non-zero code as a throw, matching execCommand.
 */
function execCommandAsync(command: string, cwd: string, description: string): Promise<void> {
  log(`${description}...`);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, {
      cwd: normalize(cwd),
      stdio: 'inherit',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
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
  // Shared mobile launcher/runtime layer — a workspace dep of both react-native and
  // flutter services, so it must be packed + overridden alongside them.
  mobileCorePath?: string;
  typesPath?: string;
  // Holds the shared @wdio/native-cdp-bridge tarball for `electron`/`electrobun`/`react-native` —
  // these services never pack together (they are not part of `all`), so one field is unambiguous
  // per run.
  cdpBridgePath?: string;
}> {
  log(`Building and packing services and dependencies (service: ${service})...`);

  try {
    // Build only the packages required for the requested service. Each
    // service depends on @wdio/native-core (extracted in the Dioxus
    // foundation work), so include it in every filter set.
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
      // `all` builds every package; it does NOT include electrobun/react-native/flutter fixtures —
      // those are device-gated and always run via their own `--service=` jobs.
      all: '--filter=./packages/*',
    };
    execCommand(`pnpm turbo run build ${buildFilters[service]}`, rootDir, `Building packages for ${service}`);

    // Pack native-utils (required for all services)
    const utilsDir = normalize(join(rootDir, 'packages', 'native-utils'));
    if (!existsSync(utilsDir)) {
      throw new Error(`Utils directory does not exist: ${utilsDir}`);
    }
    execCommand('pnpm pack', utilsDir, 'Packing @wdio/native-utils');

    // Pack native-spy (required for all services)
    const spyDir = normalize(join(rootDir, 'packages', 'native-spy'));
    if (!existsSync(spyDir)) {
      throw new Error(`Spy directory does not exist: ${spyDir}`);
    }
    execCommand('pnpm pack', spyDir, 'Packing @wdio/native-spy');

    // Pack native-core (required for all services — shared launcher
    // infrastructure introduced with the Dioxus foundation work)
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

    // Pack Electron service and dependencies if needed
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

    // Pack Tauri service if needed
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

    // Pack Dioxus service if needed
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

    // Pack Electrobun service if needed (CDP archetype like Electron: service +
    // native-types + the shared native-cdp-bridge). Never part of `all`.
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

    // Pack React Native service if needed (CDP archetype: service + native-types +
    // native-cdp-bridge). Never part of `all` — requires Appium + device.
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

    // Pack Flutter service if needed (Dart-VM archetype: service + native-types +
    // native-mobile-core; no cdp-bridge — Flutter drives the Dart VM Service, not CDP).
    // Never part of `all` — requires Appium + device.
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

/**
 * Serve a directory of static files over HTTP on a fixed port. Returns the
 * server handle so the caller can `close()` it after tests run. Used in
 * browser-mode package tests where the fixture's `browser/` directory needs to
 * be reachable at a dev-server URL so the worker can navigate to it.
 *
 * The set of served files is enumerated at startup; the request handler only
 * looks up by request URL into that map, so user-controlled input never flows
 * into a `readFileSync` argument.
 */
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

  // Create isolated test environment to avoid pnpm hoisting issues.
  // On Windows os.tmpdir() is an 8.3 short-name path (C:\Users\RUNNER~1\...). vite
  // realpath-resolves build inputs but leaves config.root un-resolved, so vite:build-html
  // emits a `../`-laden index.html fileName that Rolldown rejects (vitejs/vite#10802).
  // Canonicalising the base here makes config.root match vite's realpath'd ids.
  const testId = Date.now();
  const tempBase = process.platform === 'win32' ? realpathSync.native(tmpdir()) : tmpdir();
  const tempDir = normalize(join(tempBase, `wdio-package-test-${testId}`));
  const packageDir = normalize(join(tempDir, packageName));

  // Define logs directory path for reuse throughout function
  const logsDir = join(packageDir, 'logs');

  try {
    log(`Creating isolated test environment at ${tempDir}`);
    mkdirSync(tempDir, { recursive: true });
    cpSync(packagePath, packageDir, { recursive: true });

    // Create .pnpmrc to prevent hoisting and ensure proper resolution
    const pnpmrcPath = join(packageDir, '.pnpmrc');
    writeFileSync(pnpmrcPath, 'hoist=false\nnode-linker=isolated\n');

    // Add pnpm overrides to package.json to force local package versions
    const packageJsonPath = join(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      throw new Error(`package.json not found at ${packageJsonPath}`);
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    // Carry over non-file overrides from the source package.json
    // File-path overrides (like @wdio/utils) won't resolve from the temp dir and are
    // replaced by the dynamic overrides below.
    const sourceOverrides: Record<string, string> = packageJson.pnpm?.overrides ?? {};
    const preservedOverrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(sourceOverrides)) {
      if (!value.startsWith('file:')) {
        preservedOverrides[key] = value;
        log(`  Preserving source override: ${key}@${value}`);
      }
    }

    // Inherit workspace-level overrides so the sandboxed install resolves the same
    // dependency versions as the monorepo.
    const workspaceOverrides = readWorkspaceOverrides();
    for (const [key, value] of Object.entries(workspaceOverrides)) {
      log(`  Applying workspace override: ${key}@${value}`);
    }

    // Build overrides and packages to install based on service type. Precedence
    // (lowest → highest): workspace, fixture source, local @wdio/* file overrides.
    const overrides: Record<string, string> = {
      ...workspaceOverrides,
      ...preservedOverrides,
      '@wdio/native-utils': `file:${packages.utilsPath}`,
      '@wdio/native-spy': `file:${packages.spyPath}`,
      '@wdio/native-core': `file:${packages.corePath}`,
    };
    const packagesToInstall: string[] = [packages.utilsPath, packages.spyPath, packages.corePath];

    // Add @wdio/utils override if the tarball exists
    const wdioUtilsTarball = join(rootDir, 'wdio-utils-9.23.3.tgz');
    if (existsSync(wdioUtilsTarball)) {
      overrides['@wdio/utils'] = `file:${wdioUtilsTarball}`;
      packagesToInstall.push(wdioUtilsTarball);
      log(`  Adding @wdio/utils override: ${wdioUtilsTarball}`);
    }

    if (service === 'electron') {
      if (!packages.electronServicePath || !packages.typesPath || !packages.cdpBridgePath) {
        throw new Error('Electron service packages not available');
      }
      overrides['@wdio/electron-service'] = `file:${packages.electronServicePath}`;
      overrides['@wdio/native-types'] = `file:${packages.typesPath}`;
      overrides['@wdio/native-cdp-bridge'] = `file:${packages.cdpBridgePath}`;
      packagesToInstall.push(packages.typesPath, packages.cdpBridgePath, packages.electronServicePath);
    } else if (service === 'tauri') {
      if (!packages.tauriServicePath || !packages.typesPath) {
        throw new Error('Tauri service packages not available');
      }
      overrides['@wdio/tauri-service'] = `file:${packages.tauriServicePath}`;
      overrides['@wdio/native-types'] = `file:${packages.typesPath}`;
      packagesToInstall.push(packages.typesPath, packages.tauriServicePath);
    } else if (service === 'dioxus') {
      if (!packages.dioxusServicePath || !packages.typesPath) {
        throw new Error('Dioxus service packages not available');
      }
      overrides['@wdio/dioxus-service'] = `file:${packages.dioxusServicePath}`;
      overrides['@wdio/native-types'] = `file:${packages.typesPath}`;
      packagesToInstall.push(packages.typesPath, packages.dioxusServicePath);
    } else if (service === 'electrobun') {
      if (!packages.electrobunServicePath || !packages.typesPath || !packages.cdpBridgePath) {
        throw new Error('Electrobun service packages not available');
      }
      overrides['@wdio/electrobun-service'] = `file:${packages.electrobunServicePath}`;
      overrides['@wdio/native-types'] = `file:${packages.typesPath}`;
      overrides['@wdio/native-cdp-bridge'] = `file:${packages.cdpBridgePath}`;
      packagesToInstall.push(packages.typesPath, packages.cdpBridgePath, packages.electrobunServicePath);
    } else if (service === 'react-native') {
      if (
        !packages.reactNativeServicePath ||
        !packages.typesPath ||
        !packages.cdpBridgePath ||
        !packages.mobileCorePath
      ) {
        throw new Error('React Native service packages not available');
      }
      overrides['@wdio/react-native-service'] = `file:${packages.reactNativeServicePath}`;
      overrides['@wdio/native-types'] = `file:${packages.typesPath}`;
      overrides['@wdio/native-cdp-bridge'] = `file:${packages.cdpBridgePath}`;
      overrides['@wdio/native-mobile-core'] = `file:${packages.mobileCorePath}`;
      packagesToInstall.push(
        packages.typesPath,
        packages.cdpBridgePath,
        packages.mobileCorePath,
        packages.reactNativeServicePath,
      );
    } else if (service === 'flutter') {
      if (!packages.flutterServicePath || !packages.typesPath || !packages.mobileCorePath) {
        throw new Error('Flutter service packages not available');
      }
      overrides['@wdio/flutter-service'] = `file:${packages.flutterServicePath}`;
      overrides['@wdio/native-types'] = `file:${packages.typesPath}`;
      overrides['@wdio/native-mobile-core'] = `file:${packages.mobileCorePath}`;
      packagesToInstall.push(packages.typesPath, packages.mobileCorePath, packages.flutterServicePath);
    }

    packageJson.pnpm = {
      ...packageJson.pnpm,
      overrides,
    };

    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // Install all dependencies with pnpm
    execCommand('pnpm install', packageDir, `Installing dependencies for ${packageName}`);

    // Install local packages
    const addCommand = `pnpm add ${packagesToInstall.join(' ')}`;
    execCommand(addCommand, packageDir, `Installing local packages for ${packageName}`);

    // Ensure logs directory exists for WebdriverIO output
    mkdirSync(logsDir, { recursive: true });
    log(`✅ Created logs directory: ${logsDir}`);

    // For Tauri apps, ensure the plugins are available as Rust dependencies.
    // The plugins are path dependencies (../../../../packages/<plugin> from src-tauri/Cargo.toml)
    // and need to be copied to the corresponding relative location in the isolated environment.
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

          if (!pathPattern.test(cargoToml)) continue;

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

    // For Dioxus apps, copy the embedded driver as a Rust path dependency
    if (service === 'dioxus') {
      const embeddedDriverSourceDir = join(rootDir, 'packages', 'dioxus-embedded-driver');
      const embeddedDriverDestDir = join(tempDir, 'packages', 'dioxus-embedded-driver');
      const cargoTomlPath = join(packageDir, 'src-dioxus', 'Cargo.toml');

      if (existsSync(cargoTomlPath)) {
        let cargoToml = readFileSync(cargoTomlPath, 'utf-8');
        if (cargoToml.includes('wdio-dioxus-embedded-driver') && cargoToml.includes('path =')) {
          if (existsSync(embeddedDriverSourceDir)) {
            log(`Copying embedded driver source for Rust dependency resolution...`);
            mkdirSync(dirname(embeddedDriverDestDir), { recursive: true });
            cpSync(embeddedDriverSourceDir, embeddedDriverDestDir, { recursive: true });
            log(`✅ Embedded driver source copied to ${embeddedDriverDestDir}`);

            // wdio-dioxus-embedded-driver has a path dep on wdio-dioxus-bridge
            // (path = "../dioxus-bridge"). Copy the bridge alongside the driver so
            // Cargo can resolve it from the isolated tempDir.
            const bridgeSourceDir = join(rootDir, 'packages', 'dioxus-bridge');
            const bridgeDestDir = join(tempDir, 'packages', 'dioxus-bridge');
            if (existsSync(bridgeSourceDir)) {
              cpSync(bridgeSourceDir, bridgeDestDir, { recursive: true });
              log(`✅ Bridge source copied to ${bridgeDestDir}`);
            } else {
              log(`⚠️  Bridge source not found at ${bridgeSourceDir}`);
            }

            const oldPathPattern =
              /(wdio-dioxus-embedded-driver\s*=\s*\{\s*path\s*=\s*)"\.\.\/\.\.\/\.\.\/\.\.\/packages\/dioxus-embedded-driver"(\s*[,}])/;
            if (oldPathPattern.test(cargoToml)) {
              const absoluteDriverPath = normalize(embeddedDriverDestDir).replace(/\\/g, '/');
              cargoToml = cargoToml.replace(oldPathPattern, `$1"${absoluteDriverPath}"$2`);
              writeFileSync(cargoTomlPath, cargoToml);
              log(`✅ Updated Cargo.toml path dependency to: ${absoluteDriverPath}`);
            } else {
              log(
                `⚠️  Could not rewrite wdio-dioxus-embedded-driver path dep — pattern did not match. Cargo build may fail if the relative path is unreachable from the isolated environment.`,
              );
            }
          } else {
            log(`⚠️  Embedded driver source not found at ${embeddedDriverSourceDir}`);
          }
        }
      }
    }

    // Handle building/copying for different service types. Browser mode runs
    // the frontend in plain Chrome against the static fixture, so the Tauri
    // plugin build, web build, and pre-built binary are all irrelevant —
    // skip the entire block.
    if (service === 'tauri' && mode === 'native') {
      const pluginSourceDir = join(rootDir, 'packages', 'tauri-plugin');
      const pluginDistJsDir = join(pluginSourceDir, 'dist-js');

      // The built plugin should already exist from the main pnpm build step
      // Copy the built plugin JS to the location expected by build:web script
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

      // Run the build:web script which will copy the plugin JS into dist/plugins
      if (packageJson.scripts?.['build:web']) {
        execCommand('pnpm build:web', packageDir, `Building web frontend for ${packageName}`);
      }

      // Copy the workspace target directory from pre-built artifacts
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
          // Add debugging before build
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

              // Check if plugin permissions are referenced
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

          // Check if plugin is accessible
          const pluginPath = join(tempDir, 'packages', 'tauri-plugin');
          log(`   Plugin path: ${pluginPath} (exists: ${existsSync(pluginPath)})`);
          if (existsSync(pluginPath)) {
            const pluginPermissions = join(pluginPath, 'permissions');
            log(`   Plugin permissions: ${pluginPermissions} (exists: ${existsSync(pluginPermissions)})`);
          }

          // Check Cargo.toml for plugin dependency
          if (existsSync(cargoToml)) {
            const cargoTomlContent = readFileSync(cargoToml, 'utf-8');
            if (cargoTomlContent.includes('tauri-plugin-wdio')) {
              log(`   ✅ Plugin dependency found in Cargo.toml`);
            } else {
              log(`   ❌ Plugin dependency NOT found in Cargo.toml`);
            }
          }

          execCommand('pnpm build', packageDir, `Building ${packageName} app`);

          // After build, check if gen directory was created
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
      // Dioxus: use pre-built binary when skipBuild=true (CI downloads it as a separate artifact)
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
      // CDP-attach CEF bundle. CI builds it as a separate macOS artifact (the ~150MB
      // CEF download is slow), so in skipBuild mode copy the pre-built bundle rather
      // than re-running `electrobun build` in the isolated environment.
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
      // Build other apps (e.g. Electron) in isolated environment
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
      // Browser mode serves the dev server from this process, so it must not block the event
      // loop while wdio runs (see execCommandAsync). Native mode has no in-process server.
      if (mode === 'browser') {
        await execCommandAsync(testScript, packageDir, `Running ${mode} tests for ${packageName}`);
      } else {
        execCommand(testScript, packageDir, `Running ${mode} tests for ${packageName}`);
      }
    } finally {
      if (staticServer) {
        // Capture in a const so the closure narrows the type — staticServer
        // is a `let` and TS widens it back to Server | undefined inside the
        // callback, matching the optional-chain pattern in the e2e conf.
        const server = staticServer;
        await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
        log(`Stopped static server for ${packageName}`);
      }
    }

    log(`✅ ${packageName} tests passed!`);

    // Preserve logs for CI artifact upload before cleanup
    log(`🔍 Checking for logs in: ${logsDir}`);
    if (existsSync(logsDir)) {
      const allFiles = readdirSync(logsDir);
      const logFiles = allFiles.filter((f) => f.endsWith('.log'));
      log(`📋 Found ${logFiles.length} log files: ${logFiles.join(', ')}`);

      if (logFiles.length > 0) {
        const ciLogsDir = join(rootDir, 'logs', 'package-tests');
        mkdirSync(ciLogsDir, { recursive: true });

        // Copy logs with package name prefix to avoid conflicts
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

    // Preserve logs even on failure for debugging
    log(`🔍 Checking for failure logs in: ${logsDir}`);
    if (existsSync(logsDir)) {
      const allFiles = readdirSync(logsDir);
      const logFiles = allFiles.filter((f) => f.endsWith('.log'));
      log(`📋 Found ${logFiles.length} failure log files: ${logFiles.join(', ')}`);

      if (logFiles.length > 0) {
        const ciLogsDir = join(rootDir, 'logs', 'package-tests');
        mkdirSync(ciLogsDir, { recursive: true });

        // Copy logs with package name prefix to avoid conflicts
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
    // Copy logs back to source directory for debugging
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

    // Clean up isolated environment
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

    // Validate service argument if provided, default to 'all' if not provided
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

    // Build and pack service (unless skipped)
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
      // Find existing .tgz files
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

    // Find packages to test
    const packagesDir = normalize(join(rootDir, 'fixtures', 'package-tests'));
    if (!existsSync(packagesDir)) {
      throw new Error(`Packages directory not found: ${packagesDir}`);
    }

    const packageTestDirs = readdirSync(packagesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .filter((name) => !name.startsWith('.'));

    // Filter packages by service type (electron-* vs tauri-* vs dioxus-*)
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
      // 'all' = electron + tauri + dioxus (the services sharing the cross-OS matrix).
      // Electrobun, react-native and flutter are NEVER part of 'all' — they are
      // platform/device-gated and buildAndPackService('all') doesn't pack their tarballs, so
      // their fixtures must be excluded or a bare `pnpm test:package` would try to test them
      // without a packed service and throw. Run them explicitly via `--service=electrobun` /
      // `--service=react-native` / `--service=flutter`.
      filteredDirs = packageTestDirs.filter(
        (name) => !name.startsWith('electrobun-') && !name.startsWith('react-native-') && !name.startsWith('flutter-'),
      );
    }

    // Filter by module type for Electron packages
    if (options.service === 'electron' || options.service === 'all') {
      if (options.moduleType === 'cjs') {
        filteredDirs = filteredDirs.filter((name) => name.endsWith('-cjs') || !name.match(/-cjs$|-esm$/));
      } else if (options.moduleType === 'esm') {
        filteredDirs = filteredDirs.filter((name) => name.endsWith('-esm') || !name.match(/-cjs$|-esm$/));
      }
      // If moduleType is 'both', include all variants
    }

    // Browser mode only runs against fixtures that have a wdio.browser.conf.ts
    // and a browser/ directory to serve. Today that's just the script-app
    // variants; expand the allowlist when more fixtures opt in.
    if (options.mode === 'browser') {
      filteredDirs = filteredDirs.filter((name) => existsSync(join(packagesDir, name, 'wdio.browser.conf.ts')));
    }

    // Filter packages if specific one requested
    let packagesToTest = options.package ? filteredDirs.filter((name) => name === options.package) : filteredDirs;

    // If moduleType is 'both' and no specific package requested, expand to include both variants
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
            // Add both variants
            const cjsVariant = `${baseName}-cjs`;
            const esmVariant = `${baseName}-esm`;
            if (filteredDirs.includes(cjsVariant)) expandedPackages.push(cjsVariant);
            if (filteredDirs.includes(esmVariant)) expandedPackages.push(esmVariant);
          }
        } else {
          // Not a variant, add as-is
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

    // Test each package
    for (const packageName of packagesToTest) {
      const packagePath = normalize(join(packagesDir, packageName));

      // Skip if it's just a placeholder (no package.json)
      const packageJsonPath = join(packagePath, 'package.json');
      if (!existsSync(packageJsonPath)) {
        log(`⏭️  Skipping ${packageName} (no package.json found)`);
        continue;
      }

      // Detect service type from the package-name prefix (already filtered, but
      // testExample needs it). Electron is the default — its fixtures carry no prefix.
      const servicePrefixes = [
        ['tauri-', 'tauri'],
        ['dioxus-', 'dioxus'],
        ['electrobun-', 'electrobun'],
        ['react-native-', 'react-native'],
        ['flutter-', 'flutter'],
      ] as const;
      const detectedService: 'electron' | 'tauri' | 'dioxus' | 'electrobun' | 'react-native' | 'flutter' =
        servicePrefixes.find(([prefix]) => packageName.startsWith(prefix))?.[1] ?? 'electron';

      // Log module type for Electron packages
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

// Fix main module detection for Windows
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
