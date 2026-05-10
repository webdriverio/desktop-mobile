import { execSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createLogger } from '@wdio/native-utils';
import type { TauriAppInfo } from './types.js';

const log = createLogger('tauri-service', 'utils');

/**
 * Get Tauri binary path for the given app directory
 */
export async function getTauriBinaryPath(
  appPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Promise<string> {
  log.debug(`Resolving Tauri binary path for: ${appPath}`);
  log.debug(`Platform: ${platform}, Arch: ${arch}`);

  // If appPath points to a binary, resolve to the app directory
  let appDir: string;
  if (appPath.includes('target') && (appPath.includes('release') || appPath.includes('debug'))) {
    // Extract app directory from binary path
    // Go up from target/debug to src-tauri, then up one more to the app root
    const pathParts = appPath.split(sep);
    const targetIndex = pathParts.indexOf('target');
    if (targetIndex > 0) {
      // Go up from target to src-tauri, then up one more to app root
      appDir = pathParts.slice(0, targetIndex - 1).join(sep);
    } else {
      appDir = appPath;
    }
  } else {
    appDir = appPath;
  }

  log.debug(`Resolved app directory: ${appDir}`);
  const appInfo = await getTauriAppInfo(appDir);

  // Platform-specific binary paths
  let binaryPath: string;
  const possiblePaths: string[] = [];

  if (platform === 'win32') {
    // Try raw .exe first
    possiblePaths.push(join(appInfo.targetDir, `${appInfo.name}.exe`));

    // Fall back to bundled MSI/NSIS if raw .exe doesn't exist
    const msiDir = join(appInfo.targetDir, 'bundle', 'msi');
    const nsisDir = join(appInfo.targetDir, 'bundle', 'nsis');

    // Check for .exe in NSIS bundle directory
    if (existsSync(nsisDir)) {
      const exeFiles = readdirSync(nsisDir).filter((f: string) => f.endsWith('.exe') && !f.includes('-setup'));
      for (const exe of exeFiles) {
        possiblePaths.push(join(nsisDir, exe));
      }
    }

    // MSI installers need to be extracted, so they're less useful for testing
    // But we'll note them for error messages
    if (existsSync(msiDir)) {
      const msiFiles = readdirSync(msiDir).filter((f: string) => f.endsWith('.msi'));
      for (const msi of msiFiles) {
        possiblePaths.push(join(msiDir, msi));
      }
    }
  } else if (platform === 'darwin') {
    // Try raw binary first (from tauri build without bundling)
    possiblePaths.push(join(appInfo.targetDir, appInfo.name));
    // Fall back to bundled .app if raw binary doesn't exist
    possiblePaths.push(join(appInfo.targetDir, 'bundle', 'macos', `${appInfo.name}.app`));
  } else if (platform === 'linux') {
    // Try raw binary first (from cargo build or tauri build without bundling)
    possiblePaths.push(join(appInfo.targetDir, appInfo.name.toLowerCase()));
    possiblePaths.push(join(appInfo.targetDir, appInfo.name));

    // Fall back to bundled AppImage if raw binary doesn't exist
    const bundleDir = join(appInfo.targetDir, 'bundle', 'appimage');
    if (existsSync(bundleDir)) {
      const appImageFiles = readdirSync(bundleDir).filter((f: string) => f.endsWith('.AppImage'));
      for (const appImage of appImageFiles) {
        possiblePaths.push(join(bundleDir, appImage));
      }
    }
  } else {
    throw new Error(`Unsupported platform for Tauri: ${platform}`);
  }

  // Find the first path that exists
  binaryPath = possiblePaths.find((path) => existsSync(path)) || possiblePaths[0];

  log.debug(`Checked paths: ${possiblePaths.join(', ')}`);
  log.debug(`Resolved binary path: ${binaryPath}`);

  if (!existsSync(binaryPath)) {
    const errorMsg =
      `Tauri binary not found. Checked the following locations:\n` +
      possiblePaths.map((p) => `  - ${p}`).join('\n') +
      `\n\nMake sure the app is built with: pnpm run build`;
    throw new Error(errorMsg);
  }

  // Ensure the binary is executable on Unix-like systems
  if (platform !== 'win32') {
    try {
      log.debug(`Setting execute permissions on: ${binaryPath}`);
      chmodSync(binaryPath, 0o755);
    } catch (error) {
      log.warn(`Failed to set execute permissions: ${error instanceof Error ? error.message : error}`);
    }
  }

  return binaryPath;
}

/**
 * Get Tauri app information from tauri.conf.json
 */
export async function getTauriAppInfo(appPath: string): Promise<TauriAppInfo> {
  const tauriConfigPath = join(appPath, 'src-tauri', 'tauri.conf.json');

  if (!existsSync(tauriConfigPath)) {
    throw new Error(`Tauri config not found: ${tauriConfigPath}`);
  }

  try {
    const configContent = readFileSync(tauriConfigPath, 'utf-8');
    const config = JSON.parse(configContent);

    // Tauri v2 has productName and version at root level
    const productName = config.productName || config.package?.productName || 'tauri-app';
    const version = config.version || config.package?.version || '1.0.0';

    // Use debug builds for testing (includes tauri-plugin-automation for CrabNebula macOS)
    const targetDir = join(appPath, 'src-tauri', 'target', 'debug');

    log.debug('Tauri config resolved:', {
      appPath,
      configPath: tauriConfigPath,
      productName,
      productNameRaw: config.productName,
      productNamePackage: config.package?.productName,
      targetDir,
    });

    return {
      name: productName,
      version,
      binaryPath: '', // Will be resolved by getTauriBinaryPath
      configPath: tauriConfigPath,
      targetDir,
    };
  } catch (error) {
    throw new Error(`Failed to parse Tauri config: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Check if Tauri app is built
 * This reuses getTauriBinaryPath which checks all possible locations
 */
export async function isTauriAppBuilt(appPath: string): Promise<boolean> {
  try {
    await getTauriBinaryPath(appPath);
    return true;
  } catch (error) {
    log.debug(`Tauri app not built: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

/**
 * Get WebKitWebDriver path for Linux
 * This is required by tauri-driver on Linux systems
 */
export function getWebKitWebDriverPath(): string | undefined {
  // Only needed on Linux
  if (process.platform !== 'linux') {
    return undefined;
  }

  // Try to find WebKitWebDriver in PATH
  try {
    const result = execSync('which WebKitWebDriver', { encoding: 'utf8' });
    const path = result.trim();
    if (path && existsSync(path)) {
      log.debug(`Found WebKitWebDriver at: ${path}`);
      return path;
    }
  } catch {
    log.debug('WebKitWebDriver not found in PATH');
  }

  // Fallback to common Linux installation paths
  const commonPaths = [
    '/usr/bin/WebKitWebDriver',
    '/usr/local/bin/WebKitWebDriver',
    '/usr/lib/webkit2gtk-4.0/WebKitWebDriver',
    '/usr/lib/webkit2gtk-4.1/WebKitWebDriver',
  ];

  for (const path of commonPaths) {
    if (existsSync(path)) {
      log.debug(`Found WebKitWebDriver at: ${path}`);
      return path;
    }
  }

  log.warn(
    'WebKitWebDriver not found. Please install it with: sudo apt-get install webkit2gtk-driver (or equivalent for your Linux distribution)',
  );
  return undefined;
}
