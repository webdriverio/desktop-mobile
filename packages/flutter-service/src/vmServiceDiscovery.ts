// Discover the Dart VM Service WebSocket URL for the running app.
//
// On a debug/profile build the framework prints "The Dart VM service is listening on
// http://127.0.0.1:<port>/<token>/" to the device log; we scrape it (over Appium
// getLogs) since the URL carries an auth token a bare port can't provide. On Android the
// device-local port is forwarded to the host via `adb forward`. The seams (getLogs,
// adbForward, sleep) are injectable so the discovery loop is unit-testable.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createLogger } from '@wdio/native-utils';

import {
  SERVICE_NAME,
  VM_SERVICE_CONNECT_INTERVAL_MS,
  VM_SERVICE_CONNECT_RETRIES,
  VM_SERVICE_LOG_PATTERN,
} from './constants.js';

const log = createLogger(SERVICE_NAME, 'bridge');
const execFileAsync = promisify(execFile);

/** Forwards the device VM-service port to the host (Android). Injectable for tests. */
export type AdbForward = (port: number) => Promise<void>;

const defaultAdbForward: AdbForward = async (port) => {
  await execFileAsync('adb', ['forward', `tcp:${port}`, `tcp:${port}`]);
};

export interface VmServiceDiscoveryOptions {
  platform?: 'android' | 'ios';
  retries?: number;
  intervalMs?: number;
  adbForward?: AdbForward;
  /** Injected for tests; defaults to a real timer sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/** Convert a Dart VM Service HTTP URL (`http://host:port/token/`) to its WS endpoint. */
export function toWebSocketUrl(httpUrl: string): string {
  return `${httpUrl.replace(/^http/, 'ws').replace(/\/?$/, '')}/ws`;
}

/** Extract the port from a `…:port/…` URL. */
export function portFromUrl(url: string): number | undefined {
  const match = url.match(/:(\d+)(?:\/|$)/);
  return match ? Number(match[1]) : undefined;
}

async function scrapeVmServiceUrl(
  browser: WebdriverIO.Browser,
  logType: 'logcat' | 'syslog',
): Promise<string | undefined> {
  let entries: Array<{ message?: string }>;
  try {
    entries = (await browser.getLogs(logType)) as Array<{ message?: string }>;
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const match = entry.message?.match(VM_SERVICE_LOG_PATTERN);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Poll the device log until the Dart VM Service URL appears, forward its port on
 * Android, and return the WebSocket URL. Throws after the retry budget is exhausted.
 */
export async function discoverVmServiceUrl(
  browser: WebdriverIO.Browser,
  options: VmServiceDiscoveryOptions = {},
): Promise<string> {
  const platform = options.platform ?? 'android';
  const logType: 'logcat' | 'syslog' = platform === 'ios' ? 'syslog' : 'logcat';
  const retries = options.retries ?? VM_SERVICE_CONNECT_RETRIES;
  const intervalMs = options.intervalMs ?? VM_SERVICE_CONNECT_INTERVAL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const adbForward = options.adbForward ?? defaultAdbForward;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const httpUrl = await scrapeVmServiceUrl(browser, logType);
    if (httpUrl) {
      const port = portFromUrl(httpUrl);
      if (platform === 'android' && port) {
        try {
          await adbForward(port);
        } catch (error) {
          log.warn(
            `adb forward tcp:${port} failed (continuing — port may already be reachable): ${(error as Error).message}`,
          );
        }
      }
      log.debug(`Discovered Dart VM Service at ${httpUrl}`);
      return toWebSocketUrl(httpUrl);
    }
    if (attempt < retries - 1) {
      await sleep(intervalMs);
    }
  }
  throw new Error(`Dart VM Service URL not found in ${logType} after ${retries} attempts`);
}
