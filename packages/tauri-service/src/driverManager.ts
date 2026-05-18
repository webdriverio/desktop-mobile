import { exec, execSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createLogger, Err, Ok, type Result } from '@wdio/native-utils';
import type { TauriServiceOptions } from './types.js';

const execAsync = promisify(exec);

const log = createLogger('tauri-service');

export interface DriverInstallSuccess {
  path: string;
  method: 'found' | 'installed' | 'cached';
}

export type DriverInstallResult = Result<DriverInstallSuccess, Error>;

/**
 * Check if cargo is available
 */
export function isCargoAvailable(): boolean {
  try {
    execSync('cargo --version', { encoding: 'utf8', stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if tauri-driver is installed and accessible
 */
export function findTauriDriver(): string | undefined {
  const isWindows = process.platform === 'win32';

  try {
    const command = isWindows ? 'where tauri-driver' : 'which tauri-driver';
    const result = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
    let path = result.trim().split('\n')[0]; // 'where' can return multiple paths

    // On Windows, convert Git Bash-style paths (/c/...) to Windows paths (C:\...)
    if (isWindows && path?.startsWith('/')) {
      path = convertGitBashPathToWindows(path);
    }

    if (path && existsSync(path)) {
      return path;
    }
  } catch {
    // Not found in PATH
  }

  // Check common installation paths
  const commonPaths = isWindows
    ? [
        join(process.env.USERPROFILE || 'C:\\Users\\Default', '.cargo', 'bin', 'tauri-driver.exe'),
        'C:\\Users\\runneradmin\\.cargo\\bin\\tauri-driver.exe', // GitHub Actions default
      ]
    : [
        '/usr/local/bin/tauri-driver',
        '/opt/homebrew/bin/tauri-driver',
        join(process.env.HOME || '~', '.cargo/bin/tauri-driver'),
      ];

  for (const path of commonPaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return undefined;
}

/**
 * Find a binary in node_modules
 * Searches common locations where npm packages install binaries
 *
 * @param packageName - The npm package name (e.g., '@crabnebula/tauri-driver')
 * @param binaryName - The binary name without extension (e.g., 'tauri-driver')
 * @returns The path to the binary if found, undefined otherwise
 */
function findBinaryInNodeModules(packageName: string, binaryName: string): string | undefined {
  const isWindows = process.platform === 'win32';

  // Check local node_modules .bin directory
  const localBinPaths = isWindows
    ? [
        join(process.cwd(), 'node_modules', '.bin', `${binaryName}.cmd`),
        join(process.cwd(), 'node_modules', '.bin', `${binaryName}.exe`),
      ]
    : [join(process.cwd(), 'node_modules', '.bin', binaryName)];

  for (const path of localBinPaths) {
    if (existsSync(path)) {
      log.debug(`Found ${binaryName} at: ${path}`);
      return path;
    }
  }

  // Try to resolve via require.resolve
  try {
    const pkgPath = require.resolve(`${packageName}/package.json`);
    const binDir = join(dirname(pkgPath), 'bin');
    const fullBinaryName = isWindows ? `${binaryName}.exe` : binaryName;
    const binPath = join(binDir, fullBinaryName);
    if (existsSync(binPath)) {
      log.debug(`Found ${binaryName} via require.resolve: ${binPath}`);
      return binPath;
    }
  } catch {
    // Package not found
  }

  return undefined;
}

/**
 * Find @crabnebula/tauri-driver in node_modules
 * Searches common locations where npm packages install binaries
 */
export function findCrabNebulaDriver(): string | undefined {
  return findBinaryInNodeModules('@crabnebula/tauri-driver', 'tauri-driver');
}

/**
 * Check if test-runner-backend is available
 * Required for CrabNebula macOS testing
 */
export function findTestRunnerBackend(): string | undefined {
  return findBinaryInNodeModules('@crabnebula/test-runner-backend', 'test-runner-backend');
}

/**
 * Install tauri-driver via cargo
 * Installs to the default cargo bin directory (~/.cargo/bin or %USERPROFILE%\.cargo\bin)
 */
export async function installTauriDriver(): Promise<string> {
  log.info('Installing tauri-driver via cargo...');
  log.warn('This may take several minutes on first run as cargo compiles from source.');

  // Install to default cargo bin directory (cargo handles this automatically)
  const cargoBinDir =
    process.platform === 'win32'
      ? join(process.env.USERPROFILE || 'C:\\Users\\Default', '.cargo', 'bin')
      : join(process.env.HOME || '~', '.cargo', 'bin');

  // Ensure cargo bin directory exists
  mkdirSync(cargoBinDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const proc = spawn('cargo', ['install', 'tauri-driver'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      // Log progress
      if (output.includes('Compiling') || output.includes('Downloading')) {
        log.debug(output.trim());
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      stderr += output;
      log.debug(output.trim());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const driverPath =
          process.platform === 'win32' ? join(cargoBinDir, 'tauri-driver.exe') : join(cargoBinDir, 'tauri-driver');

        if (existsSync(driverPath)) {
          // Ensure executable on Unix
          if (process.platform !== 'win32') {
            chmodSync(driverPath, 0o755);
          }
          log.info(`Successfully installed tauri-driver at: ${driverPath}`);
          resolve(driverPath);
        } else {
          reject(new Error('tauri-driver installation completed but binary not found'));
        }
      } else {
        reject(new Error(`cargo install failed with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (error) => {
      reject(new Error(`Failed to spawn cargo install: ${error.message}`));
    });
  });
}

/**
 * Ensure tauri-driver is available, installing if necessary
 * Supports both official (cargo) and CrabNebula (npm) drivers
 */
export async function ensureTauriDriver(options: TauriServiceOptions): Promise<DriverInstallResult> {
  const provider = options.driverProvider ?? 'external';

  if (provider === 'crabnebula') {
    if (options.crabnebulaDriverPath) {
      if (existsSync(options.crabnebulaDriverPath)) {
        return Ok({ path: options.crabnebulaDriverPath, method: 'found' as const });
      }
      return Err(new Error(`CrabNebula driver not found at: ${options.crabnebulaDriverPath}`));
    }

    const detectedPath = findCrabNebulaDriver();
    if (detectedPath) {
      return Ok({ path: detectedPath, method: 'found' as const });
    }

    return Err(new Error('@crabnebula/tauri-driver not found. Install with: npm install -D @crabnebula/tauri-driver'));
  }

  if (options.tauriDriverPath) {
    if (existsSync(options.tauriDriverPath)) {
      return Ok({ path: options.tauriDriverPath, method: 'found' as const });
    }
    return Err(new Error(`tauri-driver not found at provided path: ${options.tauriDriverPath}`));
  }

  const existingPath = findTauriDriver();
  if (existingPath) {
    log.debug(`Found tauri-driver at: ${existingPath}`);
    return Ok({ path: existingPath, method: 'found' as const });
  }

  if (options.autoInstallTauriDriver) {
    if (!isCargoAvailable()) {
      return Err(new Error('Rust toolchain (cargo) not found. Please install Rust from https://rustup.rs/'));
    }

    try {
      const installedPath = await installTauriDriver();
      return Ok({ path: installedPath, method: 'installed' as const });
    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return Err(
    new Error(
      `tauri-driver not found. Install it with: cargo install tauri-driver\n` +
        `Or enable auto-installation by setting autoInstallTauriDriver: true in service options.`,
    ),
  );
}

/**
 * Detect the package manager on Linux systems
 * Returns the package manager name or 'unknown' if not detected
 * @public Exported for testing
 */
export async function detectPackageManager(): Promise<string> {
  const packageManagers = [
    { command: 'apt-get', name: 'apt' },
    { command: 'dnf', name: 'dnf' },
    { command: 'yum', name: 'yum' },
    { command: 'zypper', name: 'zypper' },
    { command: 'pacman', name: 'pacman' },
    { command: 'apk', name: 'apk' },
    { command: 'xbps-install', name: 'xbps' },
  ];

  for (const { command, name } of packageManagers) {
    try {
      await execAsync(`which ${command}`);
      return name;
    } catch {
      // Continue to next package manager
    }
  }

  return 'unknown';
}

/**
 * Get install command for webkit2gtk-driver based on package manager
 * @public Exported for testing
 */
export function getWebKitDriverInstallCommand(packageManager: string): string {
  const installCommands: Record<string, string> = {
    apt: 'sudo apt-get install -y webkit2gtk-driver',
    dnf: 'sudo dnf install -y webkit2gtk-driver',
    yum: 'sudo yum install -y webkit2gtk-driver',
    zypper: 'sudo zypper install -y webkit2gtk-driver',
    pacman: 'sudo pacman -S webkit2gtk-driver',
    apk: 'sudo apk add webkit2gtk-driver',
    xbps: 'sudo xbps-install -y webkit2gtk-driver',
  };

  return installCommands[packageManager] || installCommands.apt; // Default to apt-get
}

export interface WebKitWebDriverSuccess {
  path?: string;
}

export interface WebKitWebDriverError extends Error {
  installInstructions?: string;
}

/**
 * Get WebKitWebDriver path with helpful error messages
 */
export async function ensureWebKitWebDriver(): Promise<Result<WebKitWebDriverSuccess, WebKitWebDriverError>> {
  if (process.platform !== 'linux') {
    return Ok({}); // Not needed on non-Linux
  }

  try {
    const result = execSync('which WebKitWebDriver', { encoding: 'utf8' });
    const path = result.trim();
    if (path && existsSync(path)) {
      return Ok({ path });
    }
  } catch {
    // Not in PATH
  }

  const commonPaths = [
    '/usr/bin/WebKitWebDriver',
    '/usr/local/bin/WebKitWebDriver',
    '/usr/lib/webkit2gtk-4.0/WebKitWebDriver',
    '/usr/lib/webkit2gtk-4.1/WebKitWebDriver',
  ];

  for (const path of commonPaths) {
    if (existsSync(path)) {
      return Ok({ path });
    }
  }

  log.debug('WebKitWebDriver not found, detecting package manager...');
  const packageManager = await detectPackageManager();
  log.debug(`Detected package manager: ${packageManager}`);

  const installCommand = getWebKitDriverInstallCommand(packageManager);

  const error = new Error('WebKitWebDriver not found') as WebKitWebDriverError;
  error.installInstructions = installCommand;
  return Err(error);
}

/**
 * Convert Git Bash-style paths to Windows paths
 * Example: /c/Users/foo -> C:\Users\foo
 */
function convertGitBashPathToWindows(gitBashPath: string): string {
  // Match pattern like /c/Users/...
  const match = gitBashPath.match(/^\/([a-z])\/(.+)$/i);
  if (match) {
    const [, driveLetter, restOfPath] = match;
    return `${driveLetter.toUpperCase()}:\\${restOfPath.replace(/\//g, '\\')}`;
  }
  return gitBashPath;
}
