// React Native preflight checks, composed from @wdio/native-mobile-core's doctor framework
// and run from the launcher's onPrepare (after Metro is started when manageMetro is on).

import type { DoctorCheck } from '@wdio/native-mobile-core';
import type { DiagnosticResult } from '@wdio/native-utils';

import { probeMetroStatus } from './metroProcess.js';

/**
 * Verify Metro is reachable on the configured port. When the service doesn't manage Metro
 * (the default), a down server is the most common cause of a cryptic "no Hermes target"
 * failure — surface it here as an actionable warning instead.
 */
export function checkMetroReachable(port: number): DoctorCheck {
  return async (): Promise<DiagnosticResult> => {
    const reachable = await probeMetroStatus(port);
    return reachable
      ? { category: 'Metro', status: 'ok', message: `reachable on port ${port}` }
      : {
          category: 'Metro',
          status: 'warn',
          message: `not reachable on port ${port}`,
          details: 'Start Metro (`react-native start`) or set manageMetro: true to have the service own it.',
        };
  };
}

/** The React Native-specific preflight checks. */
export function reactNativeDoctorChecks(metroPort: number): DoctorCheck[] {
  return [checkMetroReachable(metroPort)];
}
