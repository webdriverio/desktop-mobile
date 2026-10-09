// browser.dioxus.triggerDeeplink implementation.
//
// The deeplink is triggered by spawning the OS-native protocol handler — the
// same path the user's app would see in production. That's the most realistic
// test of registered URI handlers and bypasses any IPC mocking.
//
//   - Windows: `rundll32.exe url.dll,FileProtocolHandler <url>`
//   - macOS:   `open <url>`
//   - Linux:   `gio open <url>`

import { executeDeeplinkCommand, getPlatformCommand, validateDeeplinkUrl } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';

const log = createLogger('dioxus-service', 'triggerDeeplink');

/**
 * Trigger a deeplink to the Dioxus application by spawning the OS-native
 * protocol handler.
 *
 * @param url - The deeplink URL (e.g. `myapp://open?path=/test`).
 *   Must use a custom protocol — `http`, `https`, and `file` are rejected.
 * @throws Error when the URL is malformed or uses a disallowed protocol.
 *
 * @example
 * ```ts
 * await browser.dioxus.triggerDeeplink('myapp://open?file=test.txt');
 * ```
 */
export async function triggerDeeplink(url: string): Promise<void> {
  const validated = validateDeeplinkUrl(url);
  log.debug(`triggering deeplink ${validated} on ${process.platform}`);

  const { command, args } = getPlatformCommand(validated, process.platform);
  await executeDeeplinkCommand(command, args);
  log.debug(`deeplink dispatched: ${command} ${args.join(' ')}`);
}
