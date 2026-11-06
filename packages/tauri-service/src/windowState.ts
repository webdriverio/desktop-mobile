import { createLogger } from '@wdio/native-utils';
import type { DriverProvider } from './types.js';

// Kept out of window.ts, which imports commands/execute.ts: the bundler rejects the import cycle

const log = createLogger('tauri-service', 'window');

const currentWindowLabelCache = new Map<string, string>();

const sessionProviderCache = new Map<string, DriverProvider>();

const DEFAULT_WINDOW_LABEL = 'main';

export function getDefaultWindowLabel(): string {
  return DEFAULT_WINDOW_LABEL;
}

export function getCurrentWindowLabel(browser: WebdriverIO.Browser): string {
  return currentWindowLabelCache.get(browser.sessionId || 'default') || DEFAULT_WINDOW_LABEL;
}

export function setCurrentWindowLabel(browser: WebdriverIO.Browser, label: string): void {
  currentWindowLabelCache.set(browser.sessionId || 'default', label);
  log.debug(`Current window label set to: ${label}`);
}

export function setSessionProvider(browser: WebdriverIO.Browser, provider: DriverProvider): void {
  sessionProviderCache.set(browser.sessionId || 'default', provider);
  log.debug(`Session provider set to: ${provider}`);
}

export function getSessionProvider(browser: WebdriverIO.Browser): DriverProvider {
  return sessionProviderCache.get(browser.sessionId || 'default') ?? 'embedded';
}

export function clearSessionWindowState(sessionId?: string): void {
  if (sessionId) {
    currentWindowLabelCache.delete(sessionId);
    sessionProviderCache.delete(sessionId);
  } else {
    currentWindowLabelCache.clear();
    sessionProviderCache.clear();
  }
}
