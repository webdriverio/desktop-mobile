// browser.electrobun.triggerDeeplink implementation.
//
// Fires the OS-native protocol handler so the Electrobun app's registered
// `open-url` handler receives the URL — the same path production sees, and the
// most realistic test of a registered URI scheme (no IPC mocking).
//
// macOS-only in v1: Electrobun registers `app.urlSchemes` via the generated
// Info.plist `CFBundleURLTypes`, and `open <url>` reaches the running app's
// open-url handler. Windows/Linux deeplink support isn't available upstream yet
// (RESEARCH_FINDINGS §6), so this rejects there with a documented-gap error.

import { executeDeeplinkCommand, getPlatformCommand, validateDeeplinkUrl } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from '../constants.js';
import { deeplinkUnsupportedOnPlatform } from '../errors.js';

const log = createLogger(SERVICE_NAME, 'triggerDeeplink');

/**
 * Trigger a deeplink to the Electrobun app by spawning the OS-native protocol
 * handler (macOS `open <url>`).
 *
 * @param url - The deeplink URL (e.g. `wdio-electrobun://open?path=/test`). Must
 *   use a custom scheme — `http`, `https`, and `file` are rejected.
 * @throws when the URL is malformed/disallowed, or on a non-macOS platform.
 *
 * @example
 * ```ts
 * await browser.electrobun.triggerDeeplink('wdio-electrobun://open?file=test.txt');
 * ```
 */
export async function triggerDeeplink(url: string): Promise<void> {
  if (process.platform !== 'darwin') {
    throw deeplinkUnsupportedOnPlatform();
  }
  const validated = validateDeeplinkUrl(url);
  log.debug(`triggering deeplink ${validated}`);

  const { command, args } = getPlatformCommand(validated, process.platform);
  await executeDeeplinkCommand(command, args);
  log.debug(`deeplink dispatched: ${command} ${args.join(' ')}`);
}
