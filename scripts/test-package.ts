#!/usr/bin/env tsx
/**
 * Script to test the wdio-electron-service and wdio-tauri-service packages in the package test apps
 * Usage: pnpx tsx scripts/test-package.ts [--package=<package-name>] [--service=<electron|tauri|both>] [--module-type=<cjs|esm|both>] [--mode=<native|browser>] [--skip-build]
 *
 * Examples:
 * pnpx tsx scripts/test-package.ts
 * pnpx tsx scripts/test-package.ts --service=electron
 * pnpx tsx scripts/test-package.ts --service=electron --module-type=cjs
 * pnpx tsx scripts/test-package.ts --service=electron --module-type=esm
 * pnpx tsx scripts/test-package.ts --service=electron --mode=browser
 * pnpx tsx scripts/test-package.ts --service=tauri
 * pnpx tsx scripts/test-package.ts --package=electron-builder-app-cjs
 * pnpx tsx scripts/test-package.ts --package=electron-builder-app-esm
 * pnpx tsx scripts/test-package.ts --package=tauri-app --skip-build
 */

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

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

interface TestOptions {
  package?: string;
  skipBuild?: boolean;
  service?: 'electron' | 'tauri' | 'both';
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

  try {
    execSync(command, {
      cwd: normalize(cwd),
      stdio: 'inherit',
      encoding: 'utf-8',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    log(`✅ ${description} completed`);
  } catch (error) {
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

async function buildAndPackService(service: 'electron' | 'tauri' | 'both' = 'both'): Promise<{
  electronServicePath?: string;
  tauriServicePath?: string;
  utilsPath: string;
  spyPath: string;
  typesPath?: string;
  cdpBridgePath?: string;
}> {
  log(`Building and packing services and dependencies (service: ${service})...`);

  try {
    // Build only the packages required for the requested service
    const buildFilters: Record<'electron' | 'tauri' | 'both', string> = {
      electron: '--filter=@wdio/electron-service --filter=@wdio/native-spy',
      tauri: '--filter=@wdio/tauri-service',
      both: '--filter=./packages/*',
    };
    execCommand(`pnpm turbo run build ${buildFilters[service]}`, rootDir, `Building packages for ${service}`);

    // Pack native-utils (required for both services)
    const utilsDir = normalize(join(rootDir, 'packages', 'native-utils'));
    if (!existsSync(utilsDir)) {
      throw new Error(`Utils directory does not exist: ${utilsDir}`);
    }
    execCommand('pnpm pack', utilsDir, 'Packing @wdio/native-utils');

    // Pack native-spy (required for both services)
    const spyDir = normalize(join(rootDir, 'packages', 'native-spy'));
    if (!existsSync(spyDir)) {
      throw new Error(`Spy directory does not exist: ${spyDir}`);
    }
    execCommand('pnpm pack', spyDir, 'Packing @wdio/native-spy');

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

    const result: {
      electronServicePath?: string;
      tauriServicePath?: string;
      utilsPath: string;
      spyPath: string;
      typesPath?: string;
      cdpBridgePath?: string;
    } = { utilsPath, spyPath };

    // Pack Electron service and dependencies if needed
    if (service === 'electron' || service === 'both') {
      const electronServiceDir = normalize(join(rootDir, 'packages', 'electron-service'));
      const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
      const cdpBridgeDir = normalize(join(rootDir, 'packages', 'electron-cdp-bridge'));

      if (!existsSync(typesDir)) {
        throw new Error(`Types directory does not exist: ${typesDir}`);
      }
      if (!existsSync(cdpBridgeDir)) {
        throw new Error(`CDP Bridge directory does not exist: ${cdpBridgeDir}`);
      }

      execCommand('pnpm pack', typesDir, 'Packing @wdio/native-types');
      execCommand('pnpm pack', cdpBridgeDir, 'Packing @wdio/electron-cdp-bridge');
      execCommand('pnpm pack', electronServiceDir, 'Packing @wdio/electron-service');

      result.electronServicePath = findTgzFile(electronServiceDir, 'wdio-electron-service-');
      result.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
      result.cdpBridgePath = findTgzFile(cdpBridgeDir, 'wdio-electron-cdp-bridge-');
    }

    // Pack Tauri service if needed
    if (service === 'tauri' || service === 'both') {
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

    log(`📦 Packages packed:`);
    log(`   Utils: ${utilsPath}`);
    log(`   Spy: ${spyPath}`);
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
    utilsPath: string;
    spyPath: string;
    typesPath?: string;
    cdpBridgePath?: string;
  },
  service: 'electron' | 'tauri',
  _skipBuild: boolean,
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

  // Create isolated test environment to avoid pnpm hoisting issues
  const testId = Date.now();
  const tempDir = normalize(join(tmpdir(), `wdio-package-test-${testId}`));
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

    // Build overrides and packages to install based on service type
    const overrides: Record<string, string> = {
      ...preservedOverrides,
      '@wdio/native-utils': `file:${packages.utilsPath}`,
      '@wdio/native-spy': `file:${packages.spyPath}`,
    };
    const packagesToInstall: string[] = [packages.utilsPath, packages.spyPath];

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
      overrides['@wdio/electron-cdp-bridge'] = `file:${packages.cdpBridgePath}`;
      packagesToInstall.push(packages.typesPath, packages.cdpBridgePath, packages.electronServicePath);
    } else if (service === 'tauri') {
      if (!packages.tauriServicePath || !packages.typesPath) {
        throw new Error('Tauri service packages not available');
      }
      overrides['@wdio/tauri-service'] = `file:${packages.tauriServicePath}`;
      overrides['@wdio/native-types'] = `file:${packages.typesPath}`;
      packagesToInstall.push(packages.typesPath, packages.tauriServicePath);
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

    // For Tauri apps, ensure the plugin is available as a Rust dependency
    // The plugin is a path dependency (../../../../packages/tauri-plugin from src-tauri/Cargo.toml)
    // We need to copy it to the correct relative location in the isolated environment
    if (service === 'tauri') {
      const pluginSourceDir = join(rootDir, 'packages', 'tauri-plugin');
      // From tempDir/tauri-app/src-tauri/Cargo.toml, ../../../../packages/tauri-plugin
      // means: tempDir/packages/tauri-plugin
      const pluginDestDir = join(tempDir, 'packages', 'tauri-plugin');
      const cargoTomlPath = join(packageDir, 'src-tauri', 'Cargo.toml');

      if (existsSync(cargoTomlPath)) {
        let cargoToml = readFileSync(cargoTomlPath, 'utf-8');
        // Check if plugin is referenced as a path dependency
        if (cargoToml.includes('tauri-plugin-wdio') && cargoToml.includes('path =')) {
          // Copy plugin source to make it accessible from isolated environment
          // This includes the permissions directory which is needed for ACL manifest generation
          if (existsSync(pluginSourceDir)) {
            log(`Copying plugin source for Rust dependency resolution...`);
            mkdirSync(dirname(pluginDestDir), { recursive: true });
            cpSync(pluginSourceDir, pluginDestDir, { recursive: true });
            log(`✅ Plugin source copied to ${pluginDestDir}`);

            // Verify permissions directory was copied
            const permissionsDir = join(pluginDestDir, 'permissions');
            if (existsSync(permissionsDir)) {
              log(`✅ Plugin permissions directory found at ${permissionsDir}`);
            } else {
              log(`⚠️  Plugin permissions directory not found at ${permissionsDir}`);
            }

            // Update Cargo.toml path to point to the correct location in isolated environment
            // From tempDir/tauri-app/src-tauri, ../../packages/tauri-plugin points to tempDir/packages/tauri-plugin
            // Original path: ../../../../packages/tauri-plugin (for monorepo)
            // Isolated path: Use absolute path to avoid Cargo path resolution issues
            const oldPathPattern =
              /(tauri-plugin-wdio\s*=\s*\{\s*path\s*=\s*)"\.\.\/\.\.\/\.\.\/\.\.\/packages\/tauri-plugin"(\s*\})/;
            if (oldPathPattern.test(cargoToml)) {
              // Use absolute path to ensure Cargo can find it
              const absolutePluginPath = normalize(pluginDestDir);
              cargoToml = cargoToml.replace(oldPathPattern, `$1"${absolutePluginPath}"$2`);
              writeFileSync(cargoTomlPath, cargoToml);
              log(`✅ Updated Cargo.toml path dependency to absolute path: ${absolutePluginPath}`);
            }
          } else {
            log(`⚠️  Plugin source not found at ${pluginSourceDir}`);
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

      // Copy src-tauri/target directory from pre-built artifacts
      const sourceTargetDir = join(rootDir, 'fixtures', 'package-tests', 'tauri-app', 'src-tauri', 'target');
      const destTargetDir = join(packageDir, 'src-tauri', 'target');

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
    } else if (packageJson.scripts?.build && mode === 'native') {
      // Build Electron apps in isolated environment (browser mode skips the build)
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
      const testScript = mode === 'browser' ? 'pnpm test:browser' : 'pnpm test';
      execCommand(testScript, packageDir, `Running ${mode} tests for ${packageName}`);
    } finally {
      if (staticServer) {
        await new Promise<void>((resolveClose) => staticServer.close(() => resolveClose()));
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

    // Validate service argument if provided, default to 'both' if not provided
    let service: 'electron' | 'tauri' | 'both' = 'both';
    if (serviceArg) {
      if (serviceArg === 'electron' || serviceArg === 'tauri' || serviceArg === 'both') {
        service = serviceArg;
      } else {
        throw new Error(`Invalid service value: ${serviceArg}. Must be 'electron', 'tauri', or 'both'`);
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
      utilsPath: string;
      spyPath: string;
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
      packages = {
        utilsPath: findTgzFile(utilsDir, 'wdio-native-utils-'),
        spyPath: findTgzFile(spyDir, 'wdio-native-spy-'),
      };

      if (options.service === 'electron' || options.service === 'both') {
        const electronServiceDir = normalize(join(rootDir, 'packages', 'electron-service'));
        const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
        const cdpBridgeDir = normalize(join(rootDir, 'packages', 'electron-cdp-bridge'));
        packages.electronServicePath = findTgzFile(electronServiceDir, 'wdio-electron-service-');
        packages.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
        packages.cdpBridgePath = findTgzFile(cdpBridgeDir, 'wdio-electron-cdp-bridge-');
      }

      if (options.service === 'tauri' || options.service === 'both') {
        const tauriServiceDir = normalize(join(rootDir, 'packages', 'tauri-service'));
        const typesDir = normalize(join(rootDir, 'packages', 'native-types'));
        packages.tauriServicePath = findTgzFile(tauriServiceDir, 'wdio-tauri-service-');
        packages.typesPath = findTgzFile(typesDir, 'wdio-native-types-');
      }

      log(`📦 Using existing packages:`);
      log(`   Utils: ${packages.utilsPath}`);
      log(`   Spy: ${packages.spyPath}`);
      if (packages.electronServicePath) {
        log(`   Electron Service: ${packages.electronServicePath}`);
        log(`   Types: ${packages.typesPath}`);
        log(`   CDP Bridge: ${packages.cdpBridgePath}`);
      }
      if (packages.tauriServicePath) {
        log(`   Tauri Service: ${packages.tauriServicePath}`);
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

    // Filter packages by service type (electron-* vs tauri-*)
    let filteredDirs = packageTestDirs;
    if (options.service === 'electron') {
      filteredDirs = packageTestDirs.filter((name) => name.startsWith('electron-'));
    } else if (options.service === 'tauri') {
      filteredDirs = packageTestDirs.filter((name) => name.startsWith('tauri-'));
    }
    // If service is 'both', don't filter

    // Filter by module type for Electron packages
    if (options.service === 'electron' || options.service === 'both') {
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
      (options.service === 'electron' || options.service === 'both')
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

      // Detect service type from package name (already filtered by prefix, but needed for testExample)
      const detectedService: 'electron' | 'tauri' = packageName.startsWith('tauri-') ? 'tauri' : 'electron';

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
