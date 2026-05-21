// Platform-specific deeplink (URL protocol-handler) helpers.
//
// Extracted from packages/tauri-service/src/commands/triggerDeeplink.ts.
// These three helpers are framework-agnostic — every desktop service that
// needs to trigger an OS-level protocol handler (`myapp://...`) goes through
// the same `rundll32.exe` / `open` / `gio open` invocations.
//
// The service-specific orchestration (browser.execute-based injection for
// embedded mode, env-var-driven mode switching, etc.) stays in each
// service's own triggerDeeplink command.

import { spawn } from 'node:child_process';

import { createLogger } from '@wdio/native-utils';

const log = createLogger('native-core', 'triggerDeeplink');

/**
 * Validate a deeplink URL. Throws if the URL is malformed or uses a
 * non-custom protocol (http, https, file).
 *
 * Returns the URL unchanged on success — the return value exists so callers
 * can chain or assign in one step.
 */
export function validateDeeplinkUrl(url: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid deeplink URL: ${url}`);
  }

  const disallowedProtocols = ['http:', 'https:', 'file:'];
  if (disallowedProtocols.includes(parsedUrl.protocol)) {
    const protocol = parsedUrl.protocol.slice(0, -1);
    throw new Error(`Invalid deeplink protocol: ${protocol}. Expected a custom protocol (e.g., myapp://).`);
  }

  return url;
}

/**
 * Generates the platform-specific command to trigger a deeplink.
 *
 * @param url - The deeplink URL to trigger.
 * @param platform - `process.platform` value: `'win32'`, `'darwin'`, or `'linux'`.
 * @returns Command and arguments for `child_process.spawn`.
 * @throws If `platform` is unsupported.
 *
 * @example
 * ```ts
 * getPlatformCommand('myapp://test', 'win32');
 * // { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', 'myapp://test'] }
 *
 * getPlatformCommand('myapp://test', 'darwin');
 * // { command: 'open', args: ['myapp://test'] }
 *
 * getPlatformCommand('myapp://test', 'linux');
 * // { command: 'gio', args: ['open', 'myapp://test'] }
 * ```
 */
export function getPlatformCommand(url: string, platform: string): { command: string; args: string[] } {
  switch (platform) {
    case 'win32':
      return {
        command: 'rundll32.exe',
        args: ['url.dll,FileProtocolHandler', url],
      };

    case 'darwin':
      return {
        command: 'open',
        args: [url],
      };

    case 'linux':
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
 * Spawns the deeplink command as a detached child process. Returns once the
 * process has been spawned (not when it completes — the OS handler may take
 * arbitrary time and is fire-and-forget).
 *
 * @param command - The command to execute (e.g. `'open'`, `'rundll32.exe'`).
 * @param args - Command arguments.
 * @param env - Optional environment overrides. Defaults to `process.env`.
 * @throws If the command fails to spawn (e.g. binary not found on PATH).
 */
export async function executeDeeplinkCommand(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const fullCommand = `${command} ${args.join(' ')}`;
      log.info(`Spawning deeplink command: "${fullCommand}"`);

      const childProcess = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        env: env ?? process.env,
      });

      const pid = childProcess.pid;
      log.info(`Deeplink process spawned with PID: ${pid}`);

      childProcess.unref();

      childProcess.on('error', (error) => {
        log.error(`Failed to spawn deeplink process (PID ${pid}): ${error.message}`);
        reject(new Error(`Failed to trigger deeplink: ${error.message}`));
      });

      process.nextTick(() => {
        log.info(`Deeplink command spawned successfully: PID ${pid}`);
        resolve();
      });
    } catch (error) {
      log.error(`Failed to trigger deeplink: ${error instanceof Error ? error.message : String(error)}`);
      reject(new Error(`Failed to trigger deeplink: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}
