// Log capture for @wdio/react-native-service.
//
// Two channels:
//   1. Native device logs (Android: 'logcat', iOS: 'syslog') — shared in
//      @wdio/native-mobile-core (re-exported below).
//   2. JS/Metro console logs — forwarded from Runtime.consoleAPICalled CDP events
//      over the Hermes bridge while it's connected. RN/Hermes-specific; stays here.

import type { CdpBridge } from '@wdio/native-cdp-bridge';
import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from './constants.js';

export type { LogEntry } from '@wdio/native-mobile-core';
export { collectDeviceLogs, forwardDeviceLogs } from '@wdio/native-mobile-core';

const log = createLogger(SERVICE_NAME, 'service');

/**
 * Start forwarding CDP `Runtime.consoleAPICalled` events from the Hermes bridge
 * into the WDIO logger. Returns a cleanup function that removes the listener.
 *
 * This captures `console.log/warn/error/info` calls made inside the React Native
 * JS bundle (Metro build) while the test is running.
 *
 * The listener binds to the `CdpBridge` instance passed here. When `MetroBridge.connect()`
 * re-attaches after a drop it swaps in a fresh `CdpBridge`, so a caller that reconnects must run
 * the returned cleanup for the old bridge and re-invoke this against `bridge.bridge` to keep
 * forwarding live (ensureHermes does exactly this).
 */
export function startJsLogForwarding(bridge: CdpBridge): () => void {
  const handler = (params: unknown) => {
    const event = params as {
      type?: string;
      args?: Array<{ type?: string; value?: unknown; description?: string }>;
    };
    const level = event.type ?? 'log';
    const message = (event.args ?? [])
      .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? '')))
      .join(' ');

    switch (level) {
      case 'warning':
        log.warn(`[JS] ${message}`);
        break;
      case 'error':
        log.error(`[JS] ${message}`);
        break;
      case 'info':
        log.info(`[JS] ${message}`);
        break;
      default:
        log.debug(`[JS] ${message}`);
    }
  };

  bridge.on('Runtime.consoleAPICalled', handler);
  return () => {
    bridge.off('Runtime.consoleAPICalled', handler);
  };
}
