// Locate and verify a built CEF Electrobun app bundle, and read/write the CEF
// remote-debugging port the launcher pins into the bundle.
//
// Electrobun reads the CDP port EXCLUSIVELY from the bundle's
// `Contents/Resources/build.json` `chromiumFlags["remote-debugging-port"]` at
// runtime (a `--remote-debugging-port` launch arg does NOT reach CEF — see the
// Phase 0 RESEARCH_FINDINGS). So to control the port the launcher writes it into
// build.json. CEF's [9222, 9232] auto-scan is only a fallback when unset.
//
// macOS is the validated platform. Windows/Linux bundle layout is unverified, so
// resolution + the CEF check there are best-effort and guarded by existence
// checks rather than hard-failing on a missing framework — see the per-function
// TODOs. E2E validation on those platforms is a documented follow-up (PR3/CI).

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from './constants.js';
import { cefRendererRequired, SevereServiceError } from './errors.js';

const log = createLogger(SERVICE_NAME, 'config');

const REMOTE_DEBUGGING_FLAG = 'remote-debugging-port';
const USER_DATA_DIR_FLAG = 'user-data-dir';

/** Parsed shape of a bundle's `build.json` (only the keys this service reads). */
export interface BuildJson {
  identifier?: string;
  name?: string;
  /** CEF/Chromium command-line flags Electrobun forwards at launch. Values are strings. */
  chromiumFlags?: Record<string, string>;
  /** Renderer selection, when the bundle records it (`'cef'` enables CDP). */
  renderer?: string;
  defaultRenderer?: string;
  [key: string]: unknown;
}

/** Resolved locations for a built Electrobun app, derived from the binary/bundle path. */
export interface ResolvedElectrobunApp {
  /** The launcher executable to spawn. */
  binaryPath: string;
  /** The `.app` bundle dir on macOS; the binary's parent dir elsewhere. */
  bundlePath: string;
  /** Directory holding `build.json` (`Contents/Resources` on macOS; binary dir elsewhere). */
  resourcesDir: string;
  /** Absolute path to `build.json`. */
  buildJsonPath: string;
  /** App identifier from build.json, when present. */
  identifier?: string;
}

function pathExists(p: string): boolean {
  return existsSync(p);
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve the on-disk layout of a built Electrobun app from an explicit path.
 *
 * Requires an explicit `appBinaryPath`: this service does NOT guess/auto-detect a
 * bundle (the wrong bundle silently attaching to the wrong CDP port is far worse
 * than a clear "set appBinaryPath" error). On macOS the path may point at either
 * the `<App>.app` directory or the inner `Contents/MacOS/<exe>` binary.
 *
 * @throws SevereServiceError when `appBinaryPath` is missing or does not exist.
 */
export function resolveElectrobunApp(
  appBinaryPath: string | undefined,
  platform: NodeJS.Platform = process.platform,
): ResolvedElectrobunApp {
  if (!appBinaryPath) {
    throw new SevereServiceError(
      '@wdio/electrobun-service requires an explicit appBinaryPath in native mode. ' +
        'Set it in wdio:electrobunServiceOptions (or the service-level options) — point it at the ' +
        'built app (on macOS, the `<App>.app` bundle or its inner `Contents/MacOS/<exe>` binary). ' +
        'Auto-detection is intentionally not attempted: attaching to the wrong bundle would silently ' +
        'drive the wrong app over CDP.',
    );
  }

  if (!pathExists(appBinaryPath)) {
    throw new SevereServiceError(
      `Electrobun app path does not exist: ${appBinaryPath}. ` +
        'Build the app first and point appBinaryPath at the resulting bundle/binary.',
    );
  }

  if (platform === 'darwin') {
    return resolveMacosApp(appBinaryPath);
  }

  // Windows/Linux: electrobun emits `<App>/bin/launcher[.exe]` with build.json under
  // `<App>/Resources/` (verified from the CI build artifacts). When the binary sits in
  // a `bin/` dir, the bundle root is its grandparent and Resources/build.json hang off
  // that; otherwise (a flat/custom layout) fall back to a sibling build.json.
  const binaryPath = appBinaryPath;
  const binDir = dirname(binaryPath);
  let bundlePath: string;
  let resourcesDir: string;
  if (basename(binDir) === 'bin') {
    bundlePath = dirname(binDir);
    resourcesDir = join(bundlePath, 'Resources');
  } else {
    bundlePath = binDir;
    resourcesDir = binDir;
  }
  const buildJsonPath = join(resourcesDir, 'build.json');
  const identifier = readBuildJson(buildJsonPath)?.identifier;
  return { binaryPath, bundlePath, resourcesDir, buildJsonPath, identifier };
}

function resolveMacosApp(appPath: string): ResolvedElectrobunApp {
  const bundlePath = resolveMacosBundle(appPath);
  const resourcesDir = join(bundlePath, 'Contents', 'Resources');
  const buildJsonPath = join(resourcesDir, 'build.json');
  const binaryPath = resolveMacosBinary(bundlePath, appPath);
  const identifier = readBuildJson(buildJsonPath)?.identifier;

  return { binaryPath, bundlePath, resourcesDir, buildJsonPath, identifier };
}

function resolveMacosBundle(appPath: string): string {
  // Accept either the `.app` directory or the inner binary.
  if (appPath.endsWith('.app') && isDirectory(appPath)) {
    return appPath;
  }
  if (isDirectory(appPath) && pathExists(join(appPath, 'Contents'))) {
    return appPath;
  }

  // Treat as the inner binary: `<App>.app/Contents/MacOS/<exe>`.
  const macosDir = dirname(appPath);
  const contentsDir = dirname(macosDir);
  const bundleRoot = dirname(contentsDir);
  if (bundleRoot.endsWith('.app')) {
    return bundleRoot;
  }
  // Non-standard layout: fall back to the binary's parent so resolution still
  // yields a build.json location for verifyCefRenderer to evaluate.
  return dirname(appPath);
}

function resolveMacosBinary(bundlePath: string, originalPath: string): string {
  // If the caller already handed us the inner binary, keep it.
  if (!isDirectory(originalPath) && originalPath.includes(join('Contents', 'MacOS'))) {
    return originalPath;
  }
  const macosDir = join(bundlePath, 'Contents', 'MacOS');
  // Candidate exe names, most authoritative first:
  //  - Info.plist CFBundleExecutable (the launch binary the OS would exec);
  //  - `launcher` — Electrobun names its launch exe this, NOT after the bundle;
  //  - `Foo.app` → `Foo` (the generic macOS convention).
  // Spawning the `.app` directory itself is not executable (EACCES), so we must
  // resolve a real file here.
  const candidates = [
    readCFBundleExecutable(join(bundlePath, 'Contents', 'Info.plist')),
    'launcher',
    basename(bundlePath).replace(/\.app$/, ''),
  ];
  for (const name of candidates) {
    if (!name) {
      continue;
    }
    const exe = join(macosDir, name);
    if (pathExists(exe) && !isDirectory(exe)) {
      return exe;
    }
  }
  // Fall back to the original path (may be the binary itself or a non-standard layout).
  return originalPath;
}

/** Read CFBundleExecutable from an XML Info.plist; undefined for a binary plist / on error. */
function readCFBundleExecutable(plistPath: string): string | undefined {
  try {
    const xml = readFileSync(plistPath, 'utf8');
    return xml.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

/**
 * Confirm the app is built with the CEF renderer (the only renderer that exposes
 * a CDP endpoint). On macOS this is true if the CEF `.framework` is bundled under
 * `Contents/Frameworks`, OR build.json records a `cef` renderer. On other
 * platforms it is best-effort (build.json / sibling CEF lib) and deliberately
 * does NOT false-negative when the layout can't be inspected.
 *
 * @throws cefRendererRequired when CEF is positively absent on macOS.
 */
export function verifyCefRenderer(app: ResolvedElectrobunApp, platform: NodeJS.Platform = process.platform): void {
  const buildJson = readBuildJson(app.buildJsonPath);

  if (platform === 'darwin') {
    const frameworkPath = join(app.bundlePath, 'Contents', 'Frameworks', 'Chromium Embedded Framework.framework');
    if (pathExists(frameworkPath)) {
      log.debug(`CEF framework found: ${frameworkPath}`);
      return;
    }
    if (buildJsonIndicatesCef(buildJson)) {
      log.debug('CEF renderer indicated by build.json');
      return;
    }
    throw cefRendererRequired(platform);
  }

  // Windows/Linux: best-effort. Pass if build.json indicates CEF or a sibling CEF
  // library is present; otherwise warn (don't hard-fail) since the layout is
  // unverified. TODO(PR3/CI): confirm the real CEF marker on these platforms.
  if (buildJsonIndicatesCef(buildJson)) {
    return;
  }
  if (siblingCefLibraryExists(app, platform)) {
    return;
  }
  log.warn(
    `Could not positively confirm the CEF renderer on ${platform} (bundle layout unverified). ` +
      'Proceeding — if CDP attach fails, ensure the app was built with the CEF renderer.',
  );
}

function buildJsonIndicatesCef(buildJson: BuildJson | undefined): boolean {
  if (!buildJson) {
    return false;
  }
  const renderer = (buildJson.renderer ?? buildJson.defaultRenderer ?? '').toString().toLowerCase();
  if (renderer.includes('cef')) {
    return true;
  }
  // A pinned remote-debugging port is a strong CEF signal — only CEF reads it.
  return getRemoteDebuggingPort(buildJson) !== undefined;
}

function siblingCefLibraryExists(app: ResolvedElectrobunApp, platform: NodeJS.Platform): boolean {
  const candidates =
    platform === 'win32' ? ['libcef.dll', 'cef.dll'] : ['libcef.so', 'libElectrobunCEF.so', 'libNativeWrapper.so'];
  return candidates.some((name) => pathExists(join(app.resourcesDir, name)) || pathExists(join(app.bundlePath, name)));
}

/**
 * Read and parse a bundle's `build.json`. Returns `undefined` when the file is
 * absent or unparseable (a malformed build.json shouldn't crash resolution; the
 * caller decides whether the missing data is fatal).
 */
export function readBuildJson(buildJsonPath: string): BuildJson | undefined {
  if (!pathExists(buildJsonPath)) {
    return undefined;
  }
  try {
    const raw = readFileSync(buildJsonPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    return parsed as BuildJson;
  } catch (error) {
    log.warn(`Failed to parse build.json at ${buildJsonPath}: ${(error as Error).message}`);
    return undefined;
  }
}

/** Read the pinned CEF remote-debugging port from a parsed build.json, if any. */
export function getRemoteDebuggingPort(buildJson: BuildJson | undefined): number | undefined {
  const raw = buildJson?.chromiumFlags?.[REMOTE_DEBUGGING_FLAG];
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Pin a CEF remote-debugging port (and optional `--user-data-dir`) into a bundle's
 * `build.json` under `chromiumFlags`, preserving every other key. CEF reads these
 * flags from build.json (not argv), so this is how the launcher both fixes the CDP
 * endpoint and isolates each worker's profile. A distinct `user-data-dir` per worker
 * gives CEF a flat, creatable profile root — unlike a redirected `$HOME`, where CEF
 * fails with "Cannot create profile at path .../Library/Application Support/...".
 *
 * @throws SevereServiceError when build.json is missing/unwritable — without it
 *   the port can't be pinned and the worker's CDP attach has no fixed endpoint.
 */
export function writeRemoteDebuggingPort(buildJsonPath: string, port: number, userDataDir?: string): void {
  const existing = readBuildJson(buildJsonPath);
  if (!existing) {
    if (!pathExists(buildJsonPath)) {
      throw new SevereServiceError(
        `Cannot pin the CEF remote-debugging port: build.json not found at ${buildJsonPath}. ` +
          'The Electrobun bundle is missing its Contents/Resources/build.json.',
      );
    }
    // File present but unparseable — refuse to clobber it.
    throw new SevereServiceError(
      `Cannot pin the CEF remote-debugging port: build.json at ${buildJsonPath} is not valid JSON.`,
    );
  }

  const next: BuildJson = {
    ...existing,
    chromiumFlags: {
      ...existing.chromiumFlags,
      [REMOTE_DEBUGGING_FLAG]: String(port),
      ...(userDataDir ? { [USER_DATA_DIR_FLAG]: userDataDir } : {}),
    },
  };

  try {
    writeFileSync(buildJsonPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    log.debug(
      `Pinned remote-debugging-port=${port}${userDataDir ? ` + user-data-dir=${userDataDir}` : ''} into ${buildJsonPath}`,
    );
  } catch (error) {
    throw new SevereServiceError(
      `Failed to write the CEF remote-debugging port into ${buildJsonPath}: ${(error as Error).message}`,
    );
  }
}
