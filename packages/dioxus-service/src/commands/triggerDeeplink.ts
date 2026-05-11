// browser.dioxus.triggerDeeplink implementation.
//
// Phase 5 MVP: provider 'external' only (Windows + Linux). The deeplink is
// triggered by spawning the OS-native protocol handler — the same path
// the user's app would see in production. That's the most realistic test
// of registered URI handlers and bypasses any IPC mocking.
//
//   - Windows: `rundll32.exe url.dll,FileProtocolHandler <url>`
//   - macOS:   `open <url>` (Dioxus MVP does not yet support 'external'
//              on darwin, but this stays platform-aware so a future Phase
//              re-enables it without code changes here)
//   - Linux:   `gio open <url>`
//
// Provider 'embedded' will need a different path that injects the URL via
// `browser.execute` to bypass single-instance IPC mechanisms; that branch
// lands in Phase 6 alongside the embedded provider itself.

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
