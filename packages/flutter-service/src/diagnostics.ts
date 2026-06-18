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
    try {
      const req = createRequire(join(process.cwd(), 'noop.js'));
      const pkg = req.resolve('appium-flutter-driver/package.json');
      const execJs = join(dirname(pkg), 'build', 'lib', 'commands', 'execute.js');
      const src = readFileSync(execJs, 'utf8');
      if (src.includes('getVMServiceUrl')) {
        return { category: 'appium-flutter-driver', status: 'ok', message: 'getVMServiceUrl present' };
      }
      return {
        category: 'appium-flutter-driver',
        status: 'warn',
        message: 'getVMServiceUrl not found in the installed driver',
        details:
          'Android execute/mock need the goosewobbler appium-flutter-driver fork (vm-service-port + ' +
          'getVMServiceUrl) until it is upstreamed. iOS is unaffected (uses appium:dartVmServicePort directly).',
      };
    } catch (error) {
      return {
        category: 'appium-flutter-driver',
        status: 'warn',
        message: `could not inspect appium-flutter-driver (${(error as Error).message})`,
      };
    }
  };
}

/** The Flutter-specific preflight checks, in the order they should run. */
export function flutterDoctorChecks(): DoctorCheck[] {
  return [checkFlutterOnPath(), checkAppiumFlutterDriverFork()];
}
