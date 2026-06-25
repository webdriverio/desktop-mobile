// Flutter-service preflight checks, composed from @wdio/native-mobile-core's doctor builders
// and run from the launcher's onPrepare. Validates the toolchain + the minimum
// `appium-flutter-driver` that makes Android execute/mock work.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { checkCommandOnPath, type DoctorCheck } from '@wdio/native-mobile-core';
import type { DiagnosticResult } from '@wdio/native-utils';

// First published appium-flutter-driver carrying the Android `appium:dartVmServicePort` cap +
// `flutter:getVMServiceUrl` command (upstream appium/appium-flutter-driver#880). Below this the
// engine ignores the port pin, so Android execute/mock can't reach the Dart VM. Keep in lockstep
// with the `flutter` row in @wdio/native-mobile-core's APPIUM_MATRIX (and e2e/package.json).
const MIN_FLUTTER_DRIVER_VERSION = '3.8.0';

/** `flutter` on PATH — needed for app builds and SDK-adjacent tooling. */
export function checkFlutterOnPath(): DoctorCheck {
  return checkCommandOnPath('flutter', {
    severity: 'warn',
    hint: 'Install the Flutter SDK and ensure `flutter` is on PATH.',
  });
}

/** True when `version` (major.minor.patch) is ≥ `floor`. Prerelease suffixes are ignored. */
function meetsMinimum(version: string, floor: string): boolean {
  const parts = (v: string) => v.split('.', 3).map((p) => Number.parseInt(p, 10) || 0);
  const [vMaj, vMin, vPatch] = parts(version);
  const [fMaj, fMin, fPatch] = parts(floor);
  if (vMaj !== fMaj) return vMaj > fMaj;
  if (vMin !== fMin) return vMin > fMin;
  return vPatch >= fPatch;
}

/**
 * Verify the installed `appium-flutter-driver` is recent enough for Android execute/mock — it
 * needs the `appium:dartVmServicePort` cap + `flutter:getVMServiceUrl` command that landed in
 * {@link MIN_FLUTTER_DRIVER_VERSION}. An older driver surfaces as a clear warning rather than a
 * silent execute/mock failure. iOS is unaffected (its port pin works from ≥ 3.7.1).
 */
export function checkAppiumFlutterDriverVersion(): DoctorCheck {
  return (): DiagnosticResult => {
    const hint =
      `Android execute/mock need appium-flutter-driver ≥ ${MIN_FLUTTER_DRIVER_VERSION} ` +
      '(adds appium:dartVmServicePort + flutter:getVMServiceUrl). Reinstall the flutter Appium driver to upgrade.';
    try {
      const req = createRequire(join(process.cwd(), 'noop.js'));
      const pkgPath = req.resolve('appium-flutter-driver/package.json');
      const version = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
      if (meetsMinimum(version, MIN_FLUTTER_DRIVER_VERSION)) {
        return { category: 'appium-flutter-driver', status: 'ok', message: `v${version}` };
      }
      return {
        category: 'appium-flutter-driver',
        status: 'warn',
        message: `v${version} is below ${MIN_FLUTTER_DRIVER_VERSION}`,
        details: hint,
      };
    } catch (error) {
      return {
        category: 'appium-flutter-driver',
        status: 'warn',
        message: `could not inspect appium-flutter-driver (${(error as Error).message})`,
        details: hint,
      };
    }
  };
}

/**
 * The Flutter-specific preflight checks. The driver-version check is Android-only — the
 * `dartVmServicePort` cap + `getVMServiceUrl` are an Android concern, so it's omitted for an
 * iOS-only run (iOS pins the port via processArguments from ≥ 3.7.1).
 */
export function flutterDoctorChecks(platforms: Set<'android' | 'ios'>): DoctorCheck[] {
  const checks: DoctorCheck[] = [checkFlutterOnPath()];
  if (platforms.has('android')) {
    checks.push(checkAppiumFlutterDriverVersion());
  }
  return checks;
}
