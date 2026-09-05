import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectFixedRuntimeVersion, resolveTargetEdgeVersion } from '../../src/edgeDriverManager.js';

/**
 * Real-Windows proof for the fixed-version WebView2 runtime path (#539). Rather than download a
 * fixed-version runtime (no stable versioned URL exists; only the latest two majors are published),
 * this points the resolver at the runner's already-installed Evergreen runtime — a real folder
 * holding a real `msedgewebview2.exe` — and asserts we read its true FileVersion off disk. That is
 * the genuinely novel/risky part of the fix; the msedgedriver download + session boot are already
 * covered by the Tauri Windows E2E. Skips honestly if no runtime is present.
 */

const VERSION_DIR = /^\d+\.\d+\.\d+\.\d+$/;
const RUNTIME_EXE = 'msedgewebview2.exe';
const VERSION_PATTERN = /^\d+\.\d+\.\d+/;

/** Locate an installed Evergreen WebView2 runtime: `<base>\Microsoft\EdgeWebView\Application\<ver>\`. */
function findInstalledRuntime(): { versionDir: string; applicationDir: string; version: string } | undefined {
  const bases = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(
    (base): base is string => Boolean(base),
  );

  for (const base of bases) {
    const applicationDir = join(base, 'Microsoft', 'EdgeWebView', 'Application');
    if (!existsSync(applicationDir)) {
      continue;
    }
    // Match the resolver: when several runtime versions coexist, the newest wins.
    const [version] = readdirSync(applicationDir)
      .filter((entry) => VERSION_DIR.test(entry) && existsSync(join(applicationDir, entry, RUNTIME_EXE)))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (version) {
      return { versionDir: join(applicationDir, version), applicationDir, version };
    }
  }
  return undefined;
}

// Resolve once at load; the suite runs only on Windows with a real runtime present, and reports an
// honest skip otherwise rather than a passing no-op.
const runtime = process.platform === 'win32' ? findInstalledRuntime() : undefined;

describe.skipIf(!runtime)('edgeDriverManager fixed-version runtime (Windows)', () => {
  // Guaranteed present by the skipIf gate above; narrow once for the type-checker.
  const rt = runtime as NonNullable<typeof runtime>;

  it('should read the runtime version from a folder holding msedgewebview2.exe', async () => {
    const version = await detectFixedRuntimeVersion(rt.versionDir);
    expect(version).toMatch(VERSION_PATTERN);
    // The install dir is named by the runtime version, so the file version shares its major.
    expect(version?.split('.')[0]).toBe(rt.version.split('.')[0]);
  });

  it('should find the runtime via the versioned-subdirectory fallback', async () => {
    // Point at the parent Application dir → the `<version>/msedgewebview2.exe` subdir scan. The
    // fallback must resolve the same runtime a direct read of that subdir yields, not merely "some
    // version-shaped string" — otherwise a scan that picked the wrong nested version would pass.
    const direct = await detectFixedRuntimeVersion(rt.versionDir);
    const viaFallback = await detectFixedRuntimeVersion(rt.applicationDir);
    expect(viaFallback).toMatch(VERSION_PATTERN);
    expect(viaFallback).toBe(direct);
  });

  it('should report source "fixed-runtime" for WEBVIEW2_BROWSER_EXECUTABLE_FOLDER', async () => {
    const resolved = await resolveTargetEdgeVersion({
      env: { WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: rt.versionDir },
    });
    expect(resolved?.source).toBe('fixed-runtime');
    expect(resolved?.version).toMatch(VERSION_PATTERN);
  });
});
