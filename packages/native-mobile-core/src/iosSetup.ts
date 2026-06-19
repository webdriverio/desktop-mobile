// iOS shared launch path — used by both RN-iOS and Flutter-iOS (both drive the XCUITest
// native shell). Smooths the exact cold-toolchain failure modes that otherwise surface as a
// cryptic Appium timeout: ambiguous simulator UDID, a cold Xcode SDK probe, and a
// per-session WebDriverAgent build.
//
// All macOS-only; every helper is a no-op / empty result off darwin so it's safe to call
// unconditionally from the shared launcher.

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createLogger, type DiagnosticResult, Err, Ok, type Result } from '@wdio/native-utils';

const log = createLogger('native-mobile-core', 'launcher');

const isMac = () => process.platform === 'darwin';

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
  // A JS config can set platformVersion as a number (e.g. 17.4), so coerce before string ops.
  const pv = platformVersion === undefined ? undefined : String(platformVersion);
  const byRuntime = parsed.devices ?? {};
  const runtimes = Object.keys(byRuntime).sort((a, b) => runtimeVersion(b) - runtimeVersion(a));
  for (const runtime of runtimes) {
    if (pv && !runtime.includes(`iOS-${pv.replace(/\./g, '-')}`)) {
      continue;
    }
    const match = byRuntime[runtime].find((d) => d.name === deviceName && d.isAvailable !== false);
    if (match) {
      return match.udid;
    }
  }
  return undefined;
}

/**
 * Promise wrapper around `execFile('xcrun', …)` — async (not `execFileSync`) so a cold or
 * stalled toolchain probe can't block the event loop for up to the 30s timeout while the
 * launcher is preparing other capabilities. Mirrors `prebuildWda`'s spawn-based style.
 */
function runXcrun(args: string[], timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('xcrun', args, { encoding: 'utf8', timeout: timeoutMs }, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

/** Resolve the exact simulator UDID for a device name (macOS only). */
export async function resolveIosUdid(deviceName: string, platformVersion?: string): Promise<string | undefined> {
  if (!isMac()) {
    return undefined;
  }
  try {
    const json = await runXcrun(['simctl', 'list', 'devices', 'available', '--json']);
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
export async function warmUpXcodeToolchain(): Promise<DiagnosticResult[]> {
  if (!isMac()) {
    return [];
  }
  const results: DiagnosticResult[] = [];
  try {
    const sdk = (await runXcrun(['--sdk', 'iphonesimulator', '--show-sdk-version'])).trim();
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
    await runXcrun(['simctl', 'list', 'devices']);
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

/** Locate WebDriverAgent.xcodeproj shipped with appium-xcuitest-driver. */
export function resolveWdaProject(): string | undefined {
  // Resolve from the project root (where the driver is installed), not this package's tree.
  const req = createRequire(join(process.cwd(), 'noop.js'));
  // Hoisted (npm / Yarn / pnpm-with-hoisting): appium-webdriveragent is lifted to a
  // node_modules root, so resolve it directly first.
  try {
    const wdaPkg = req.resolve('appium-webdriveragent/package.json');
    const proj = join(dirname(wdaPkg), 'WebDriverAgent.xcodeproj');
    if (existsSync(proj)) {
      return proj;
    }
  } catch {
    // fall through to the nested layout
  }
  // Nested (pnpm isolated): under the xcuitest driver's own node_modules.
  try {
    const pkg = req.resolve('appium-xcuitest-driver/package.json');
    const proj = join(dirname(pkg), 'node_modules', 'appium-webdriveragent', 'WebDriverAgent.xcodeproj');
    if (existsSync(proj)) {
      return proj;
    }
  } catch {
    // not found
  }
  return undefined;
}

export interface PrebuildWdaOptions {
  /** DerivedData directory to cache the build into (reused via usePrebuiltWDA). */
  derivedDataPath: string;
  isHeadless?: boolean;
  /** Hard ceiling on the xcodebuild — killed past this so onPrepare can't hang. Default 15 min. */
  timeoutMs?: number;
}

/**
 * Pre-build WebDriverAgent (`xcodebuild build-for-testing`) outside the session so the first
 * session just launches a cached WDA — no multi-minute per-session compile, no socket timeout.
 * Best-effort, macOS-only, opt-in: returns `Err` (never throws) so a failure degrades to the
 * normal per-session build.
 */
export async function prebuildWda(opts: PrebuildWdaOptions): Promise<Result<{ derivedDataPath: string }, Error>> {
  if (!isMac()) {
    return Err(new Error('WDA pre-build is macOS-only'));
  }
  const project = resolveWdaProject();
  if (!project) {
    return Err(new Error('Could not locate appium-webdriveragent (is appium-xcuitest-driver installed?)'));
  }
  log.info('Pre-building WebDriverAgent (one-time; cached in derivedDataPath)...');
  // spawn (not execFileSync) so the long xcodebuild doesn't block the event loop — keeps
  // logging/SIGINT live and lets progress stream.
  return new Promise((resolve) => {
    const proc = spawn(
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
      // timeout kills xcodebuild past the ceiling (a cold toolchain / stale sim lock / a
      // permission dialog can otherwise block onPrepare indefinitely).
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeoutMs ?? 900000 },
    );
    proc.stdout?.on('data', (d: Buffer) => log.debug(d.toString().trim()));
    proc.stderr?.on('data', (d: Buffer) => log.debug(d.toString().trim()));
    proc.on('close', (code) => {
      resolve(
        code === 0
          ? Ok({ derivedDataPath: opts.derivedDataPath })
          : Err(new Error(`xcodebuild exited with code ${code}`)),
      );
    });
    proc.on('error', (error) => resolve(Err(error)));
  });
}
