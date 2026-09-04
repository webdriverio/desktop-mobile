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
 * covered by the Tauri Windows E2E. Skips honestly (not passes) if no runtime is present.
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
    for (const entry of readdirSync(applicationDir)) {
      if (VERSION_DIR.test(entry) && existsSync(join(applicationDir, entry, RUNTIME_EXE))) {
        return { versionDir: join(applicationDir, entry), applicationDir, version: entry };
      }
    }
  }
  return undefined;
}

describe.skipIf(process.platform !== 'win32')('edgeDriverManager fixed-version runtime (Windows)', () => {
  const runtime = findInstalledRuntime();

  it('reads the runtime version from a folder holding msedgewebview2.exe', async (ctx) => {
    if (!runtime) {
      ctx.skip();
      return;
    }
    const version = await detectFixedRuntimeVersion(runtime.versionDir);
    expect(version).toMatch(VERSION_PATTERN);
    // The install dir is named by the runtime version, so the file version shares its major.
    expect(version?.split('.')[0]).toBe(runtime.version.split('.')[0]);
  });

  it('finds the runtime via the versioned-subdirectory fallback', async (ctx) => {
    if (!runtime) {
      ctx.skip();
      return;
    }
    // Point at the parent Application dir → the `<version>/msedgewebview2.exe` subdir scan.
    const version = await detectFixedRuntimeVersion(runtime.applicationDir);
    expect(version).toMatch(VERSION_PATTERN);
  });

  it('resolveTargetEdgeVersion reports source "fixed-runtime" for WEBVIEW2_BROWSER_EXECUTABLE_FOLDER', async (ctx) => {
    if (!runtime) {
      ctx.skip();
      return;
    }
    const resolved = await resolveTargetEdgeVersion({
      env: { WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: runtime.versionDir },
    });
    expect(resolved?.source).toBe('fixed-runtime');
    expect(resolved?.version).toMatch(VERSION_PATTERN);
  });
});
