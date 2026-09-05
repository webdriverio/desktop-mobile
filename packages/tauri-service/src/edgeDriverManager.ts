import { exec, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createLogger, Err, Ok, type Result } from '@wdio/native-utils';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const log = createLogger('tauri-service', 'launcher');

export interface EdgeDriverSuccess {
  driverPath?: string;
  driverVersion?: string;
  edgeVersion?: string;
  method?: 'found' | 'downloaded' | 'skipped';
}

export type EdgeDriverResult = Result<EdgeDriverSuccess, Error>;

/**
 * Detect WebView2 runtime version from Windows registry
 * WebView2 runtime is separate from the Edge browser and is what Tauri apps actually use
 */
export async function detectWebView2Version(): Promise<string | undefined> {
  if (process.platform !== 'win32') {
    return undefined;
  }

  try {
    const registryPaths = [
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    ];

    for (const regPath of registryPaths) {
      try {
        const { stdout } = await execAsync(`reg query "${regPath}" /v pv 2>nul`, {
          encoding: 'utf8',
        });

        const match = stdout.match(/pv\s+REG_SZ\s+([\d.]+)/);
        if (match) {
          log.debug(`Found WebView2 runtime version ${match[1]} at ${regPath}`);
          return match[1];
        }
      } catch {
        // Try next path
      }
    }

    log.debug('Could not detect WebView2 runtime version from registry');
    return undefined;
  } catch (error) {
    log.debug('Error detecting WebView2 version:', error);
    return undefined;
  }
}

/** Read a Windows file's FileVersion (e.g. `150.0.4022.98`). Windows-only. */
async function readFileVersion(filePath: string): Promise<string | undefined> {
  try {
    // Embed the path in the -Command string: a trailing argv token does not populate $args under
    // -Command, so `(Get-Item $args[0])` reads an empty path and fails.
    const psPath = filePath.replace(/'/g, "''");
    // Default 15s, overridable via WDIO_EDGE_PROBE_TIMEOUT_MS: a timeout kill (empty stdout) silently
    // drops the fixed-runtime probe to the Evergreen fallback, and powershell can be starved for tens
    // of seconds on a heavily parallel CI runner where a version read is otherwise ~1s.
    const timeoutMs = Number(process.env.WDIO_EDGE_PROBE_TIMEOUT_MS) || 15000;
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${psPath}').VersionInfo.FileVersion`],
      { encoding: 'utf8', timeout: timeoutMs },
    );
    // Return only the numeric prefix — FileVersion can carry trailing text (e.g. "150.0.0 (rc)").
    const match = stdout.trim().match(/^\d+\.\d+\.\d+(?:\.\d+)?/);
    if (match) {
      return match[0];
    }
  } catch (error) {
    log.debug(`Could not read file version from ${filePath}: ${error}`);
  }
  return undefined;
}

const FIXED_RUNTIME_EXE = 'msedgewebview2.exe';
const VERSION_DIR = /^\d+\.\d+\.\d+\.\d+$/;
/** A complete, injection-safe version string. */
const VERSION_RE = /^\d+(?:\.\d+){1,3}$/;

/** Order dotted numeric versions highest-first. */
export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Resolve the WebView2 runtime version an app is pinned to via a fixed-version runtime folder
 * (`WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`). The folder holds `msedgewebview2.exe`, whose FileVersion
 * is the runtime version; some layouts nest it under a versioned subdir, so fall back to scanning.
 * Windows-only; returns undefined off Windows or when the runtime binary can't be found/read.
 */
export async function detectFixedRuntimeVersion(folder?: string): Promise<string | undefined> {
  if (process.platform !== 'win32' || !folder) {
    return undefined;
  }

  const direct = join(folder, FIXED_RUNTIME_EXE);
  if (existsSync(direct)) {
    return readFileVersion(direct);
  }

  try {
    // Several `<version>/msedgewebview2.exe` subdirs can coexist; pick the highest so a stale
    // runtime can't win on readdir order.
    const [newest] = readdirSync(folder)
      .filter((entry) => VERSION_DIR.test(entry) && existsSync(join(folder, entry, FIXED_RUNTIME_EXE)))
      .sort(compareVersionsDesc);
    if (newest) {
      return readFileVersion(join(folder, newest, FIXED_RUNTIME_EXE));
    }
  } catch {
    // Folder unreadable — fall through to undefined.
  }

  return undefined;
}

export type EdgeVersionSource = 'override' | 'fixed-runtime' | 'evergreen';

export interface ResolveEdgeVersionOptions {
  /** Explicit msedgedriver version pin. */
  edgeDriverVersion?: string;
  /** The app's runtime env; the resolver reads `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` from it. */
  env?: Record<string, string>;
}

export interface ResolvedEdgeVersion {
  /** The Edge/WebView2 runtime version, or — when `source` is `'override'` — the exact driver version. */
  version: string;
  source: EdgeVersionSource;
}

const WEBVIEW2_FOLDER_ENV = 'WEBVIEW2_BROWSER_EXECUTABLE_FOLDER';
const EDGEDRIVER_VERSION_ENV = 'EDGEDRIVER_VERSION';

/**
 * Decide which Edge/WebView2 version msedgedriver should match, in precedence order:
 *   1. an explicit driver pin (`edgeDriverVersion` option / `EDGEDRIVER_VERSION`) — used verbatim;
 *   2. a fixed-version runtime folder (`WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`) — the app renders with
 *      that runtime, not the machine's Evergreen, so its version is what the driver must match;
 *   3. the Evergreen runtime from the registry (the default).
 * The folder env is read with the app's own precedence — `options.env` over `process.env`
 * (`{ ...process.env, ...options.env }`) — so the resolver sees the folder the app actually uses.
 */
export async function resolveTargetEdgeVersion(
  options: ResolveEdgeVersionOptions = {},
): Promise<ResolvedEdgeVersion | undefined> {
  const override = options.edgeDriverVersion ?? process.env[EDGEDRIVER_VERSION_ENV];
  if (override) {
    if (VERSION_RE.test(override)) {
      return { version: override, source: 'override' };
    }
    log.warn(
      `Ignoring edgeDriverVersion/${EDGEDRIVER_VERSION_ENV} "${override}" — expected a numeric version like 149.0.4022.98.`,
    );
  }

  const fixedFolder = options.env?.[WEBVIEW2_FOLDER_ENV] ?? process.env[WEBVIEW2_FOLDER_ENV];
  if (fixedFolder) {
    const version = await detectFixedRuntimeVersion(fixedFolder);
    if (version) {
      return { version, source: 'fixed-runtime' };
    }
    log.warn(
      `${WEBVIEW2_FOLDER_ENV} is set (${fixedFolder}) but no readable ${FIXED_RUNTIME_EXE} was found ` +
        'in it — falling back to the Evergreen runtime version.',
    );
  }

  const evergreen = await detectWebView2Version();
  if (evergreen) {
    return { version: evergreen, source: 'evergreen' };
  }

  return undefined;
}

/**
 * Detect Microsoft Edge version from Windows registry
 */
export async function detectEdgeVersion(): Promise<string | undefined> {
  if (process.platform !== 'win32') {
    return undefined;
  }

  try {
    // Try multiple registry paths for Edge
    const registryPaths = [
      // Stable Edge
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}',
      'HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}',
      // Current user
      'HKCU\\SOFTWARE\\Microsoft\\Edge\\BLBeacon',
    ];

    for (const regPath of registryPaths) {
      try {
        const { stdout } = await execAsync(`reg query "${regPath}" /v pv 2>nul`, {
          encoding: 'utf8',
        });

        const match = stdout.match(/pv\s+REG_SZ\s+([\d.]+)/);
        if (match) {
          log.debug(`Found Edge version ${match[1]} at ${regPath}`);
          return match[1];
        }
      } catch {
        // Try next path
      }
    }

    // Fallback: Try to get version from msedge.exe
    try {
      const { stdout } = await execAsync(
        `wmic datafile where name="C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe" get Version /value`,
        { encoding: 'utf8' },
      );
      const match = stdout.match(/Version=([\d.]+)/);
      if (match) {
        log.debug(`Found Edge version ${match[1]} from msedge.exe`);
        return match[1];
      }
    } catch {
      // Ignore
    }

    log.warn('Could not detect Edge version from registry or executable');
    return undefined;
  } catch (error) {
    log.error('Error detecting Edge version:', error);
    return undefined;
  }
}

/**
 * Extract major version from version string (e.g., "143.0.3650.139" -> "143")
 */
export function getMajorVersion(version: string): string {
  return version.split('.')[0];
}

/**
 * Check if msedgedriver.exe exists in PATH and get its version
 */
export async function findMsEdgeDriver(): Promise<{ path?: string; version?: string }> {
  if (process.platform !== 'win32') {
    return {};
  }

  try {
    // Try to find in PATH
    const { stdout: pathResult } = await execAsync('where msedgedriver.exe 2>nul', {
      encoding: 'utf8',
    });
    const driverPath = pathResult.trim().split('\n')[0];

    if (driverPath && existsSync(driverPath)) {
      // Get version
      try {
        const { stdout: versionOutput } = await execAsync(`"${driverPath}" --version`, {
          encoding: 'utf8',
          timeout: 5000,
        });
        const match = versionOutput.match(/MSEdgeDriver ([\d.]+)/);
        if (match) {
          log.debug(`Found msedgedriver ${match[1]} at ${driverPath}`);
          return { path: driverPath, version: match[1] };
        }
      } catch {
        // Could not get version
      }

      return { path: driverPath };
    }
  } catch {
    // Not found in PATH
  }

  return {};
}

/**
 * Get the correct driver version for a given Edge version from Microsoft's API
 */
async function getDriverVersionForEdge(edgeVersion: string): Promise<string> {
  const majorVersion = getMajorVersion(edgeVersion);
  const safeMajorVersion = majorVersion.replace(/\D/g, '');

  try {
    // Try to get the latest stable release for this major version
    const psCommand = `
      $ProgressPreference = 'SilentlyContinue'
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      try {
        $response = Invoke-WebRequest -Uri 'https://msedgedriver.microsoft.com/LATEST_RELEASE_${safeMajorVersion}' -UseBasicParsing -TimeoutSec 10
        $response.Content.Trim()
      } catch {
        Write-Output ''
      }
    `;

    const response = await execFileAsync('powershell.exe', ['-Command', psCommand], {
      encoding: 'utf8',
      timeout: 15000,
    });

    const latestForMajor = response.stdout.trim();
    if (latestForMajor?.startsWith(safeMajorVersion)) {
      log.debug(`Found latest driver version ${latestForMajor} for Edge ${safeMajorVersion}`);
      return latestForMajor;
    }
  } catch (_error) {
    log.debug('Could not fetch latest driver version from Microsoft API');
  }

  // Fallback: try the exact version
  return edgeVersion;
}

/**
 * Download msedgedriver for a specific Edge version.
 * When `exactVersion` is set, `edgeVersion` is treated as the exact driver version and the
 * Microsoft `LATEST_RELEASE_<major>` lookup is skipped.
 */
export async function downloadMsEdgeDriver(
  edgeVersion: string,
  exactVersion = false,
): Promise<{ path: string; version: string }> {
  const majorVersion = getMajorVersion(edgeVersion);
  // Use random temp directory name to prevent symlink attacks
  const randomSuffix = randomBytes(8).toString('hex');
  const downloadDir = join(tmpdir(), 'msedgedriver', `${majorVersion}-${randomSuffix}`);
  const driverPath = join(downloadDir, 'msedgedriver.exe');

  log.info(`Downloading msedgedriver for Edge ${edgeVersion}...`);
  // Create directory with restrictive permissions (owner-only access)
  mkdirSync(downloadDir, { recursive: true, mode: 0o700 });

  // Get the correct driver version from Microsoft (unless an exact version was pinned).
  const driverVersion = exactVersion ? edgeVersion : await getDriverVersionForEdge(edgeVersion);

  // Create PowerShell script for downloading. Double any embedded single quotes so a version can't
  // break out of the string literal (belt-and-suspenders over VERSION_RE).
  const psScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # Faster downloads
$driverVersion = '${driverVersion.replace(/'/g, "''")}'
$edgeVersion = '${edgeVersion.replace(/'/g, "''")}'
$downloadDir = '${downloadDir.replace(/\\/g, '\\\\')}'
$driverPath = '${driverPath.replace(/\\/g, '\\\\')}'

try {
    # Force TLS 1.2 for older PowerShell versions
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    # Determine architecture
    $arch = if ([Environment]::Is64BitOperatingSystem) { 'win64' } else { 'win32' }

    # Microsoft's CDN uses FULL version string
    # URL structure: https://msedgedriver.microsoft.com/{FULL_VERSION}/edgedriver_{ARCH}.zip
    $url = "https://msedgedriver.microsoft.com/$driverVersion/edgedriver_$arch.zip"

    Write-Host "Downloading Edge WebDriver $driverVersion (for Edge $edgeVersion) from: $url"
    $zipPath = Join-Path $downloadDir "edgedriver.zip"

    # Download using Invoke-WebRequest
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -TimeoutSec 60

    Write-Host "Download successful, extracting..."

    # Extract
    Expand-Archive -Path $zipPath -DestinationPath $downloadDir -Force
    Remove-Item $zipPath -ErrorAction SilentlyContinue

    # Verify extracted
    if (Test-Path $driverPath) {
        Write-Host "SUCCESS: msedgedriver $driverVersion downloaded to $driverPath"
    } else {
        throw "Downloaded and extracted but msedgedriver.exe not found at expected path: $driverPath"
    }

} catch {
    Write-Error "Error downloading msedgedriver: $_"
    exit 1
}
`;

  const psScriptPath = join(downloadDir, 'download-driver.ps1');
  writeFileSync(psScriptPath, psScript, 'utf8');

  try {
    // Execute PowerShell script
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-ExecutionPolicy', 'Bypass', '-File', psScriptPath],
      {
        encoding: 'utf8',
        timeout: 60000, // 1 minute timeout
      },
    );

    log.debug('PowerShell output:', stdout);
    if (stderr) {
      log.debug('PowerShell stderr:', stderr);
    }

    if (existsSync(driverPath)) {
      log.info(`Successfully downloaded msedgedriver ${driverVersion} (for Edge ${edgeVersion}) to ${driverPath}`);
      return { path: driverPath, version: driverVersion };
    }

    throw new Error('Download completed but driver not found');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`Failed to download msedgedriver for Edge ${edgeVersion}:`, errorMsg);
    throw new Error(`Failed to download msedgedriver for Edge ${edgeVersion}: ${errorMsg}`);
  } finally {
    // Clean up the PowerShell script file
    try {
      if (existsSync(psScriptPath)) {
        unlinkSync(psScriptPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Ensure msedgedriver is available and matches Edge version
 * This is the main entry point for Edge driver management
 */
export async function ensureMsEdgeDriver(
  _tauriBinaryPath?: string,
  autoDownload = true,
  options: ResolveEdgeVersionOptions = {},
): Promise<EdgeDriverResult> {
  if (process.platform !== 'win32') {
    return Ok({ method: 'skipped' as const });
  }

  log.info('Checking Edge WebDriver compatibility...');

  const resolved = await resolveTargetEdgeVersion(options);
  if (!resolved) {
    log.warn('Could not determine the WebView2 runtime version - skipping driver check');
    return Ok({ method: 'skipped' as const });
  }

  const { version: edgeVersion, source } = resolved;
  log.info(`Target Edge/WebView2 version ${edgeVersion} (source: ${source})`);
  const edgeMajor = getMajorVersion(edgeVersion);

  const existing = await findMsEdgeDriver();
  if (existing.path && existing.version) {
    // An explicit pin (`source: 'override'`) must match the driver exactly; the runtime-derived
    // paths only need the shared major, since Edge and its driver drift in the lower version parts.
    const compatible =
      source === 'override' ? existing.version === edgeVersion : getMajorVersion(existing.version) === edgeMajor;

    if (compatible) {
      log.info(`✅ msedgedriver ${existing.version} matches Edge ${edgeVersion}`);
      return Ok({
        driverPath: existing.path,
        driverVersion: existing.version,
        edgeVersion,
        method: 'found' as const,
      });
    }

    log.warn(`❌ Version mismatch: msedgedriver ${existing.version} != Edge ${edgeVersion}`);
  }

  if (autoDownload) {
    try {
      log.info(`Attempting to download msedgedriver ${edgeVersion}...`);
      const downloaded = await downloadMsEdgeDriver(edgeVersion, source === 'override');

      process.env.PATH = `${join(downloaded.path, '..')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`;

      log.info(`✅ Downloaded and configured msedgedriver ${downloaded.version}`);
      return Ok({
        driverPath: downloaded.path,
        driverVersion: downloaded.version,
        edgeVersion,
        method: 'downloaded' as const,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('Failed to download msedgedriver:', errorMsg);

      return Err(
        new Error(
          `Failed to download msedgedriver: ${errorMsg}. Please manually install from https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/`,
        ),
      );
    }
  }

  return Err(
    new Error(
      `msedgedriver version mismatch. Edge: ${edgeVersion}, Driver: ${existing.version || 'unknown'}. Set autoDownloadEdgeDriver: true to auto-fix.`,
    ),
  );
}
