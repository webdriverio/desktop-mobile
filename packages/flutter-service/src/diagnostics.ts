// Flutter-service preflight checks, composed from @wdio/native-mobile-core's doctor builders
// and run from the launcher's onPrepare. Validates the toolchain + the one fork-specific
// requirement that makes Android execute/mock work until it's upstreamed.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { checkCommandOnPath, type DoctorCheck } from '@wdio/native-mobile-core';
import type { DiagnosticResult } from '@wdio/native-utils';

/** `flutter` on PATH — needed for app builds and SDK-adjacent tooling. */
export function checkFlutterOnPath(): DoctorCheck {
  return checkCommandOnPath('flutter', {
    severity: 'warn',
    hint: 'Install the Flutter SDK and ensure `flutter` is on PATH.',
  });
}

/**
 * Verify the installed `appium-flutter-driver` carries the `flutter:getVMServiceUrl` command.
 * Android `execute`/`mock` need the goosewobbler fork (vm-service-port intent extra +
 * getVMServiceUrl) until it is upstreamed/published; on the stock driver this surfaces as a
 * clear warning rather than a silent execute/mock failure. (Delivery stays in CI — we
 * validate, we don't mutate node_modules; see ROADMAP / the upstream PR.)
 */
export function checkAppiumFlutterDriverFork(): DoctorCheck {
  return (): DiagnosticResult => {
    const forkHint =
      'Android execute/mock need the goosewobbler appium-flutter-driver fork (vm-service-port + ' +
      'getVMServiceUrl) until it is upstreamed. iOS is unaffected (uses appium:dartVmServicePort directly).';
    try {
      const req = createRequire(join(process.cwd(), 'noop.js'));
      const pkg = req.resolve('appium-flutter-driver/package.json');
      // The driver's compiled command lives at build/lib/commands/execute.js. This layout is
      // stable across the versions we target; the check is temporary and retired once the fork
      // lands upstream, so a future layout change just needs this path (and the catch keeps the
      // fork hint so a drift still points the right way).
      const execJs = join(dirname(pkg), 'build', 'lib', 'commands', 'execute.js');
      const src = readFileSync(execJs, 'utf8');
      if (src.includes('getVMServiceUrl')) {
        return { category: 'appium-flutter-driver', status: 'ok', message: 'getVMServiceUrl present' };
      }
      return {
        category: 'appium-flutter-driver',
        status: 'warn',
        message: 'getVMServiceUrl not found in the installed driver',
        details: forkHint,
      };
    } catch (error) {
      return {
        category: 'appium-flutter-driver',
        status: 'warn',
        message: `could not inspect appium-flutter-driver (${(error as Error).message})`,
        details: forkHint,
      };
    }
  };
}

/**
 * The Flutter-specific preflight checks. The fork check is Android-only — the vm-service-port
 * intent extra + getVMServiceUrl are an Android concern, so it's omitted for an iOS-only run
 * (iOS pins the port via processArguments and isn't affected by the fork).
 */
export function flutterDoctorChecks(platforms: Set<'android' | 'ios'>): DoctorCheck[] {
  const checks: DoctorCheck[] = [checkFlutterOnPath()];
  if (platforms.has('android')) {
    checks.push(checkAppiumFlutterDriverFork());
  }
  return checks;
}
