import { spawn } from 'node:child_process';
import type { ElectronServiceGlobalOptions } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

const log = createLogger('electron-service', 'service');

/**
 * Context interface for the triggerDeeplink command.
 * Provides access to service configuration and state.
 */
interface ServiceContext {
  browser?: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser;
  globalOptions: ElectronServiceGlobalOptions;
  userDataDir?: string;
  instancesShareApp?: boolean;
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
export function validateDeeplinkUrl(url: string): string {
  // Parse the URL to validate its format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (_error) {
    throw new Error(`Invalid deeplink URL: ${url}`);
  }

  // Reject http/https/file protocols
  const disallowedProtocols = ['http:', 'https:', 'file:'];
  if (disallowedProtocols.includes(parsedUrl.protocol)) {
    const protocol = parsedUrl.protocol.slice(0, -1); // Remove trailing colon
    throw new Error(`Invalid deeplink protocol: ${protocol}. Expected a custom protocol (e.g., myapp://).`);
  }

  return url;
}

/**
 * Appends the user data directory as a query parameter to the deeplink URL.
 * This is required on Windows to ensure the deeplink reaches the test instance.
 *
 * @param url - The deeplink URL
 * @param userDataDir - The user data directory path
 * @returns The modified URL with userData parameter
 *
 * @example
 * ```ts
 * appendUserDataDir('myapp://test', '/tmp/user-data');
 * // Returns 'myapp://test?userData=/tmp/user-data'
 *
 * appendUserDataDir('myapp://test?foo=bar', '/tmp/user-data');
 * // Returns 'myapp://test?foo=bar&userData=/tmp/user-data'
 * ```
 */
export function appendUserDataDir(url: string, userDataDir: string): string {
  const parsedUrl = new URL(url);

  // Check if userData parameter already exists
  if (parsedUrl.searchParams.has('userData')) {
    log.warn(`URL already contains a userData parameter. It will be overwritten with: ${userDataDir}`);
  }

  // Append or overwrite the userData parameter
  parsedUrl.searchParams.set('userData', userDataDir);

  return parsedUrl.toString();
}

/**
 * Generates the platform-specific command to trigger the deeplink.
 *
 * @param url - The deeplink URL to trigger
 * @param platform - The platform (win32, darwin, linux)
 * @param appBinaryPath - The path to the app binary (required for Windows)
 * @returns Command and arguments for child_process.spawn
 * @throws Error if platform is unsupported or required parameters are missing
 *
 * @example
 * ```ts
 * // Windows
 * getPlatformCommand('myapp://test', 'win32', 'C:\\app.exe');
 * // Returns { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', 'myapp://test'] }
 *
 * // macOS
 * getPlatformCommand('myapp://test', 'darwin');
 * // Returns { command: 'open', args: ['myapp://test'] }
 *
 * // Linux
 * getPlatformCommand('myapp://test', 'linux');
 * // Returns { command: 'gio', args: ['open', 'myapp://test'] }
 * ```
 */
export function getPlatformCommand(
  url: string,
  platform: string,
  appBinaryPath?: string,
): { command: string; args: string[] } {
  switch (platform) {
    case 'win32':
      if (!appBinaryPath) {
        throw new Error(
          'triggerDeeplink requires appBinaryPath to be configured on Windows. ' +
            'Please set appBinaryPath in your wdio:electronServiceOptions.',
        );
      }
      // Windows: Use rundll32 to trigger the deeplink via ShellExecuteEx
      // This avoids cmd.exe shell interpretation of URL metacharacters (e.g. &)
      return {
        command: 'rundll32.exe',
        args: ['url.dll,FileProtocolHandler', url],
      };

    case 'darwin': {
      // macOS: Use open command
      // Decode the query string to prevent double-encoding by the 'open' command
      // The 'open' command will re-encode it when passing to the protocol handler
      let decodedUrl = url;
      const queryIndex = url.indexOf('?');
      if (queryIndex !== -1) {
        const base = url.substring(0, queryIndex);
        const queryAndFragment = url.substring(queryIndex + 1);
        try {
          const decodedQuery = decodeURIComponent(queryAndFragment);
          decodedUrl = `${base}?${decodedQuery}`;
        } catch (_error) {
          // If decoding fails, use original URL
          decodedUrl = url;
        }
      }
      return {
        command: 'open',
        args: [decodedUrl],
      };
    }

    case 'linux':
      // Linux: Use gio open command
      return {
        command: 'gio',
        args: ['open', url],
      };

    default:
      throw new Error(
        `Unsupported platform for deeplink triggering: ${platform}. ` +
          'Supported platforms are: win32, darwin, linux.',
      );
  }
}

/**
 * Executes the deeplink command using child_process.spawn.
 * The process is detached and runs asynchronously in the background.
 *
 * @param command - The command to execute
 * @param args - The command arguments
 * @returns A promise that resolves when the command has been spawned successfully
 * @throws Error if the command fails to spawn
 *
 * @example
 * ```ts
 * await executeDeeplinkCommand('open', ['myapp://test']);
 * ```
 */
export async function executeDeeplinkCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // Spawn the command with detached process
      const childProcess = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
      });

      // Unref the child process to allow parent to exit
      childProcess.unref();

      // Handle spawn errors
      childProcess.on('error', (error) => {
        reject(new Error(`Failed to trigger deeplink: ${error.message}`));
      });

      // Resolve immediately after spawning - the process will continue in background
      process.nextTick(() => {
        log.debug('Deeplink command spawned successfully');
        resolve();
      });
    } catch (error) {
      reject(new Error(`Failed to trigger deeplink: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}

/**
 * Triggers a deeplink to the Electron application for testing protocol handlers.
 *
 * On Windows, this automatically appends the test instance's user-data-dir to ensure
 * the deeplink reaches the correct instance. On macOS and Linux, it works transparently.
 *
 * @param this - Service context with access to browser and options
 * @param url - The deeplink URL to trigger (e.g., 'myapp://open?path=/test')
 * @returns A promise that resolves when the deeplink has been triggered
 * @throws Error if appBinaryPath is not configured (Windows only)
 * @throws Error if the URL is invalid or uses http/https/file protocols
 * @throws Error on macOS when two multiremote instances run the same app
 *
 * @example
 * ```ts
 * await browser.electron.triggerDeeplink('myapp://open?file=test.txt');
 * ```
 */
export async function triggerDeeplink(this: ServiceContext, url: string): Promise<void> {
  log.debug(`triggerDeeplink called with URL: ${url}`);

  // Validate the URL format and reject disallowed protocols
  const validatedUrl = validateDeeplinkUrl(url);

  // Extract service configuration
  const { appBinaryPath, appEntryPoint } = this.globalOptions;
  let userDataDir = this.userDataDir;
  const platform = process.platform;

  if (platform === 'darwin' && this.instancesShareApp) {
    throw new Error(
      "triggerDeeplink() can't reach a multiremote instance on macOS when two instances run the same app. " +
        "It opens the URL with `open`, which can't tell the copies apart, so one of them gets it, whichever instance called. " +
        'In script mode (`appEntryPoint`), every instance runs Electron itself, so they always count as the same app. ' +
        'Test deeplinks on macOS without multiremote.',
    );
  }

  // Auto-detect user data directory if not already configured
  // Critical for Windows/Linux: ensures second instance matches the test instance via single-instance lock
  if (!userDataDir && this.browser) {
    try {
      log.debug('Fetching user data directory from running app...');
      userDataDir = await this.browser.electron.execute((electron: typeof import('electron')) => {
        return electron.app.getPath('userData');
      });
      this.userDataDir = userDataDir; // Cache for future calls
      log.debug(`Detected user data directory: ${userDataDir}`);
    } catch (error) {
      log.warn(
        `Failed to fetch user data directory from app: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Windows-specific configuration warnings
  let finalUrl = validatedUrl;

  if (platform === 'win32') {
    if (appEntryPoint && !appBinaryPath) {
      log.warn(
        'Using appEntryPoint with protocol handlers on Windows may not work correctly for deeplink testing. ' +
          'Consider using appBinaryPath for protocol handler tests on Windows.',
      );
    }
  }

  // For Windows and Linux: append userData to URL so second instance can match the test instance
  // The app reads this parameter and sets its userData before requesting the single-instance lock
  if (platform === 'win32' || platform === 'linux') {
    if (!userDataDir) {
      log.warn(
        'No user data directory detected. The deeplink may launch a new instance instead of reaching the test instance. ' +
          'Consider explicitly setting --user-data-dir in appArgs.',
      );
    } else {
      finalUrl = appendUserDataDir(validatedUrl, userDataDir);
      log.debug(`Appended user data directory to URL: ${finalUrl}`);
    }
  }

  // Generate the OS-specific command to trigger the deeplink
  const { command, args } = getPlatformCommand(finalUrl, platform, appBinaryPath);
  log.debug(`Executing deeplink command: ${command} ${args.join(' ')}`);

  // Execute the command (fire-and-forget, runs in background)
  try {
    await executeDeeplinkCommand(command, args);
    log.debug('Deeplink triggered successfully');
  } catch (error) {
    log.error(`Failed to trigger deeplink: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
