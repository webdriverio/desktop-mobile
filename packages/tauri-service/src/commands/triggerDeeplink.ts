import { executeDeeplinkCommand, getPlatformCommand, validateDeeplinkUrl } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';

// Re-export the framework-agnostic helpers so existing Tauri-side callers
// keep working without touching their imports. Local callers below use them
// directly via the import above.
export { executeDeeplinkCommand, getPlatformCommand, validateDeeplinkUrl };

const log = createLogger('tauri-service', 'triggerDeeplink');

interface TauriServiceContext {
  browser?: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser;
}

/**
 * Store CrabNebula mode info for access by triggerDeeplink.
 * Uses environment variables since launcher and worker run in separate processes.
 */
export function setCrabnebulaModeInfo(isCrabnebula: boolean): void {
  if (isCrabnebula) {
    process.env.__WDIO_TAURI_CRABNEBULA__ = 'true';
    log.debug('Set CrabNebula mode env: isCrabnebula=true');
  }
}

/**
 * Get CrabNebula mode info from environment variables.
 */
function isCrabnebulaProvider(): boolean {
  return process.env.__WDIO_TAURI_CRABNEBULA__ === 'true';
}

/**
 * Store embedded mode info for access by triggerDeeplink.
 * Uses environment variables since launcher and worker run in separate processes.
 */
export function setEmbeddedModeInfo(isEmbedded: boolean, appBinaryPath?: string): void {
  if (isEmbedded) {
    process.env.__WDIO_TAURI_EMBEDDED__ = 'true';
    if (appBinaryPath) {
      process.env.__WDIO_TAURI_APP_BINARY__ = appBinaryPath;
    }
    log.debug(`Set embedded mode env: isEmbedded=true, appBinaryPath=${appBinaryPath}`);
  }
}

/**
 * Get embedded mode info from environment variables.
 */
function getEmbeddedModeInfo(): { isEmbedded: boolean; appBinaryPath?: string } | undefined {
  const isEmbedded = process.env.__WDIO_TAURI_EMBEDDED__ === 'true';
  const appBinaryPath = process.env.__WDIO_TAURI_APP_BINARY__;
  if (!isEmbedded) return undefined;
  return { isEmbedded, appBinaryPath };
}

/**
 * Check if we're running with the embedded WebDriver provider.
 * Uses globally stored info from the launcher.
 */
function isEmbeddedProvider(): boolean {
  const info = getEmbeddedModeInfo();
  return info?.isEmbedded ?? false;
}

/**
 * Validates that the provided URL is a valid deeplink URL.
 * Rejects http/https/file protocols and ensures the URL is properly formatted.
 *
 * @param url - The URL to validate
 * @returns The validated URL
 * @throws Error if the URL is invalid or uses a disallowed protocol
 *
 * @example
 * ```ts
 * validateDeeplinkUrl('myapp://test'); // Returns 'myapp://test'
 * validateDeeplinkUrl('https://example.com'); // Throws error
 * ```
 */
/**
 * Triggers a deeplink to the Tauri application for testing protocol handlers.
 *
 * For embedded WebDriver and CrabNebula:
 * - Uses browser.execute() to directly inject the deeplink into the app's JavaScript context
 * - This bypasses platform-specific single-instance IPC mechanisms (D-Bus on Linux,
 *   NSDistributedNotificationCenter on macOS) which don't work reliably with
 *   unbundled binaries or when the app is managed by test-runner-backend.
 *
 * For tauri-driver:
 * - Uses platform-specific commands to open the deeplink URL
 * - Windows: Uses `rundll32.exe url.dll,FileProtocolHandler`
 * - macOS: Uses `open` command
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

  // For embedded or CrabNebula mode, use browser.execute to directly inject the deeplink.
  // This bypasses platform-specific single-instance IPC mechanisms (D-Bus on Linux,
  // NSDistributedNotificationCenter on macOS) which don't work reliably with
  // unbundled binaries or when the app is managed by test-runner-backend.
  let providerName: string | null = null;
  if (isEmbeddedProvider()) {
    providerName = 'embedded';
  } else if (isCrabnebulaProvider()) {
    providerName = 'crabnebula';
  }

  if (providerName) {
    log.debug(`${providerName} mode: injecting deeplink via browser.execute`);

    if (!this.browser) {
      throw new Error(`${providerName} deeplink injection requires browser context`);
    }

    try {
      // Build URL using char codes to avoid WebKit parsing the URL string literally.
      // Use plain statements (not an arrow function) so the script works correctly when
      // the embedded WebDriver wraps it as a function body: (function() { SCRIPT })().
      const charCodes = Array.from(validatedUrl)
        .map((c) => c.charCodeAt(0))
        .join(',');
      const script = `
        try {
          var charCodes = [${charCodes}];
          var url = String.fromCharCode.apply(null, charCodes);
          if (typeof window.receivedDeeplinks === 'undefined') {
            window.receivedDeeplinks = [];
          }
          window.receivedDeeplinks.push(url);
          if (typeof window.deeplinkCount === 'undefined') {
            window.deeplinkCount = 0;
          }
          window.deeplinkCount++;
        } catch (e) {
          console.error('[WDIO Deeplink] Error:', e.message);
        }
      `;
      await this.browser.execute(script);

      log.debug(`Deeplink injected successfully: ${validatedUrl}`);
      return;
    } catch (error) {
      log.error(`Failed to inject deeplink via browser.execute: ${error}`);
      throw new Error(`Failed to inject deeplink: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Standard approach for tauri-driver: use platform-specific commands
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
