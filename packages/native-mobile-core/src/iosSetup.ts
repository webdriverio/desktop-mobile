// iOS shared launch path — used by both RN-iOS and Flutter-iOS (both drive the XCUITest
// native shell). Smooths the exact cold-toolchain failure modes that otherwise surface as a
// cryptic Appium timeout: ambiguous simulator UDID, a cold Xcode SDK probe, and a
// per-session WebDriverAgent build.
//
// All macOS-only; every helper is a no-op / empty result off darwin so it's safe to call
// unconditionally from the shared launcher.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createLogger, type DiagnosticResult, Err, Ok, type Result } from '@wdio/native-utils';

const log = createLogger('native-mobile-core', 'launcher');

const isMac = process.platform === 'darwin';

interface SimctlDevice {
  udid: string;
  name: string;
  state?: string;
  isAvailable?: boolean;
}

/** Numeric sort key for a simctl runtime identifier, e.g. `…SimRuntime.iOS-17-4` → 17.4. */
function runtimeVersion(runtimeId: string): number {
  const m = runtimeId.match(/iOS-(\d+)(?:-(\d+))?/i);
  if (!m) {
    return 0;
  }
  return Number.parseInt(m[1], 10) + Number.parseInt(m[2] ?? '0', 10) / 1000;
}

/**
 * Pick the exact UDID for `deviceName` from `xcrun simctl list devices --json` output,
 * preferring the newest runtime (and a matching `platformVersion` when given). Avoids the
 * duplicate-device-name ambiguity where Appium boots a different instance than expected.
 * Exported for testing.
 */
export function pickIosUdid(simctlJson: string, deviceName: string, platformVersion?: string): string | undefined {
  let parsed: { devices?: Record<string, SimctlDevice[]> };
  try {
    parsed = JSON.parse(simctlJson);
  } catch {
    return undefined;
  }
  const byRuntime = parsed.devices ?? {};
  const runtimes = Object.keys(byRuntime).sort((a, b) => runtimeVersion(b) - runtimeVersion(a));
  for (const runtime of runtimes) {
    if (platformVersion && !runtime.includes(`iOS-${platformVersion.replace(/\./g, '-')}`)) {
      continue;
    }
    const match = byRuntime[runtime].find(
      (d) => d.name === deviceName && d.isAvailable !== false,
    );
    if (match) {
      return match.udid;
    }
  }
  return undefined;
}

/** Resolve the exact simulator UDID for a device name (macOS only). */
export function resolveIosUdid(deviceName: string, platformVersion?: string): string | undefined {
  if (!isMac) {
    return undefined;
  }
  try {
    const json = execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000,
    });
    return pickIosUdid(json, deviceName, platformVersion);
  } catch (error) {
    log.debug(`resolveIosUdid failed: ${(error as Error).message}`);
    return undefined;
  }
}

/**
 * Pre-resolve the Xcode SDK and simulator list before the session, surfacing a broken/cold
 * toolchain as a clear diagnostic instead of appium-xcuitest's internal SDK-probe timeout.
 */
export function warmUpXcodeToolchain(): DiagnosticResult[] {
  if (!isMac) {
    return [];
  }
  const results: DiagnosticResult[] = [];
  try {
    const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000,
    }).trim();
    results.push({ category: 'iOS SDK', status: 'ok', message: `iphonesimulator ${sdk}` });
  } catch (error) {
    results.push({
      category: 'iOS SDK',
      status: 'error',
      message: 'xcrun SDK probe failed',
      details: `Install Xcode + command-line tools (xcode-select --install). ${(error as Error).message}`,
    });
  }
  try {
    execFileSync('xcrun', ['simctl', 'list', 'devices'], { stdio: 'ignore', timeout: 30000 });
    results.push({ category: 'iOS Simulators', status: 'ok', message: 'simctl reachable' });
  } catch (error) {
    results.push({
      category: 'iOS Simulators',
      status: 'warn',
      message: 'simctl list failed',
      details: (error as Error).message,
    });
  }
  return results;
}

/** Locate WebDriverAgent.xcodeproj shipped inside appium-xcuitest-driver. */
export function resolveWdaProject(): string | undefined {
  try {
    // Resolve from the project root (where the driver is installed), not this package's tree.
    const req = createRequire(join(process.cwd(), 'noop.js'));
    const pkg = req.resolve('appium-xcuitest-driver/package.json');
    const proj = join(dirname(pkg), 'node_modules', 'appium-webdriveragent', 'WebDriverAgent.xcodeproj');
    return existsSync(proj) ? proj : undefined;
  } catch {
    return undefined;
  }
}

export interface PrebuildWdaOptions {
  /** DerivedData directory to cache the build into (reused via usePrebuiltWDA). */
  derivedDataPath: string;
  isHeadless?: boolean;
}

/**
 * Pre-build WebDriverAgent (`xcodebuild build-for-testing`) outside the session so the first
 * session just launches a cached WDA — no multi-minute per-session compile, no socket timeout.
 * Best-effort, macOS-only, opt-in: returns `Err` (never throws) so a failure degrades to the
 * normal per-session build.
 */
export async function prebuildWda(opts: PrebuildWdaOptions): Promise<Result<{ derivedDataPath: string }, Error>> {
  if (!isMac) {
    return Err(new Error('WDA pre-build is macOS-only'));
  }
  const project = resolveWdaProject();
  if (!project) {
    return Err(new Error('Could not locate appium-webdriveragent (is appium-xcuitest-driver installed?)'));
  }
  log.info('Pre-building WebDriverAgent (one-time; cached in derivedDataPath)...');
  try {
    execFileSync(
      'xcodebuild',
      [
        'build-for-testing',
        '-project',
        project,
        '-scheme',
        'WebDriverAgentRunner',
        '-destination',
        'generic/platform=iOS Simulator',
        '-derivedDataPath',
        opts.derivedDataPath,
        'CODE_SIGNING_ALLOWED=NO',
      ],
      { stdio: 'pipe', timeout: 900000 },
    );
    return Ok({ derivedDataPath: opts.derivedDataPath });
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)));
  }
}
