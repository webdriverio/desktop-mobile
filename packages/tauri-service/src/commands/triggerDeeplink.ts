import { executeDeeplinkCommand, getPlatformCommand, validateDeeplinkUrl } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';

import type { DriverProvider } from '../types.js';

// Re-export the framework-agnostic helpers so existing Tauri-side callers
// keep working without touching their imports. Local callers below use them
// directly via the import above.
export { executeDeeplinkCommand, getPlatformCommand, validateDeeplinkUrl };

const log = createLogger('tauri-service', 'triggerDeeplink');

interface TauriInternals {
  invoke: (cmd: string, args: unknown) => Promise<unknown>;
}

interface TauriServiceContext {
  browser?: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser;
  provider: DriverProvider;
}

/**
 * Triggers a deeplink to the Tauri application for testing protocol handlers.
 *
 * For the embedded provider, and CrabNebula on macOS:
 * - Has tauri-plugin-wdio emit tauri-plugin-deep-link's `deep-link://new-url` event on the app's
 *   main thread, so the app's `onOpenUrl` / `on_open_url` handlers receive the URL. It doesn't wait
 *   for those handlers, and the deep-link plugin's `getCurrent()` doesn't change.
 * - This bypasses platform-specific single-instance IPC mechanisms (D-Bus on Linux,
 *   NSDistributedNotificationCenter on macOS) which don't work reliably with
 *   unbundled binaries or when the app is managed by test-runner-backend.
 *
 * For the external provider, and CrabNebula on Windows and Linux:
 * - Uses platform-specific commands to open the deeplink URL
 * - Windows: Uses `rundll32.exe url.dll,FileProtocolHandler`
 * - Linux: Uses `gio open` command
 *
 * @param this - Service context
 * @param url - The deeplink URL to trigger (e.g., 'myapp://open?path=/test')
 * @returns A promise that resolves when the deeplink has been triggered
 * @throws Error if the URL is invalid or uses http/https/file protocols
 *
 * @example
 * ```ts
 * await browser.tauri.triggerDeeplink('myapp://open?file=test.txt');
 * ```
 */
export async function triggerDeeplink(this: TauriServiceContext, url: string): Promise<void> {
  log.info(`Triggering deeplink: ${url}`);

  const validatedUrl = validateDeeplinkUrl(url);
  const platform = process.platform;
  const { provider } = this;

  if (provider === 'embedded' || (provider === 'crabnebula' && platform === 'darwin')) {
    log.debug(`${provider} mode: emitting the deep-link event in the app`);

    if (!this.browser) {
      throw new Error(`${provider} deeplink injection requires browser context`);
    }

    // Normalized like the deep-link plugin's own payload; Rust's url crate follows the same URL standard.
    const href = new URL(validatedUrl).href;

    try {
      // `__TAURI_INTERNALS__` exists in every Tauri 2 webview; `__TAURI__` needs `withGlobalTauri`.
      await (this.browser as WebdriverIO.Browser).execute((url: string) => {
        const internals = (globalThis as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
        if (!internals) {
          throw new Error('Tauri IPC (__TAURI_INTERNALS__) is not available in this window');
        }
        return internals.invoke('plugin:wdio|emit_deep_link', { url });
      }, href);

      log.debug(`Deeplink injected successfully: ${href}`);
      return;
    } catch (error) {
      log.error(`Failed to inject deeplink via browser.execute: ${error}`);
      throw new Error(`Failed to inject deeplink: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const { command, args } = getPlatformCommand(validatedUrl, platform);
  const fullCommand = `${command} ${args.join(' ')}`;
  log.debug(`Full deeplink command: "${fullCommand}"`);

  try {
    await executeDeeplinkCommand(command, args);
    log.debug(`Deeplink triggered successfully: ${validatedUrl}`);
  } catch (error) {
    log.error(`Failed to trigger deeplink: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
