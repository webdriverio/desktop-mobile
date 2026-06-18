// Preflight "doctor" framework for mobile services (mirrors appium-doctor).
//
// The heavy toolchains a mobile run needs (Android SDK/adb, JDK, Flutter SDK, Xcode) are
// multi-GB and can't be fetched on demand, and the app is the user's own build — so we
// validate in `onPrepare` and fail fast with an actionable message instead of leaving the
// user with a cryptic Appium timeout. This module owns the framework (check type + runner +
// fail-fast policy); each service plugs in its own checks.
//
// Builds on `@wdio/native-utils`' `DiagnosticResult` / `formatDiagnosticResults` (the same
// primitives `@wdio/electron-service` composes) rather than a new result shape.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { type DiagnosticResult, formatDiagnosticResults } from '@wdio/native-utils';
import { SevereServiceError } from './errors.js';

/** A single preflight check. May return one or many results, sync or async. */
export type DoctorCheck = () => DiagnosticResult | DiagnosticResult[] | Promise<DiagnosticResult | DiagnosticResult[]>;

/** Severity assigned to a failing check. `'warn'` logs; `'error'` can abort under `'strict'`. */
export type Severity = 'warn' | 'error';

/** `'off'` skips the doctor entirely, `'warn'` logs only, `'strict'` aborts on any error. */
export type DoctorMode = 'off' | 'warn' | 'strict';

const isWindows = process.platform === 'win32';

/** Check that `cmd` resolves on PATH (`which`/`where`). */
export function checkCommandOnPath(cmd: string, opts: { category?: string; severity?: Severity; hint?: string } = {}): DoctorCheck {
  const category = opts.category ?? cmd;
  const severity = opts.severity ?? 'error';
  return () => {
    try {
      const out = execFileSync(isWindows ? 'where' : 'which', [cmd], { encoding: 'utf8', stdio: 'pipe' }).trim();
      const path = out.split('\n')[0]?.trim();
      if (path) {
        return { category, status: 'ok', message: path };
      }
    } catch {
      // fall through to the failure result
    }
    return {
      category,
      status: severity,
      message: `'${cmd}' not found on PATH`,
      details: opts.hint,
    };
  };
}

/** Check that a filesystem path exists (e.g. the app binary). */
export function checkPathExists(path: string, category: string, severity: Severity = 'error'): DoctorCheck {
  return () =>
    existsSync(path)
      ? { category, status: 'ok', message: path }
      : { category, status: severity, message: `does not exist: ${path}` };
}

/**
 * Check that an app build is debug/profile (not release) using a service-supplied detector.
 * Release builds don't expose the JS/Dart realm (`execute`/`mock`), so this defaults to
 * `'warn'` — the detector is heuristic and false positives shouldn't abort a run.
 */
export function checkBuildIsDebug(
  appPath: string,
  detector: (appPath: string) => 'debug' | 'profile' | 'release' | 'unknown',
  opts: { category?: string; severity?: Severity } = {},
): DoctorCheck {
  const category = opts.category ?? 'App build';
  return () => {
    const kind = detector(appPath);
    if (kind === 'debug' || kind === 'profile') {
      return { category, status: 'ok', message: `${kind} build` };
    }
    if (kind === 'release') {
      return {
        category,
        status: opts.severity ?? 'warn',
        message: 'release build',
        details: 'execute/mock need a debug or profile build that exposes the JS/Dart realm.',
      };
    }
    return { category, status: 'warn', message: 'could not determine build type' };
  };
}

/** Check that the Appium server service is configured in `services` (Tier 2.6). */
export function checkAppiumServiceConfigured(services: unknown): DoctorCheck {
  return () => {
    const names = new Set<string>();
    if (Array.isArray(services)) {
      for (const entry of services) {
        const name = Array.isArray(entry) ? entry[0] : entry;
        if (typeof name === 'string') {
          names.add(name);
        }
      }
    }
    const present = names.has('appium') || names.has('@wdio/appium-service');
    return present
      ? { category: 'Appium server', status: 'ok', message: '@wdio/appium-service configured' }
      : {
          category: 'Appium server',
          status: 'warn',
          message: '@wdio/appium-service not found in services',
          details: "Add 'appium' to your wdio.conf services unless you run a standalone/remote Appium server.",
        };
  };
}

export interface DoctorOptions {
  /** Logger namespace (the consuming service). */
  serviceName: string;
  /** When true, any `error`-status result throws `SevereServiceError`. Default false. */
  failFast?: boolean;
}

/** Translate a {@link DoctorMode} option into the `failFast` flag (`'off'` → run no checks). */
export function failFastForMode(mode: DoctorMode | undefined): boolean {
  return mode === 'strict';
}

/**
 * Run all checks, log via `formatDiagnosticResults`, and — only when `failFast` — throw
 * `SevereServiceError` aggregating every `error`-status result. A thrown/rejected check is
 * itself recorded as an `error` result (so one bad check can't crash the whole preflight).
 */
export async function runDoctor(checks: DoctorCheck[], opts: DoctorOptions): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];
  for (const check of checks) {
    try {
      const r = await check();
      results.push(...(Array.isArray(r) ? r : [r]));
    } catch (error) {
      results.push({ category: 'Doctor', status: 'error', message: `check threw: ${(error as Error).message}` });
    }
  }

  formatDiagnosticResults(results, opts.serviceName);

  if (opts.failFast) {
    const errors = results.filter((r) => r.status === 'error');
    if (errors.length > 0) {
      throw new SevereServiceError(
        `${opts.serviceName} preflight failed:\n` +
          errors.map((e) => `  - ${e.category}: ${e.message}${e.details ? ` (${e.details})` : ''}`).join('\n'),
      );
    }
  }

  return results;
}
