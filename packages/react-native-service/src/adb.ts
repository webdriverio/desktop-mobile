import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from './constants.js';

const log = createLogger(SERVICE_NAME, 'launcher');
const execFileAsync = promisify(execFile);

/**
 * Map the device's Metro port to the host (`adb reverse tcp:<port> tcp:<port>`) so the
 * Android app can load its JS bundle from host Metro over the emulator loopback. Best-effort
 * (Metro may already be reachable); pass `udid` to target a specific device when several
 * emulators are attached (parallel / multiremote).
 */
export async function adbReverse(port: number, udid?: string): Promise<void> {
  const args = udid ? ['-s', udid, 'reverse', `tcp:${port}`, `tcp:${port}`] : ['reverse', `tcp:${port}`, `tcp:${port}`];
  try {
    await execFileAsync('adb', args);
    log.debug(`adb ${args.join(' ')} ✓`);
  } catch (error) {
    log.warn(
      `adb reverse tcp:${port} failed (continuing — Metro may already be reachable): ${(error as Error).message}`,
    );
  }
}
