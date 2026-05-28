import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createLogger } from '@wdio/native-utils';

const log = createLogger('tauri-service', 'utils');

/**
 * Get WebKitWebDriver path for Linux
 * This is required by tauri-driver on Linux systems
 */
export function getWebKitWebDriverPath(): string | undefined {
  // Only needed on Linux
  if (process.platform !== 'linux') {
    return undefined;
  }

  // Try to find WebKitWebDriver in PATH
  try {
    const result = execSync('which WebKitWebDriver', { encoding: 'utf8' });
    const path = result.trim();
    if (path && existsSync(path)) {
      log.debug(`Found WebKitWebDriver at: ${path}`);
      return path;
    }
  } catch {
    log.debug('WebKitWebDriver not found in PATH');
  }

  // Fallback to common Linux installation paths
  const commonPaths = [
    '/usr/bin/WebKitWebDriver',
    '/usr/local/bin/WebKitWebDriver',
    '/usr/lib/webkit2gtk-4.0/WebKitWebDriver',
    '/usr/lib/webkit2gtk-4.1/WebKitWebDriver',
  ];

  for (const path of commonPaths) {
    if (existsSync(path)) {
      log.debug(`Found WebKitWebDriver at: ${path}`);
      return path;
    }
  }

  log.warn(
    'WebKitWebDriver not found. Please install it with: sudo apt-get install webkit2gtk-driver (or equivalent for your Linux distribution)',
  );
  return undefined;
}
