// React Native preflight checks, composed from @wdio/native-mobile-core's doctor framework
// and run from the launcher's onPrepare (after Metro is started when manageMetro is on).

import type { DoctorCheck } from '@wdio/native-mobile-core';
import type { DiagnosticResult } from '@wdio/native-utils';

import { probeMetroStatus } from './metroProcess.js';

/**
 * Verify Metro is reachable on the configured host/port. When the service doesn't manage Metro
 * (the default), a down server is the most common cause of a cryptic "no Hermes target"
 * failure — surface it here as an actionable warning instead. Probes `metroHost` (not a hardcoded
 * localhost) so a remote-Metro setup doesn't get a spurious "not reachable" warning.
 */
export function checkMetroReachable(host: string, port: number): DoctorCheck {
  return async (): Promise<DiagnosticResult> => {
    const reachable = await probeMetroStatus(port, host);
    const where = `${host}:${port}`;
    return reachable
      ? { category: 'Metro', status: 'ok', message: `reachable on ${where}` }
      : {
          category: 'Metro',
          status: 'warn',
          message: `not reachable on ${where}`,
          details: 'Start Metro (`react-native start`) or set manageMetro: true to have the service own it.',
        };
  };
}

/** The React Native-specific preflight checks. */
export function reactNativeDoctorChecks(metroHost: string, metroPort: number): DoctorCheck[] {
  return [checkMetroReachable(metroHost, metroPort)];
}
