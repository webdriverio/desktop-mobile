import { AsyncLocalStorage } from 'node:async_hooks';
import { createLogger } from '@wdio/native-utils';
import { clearPluginAvailabilityCache } from './pluginCache.js';
import type { DriverProvider } from './types.js';

const log = createLogger('tauri-service', 'window');

interface WindowState {
  label: string;
  title: string;
  is_visible: boolean;
  is_focused: boolean;
}

const lastCommandCache = new Map<string, string>();

const currentWindowLabelCache = new Map<string, string>();

const userSwitchedWindowCache = new Set<string>();

const internalWindowSwitchContext = new AsyncLocalStorage<string>();

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

/** Stop automatic focus recovery from overriding a window the user chose explicitly. */
export function suppressActiveWindowFocus(browser: WebdriverIO.Browser): void {
  userSwitchedWindowCache.add(browser.sessionId || 'default');
}

export function isInternalWindowSwitch(browser: WebdriverIO.Browser): boolean {
  return internalWindowSwitchContext.getStore() === (browser.sessionId || 'default');
}

/** Mark a `switchToWindow` issued by the service itself, so it is not read as user intent. */
export async function withInternalWindowSwitch<T>(
  browser: WebdriverIO.Browser,
  operation: () => Promise<T>,
): Promise<T> {
  return internalWindowSwitchContext.run(browser.sessionId || 'default', operation);
}

export function setSessionProvider(browser: WebdriverIO.Browser, provider: DriverProvider): void {
  sessionProviderCache.set(browser.sessionId || 'default', provider);
  log.debug(`Session provider set to: ${provider}`);
}

export function getSessionProvider(browser: WebdriverIO.Browser): DriverProvider {
  return sessionProviderCache.get(browser.sessionId || 'default') ?? 'embedded';
}

async function resolveLabelToHandle(browser: WebdriverIO.Browser, targetLabel: string): Promise<string> {
  const handles = await browser.getWindowHandles();
  const discovered = new Map<string, string>();

  for (const handle of handles) {
    try {
      await browser.switchToWindow(handle);
      const handleLabel = await browser.executeAsync<string | null, []>(
        `var done = arguments[arguments.length - 1];
         try {
           window.__TAURI__.core.invoke('plugin:wdio|get_active_window_label')
             .then(function(l) { done(l); })
             ['catch'](function() { done(null); });
         } catch(e) { done(null); }`,
      );
      if (handleLabel) {
        discovered.set(handleLabel, handle);
        if (handleLabel === targetLabel) {
          return handle;
        }
      }
    } catch {
      log.debug(`Handle ${handle.substring(0, 8)}... is stale or unreachable, skipping`);
    }
  }

  const discoveredLabels = [...discovered.keys()].join(', ');
  throw new Error(
    `No window with label "${targetLabel}" found after checking all handles. Discovered: ${discoveredLabels || 'none'}`,
  );
}

export async function switchWindowByLabel(browser: WebdriverIO.Browser, label: string): Promise<void> {
  try {
    const availableWindows = await listWindowLabels(browser);
    if (!availableWindows.includes(label)) {
      throw new Error(`Window label "${label}" not found. Available windows: ${availableWindows.join(', ')}`);
    }
  } catch (validationError) {
    if (validationError instanceof Error && validationError.message.startsWith('Window label')) {
      throw validationError;
    }
    log.warn(`Could not validate window label "${label}" via IPC, attempting switch directly:`, validationError);
  }

  const sessionKey = browser.sessionId || 'default';
  const provider = getSessionProvider(browser);

  // Suppress auto-focus BEFORE any switching or iteration to prevent focus-change races
  // during handle discovery (ensureActiveWindowFocus checks this flag first).
  suppressActiveWindowFocus(browser);

  try {
    const originalHandle = await browser.getWindowHandle();

    try {
      if (provider === 'embedded') {
        await browser.switchToWindow(label);
      } else {
        const handle = await resolveLabelToHandle(browser, label);
        await browser.switchToWindow(handle);
      }
    } catch (switchError) {
      await browser.switchToWindow(originalHandle).catch(() => {});
      throw new Error(
        `Failed to switch to window with label "${label}": ${switchError instanceof Error ? switchError.message : String(switchError)}`,
      );
    }
  } catch (error) {
    userSwitchedWindowCache.delete(sessionKey);
    throw error;
  }

  clearPluginAvailabilityCache(browser);
  setCurrentWindowLabel(browser, label);
  log.debug(`Successfully switched to window: ${label}`);
}

export async function getActiveWindowLabel(browser: WebdriverIO.Browser): Promise<string> {
  try {
    const result = await browser.tauri.execute(({ core }) => core.invoke('plugin:wdio|get_active_window_label'));
    return result as string;
  } catch (error) {
    log.warn('Failed to get active window label:', error);
    return 'main';
  }
}

export async function listWindowLabels(browser: WebdriverIO.Browser): Promise<string[]> {
  const result = await browser.tauri.execute(({ core }) => core.invoke('plugin:wdio|list_windows'));
  if (!Array.isArray(result)) {
    throw new Error(`Expected array but got ${typeof result}`);
  }
  return result as string[];
}

export async function getCurrentDevtoolsPort(browser: WebdriverIO.Browser): Promise<number | undefined> {
  const caps = browser.capabilities as Record<string, unknown>;
  const chromeOpts = caps['goog:chromeOptions'] as Record<string, unknown> | undefined;

  if (chromeOpts?.debuggerAddress) {
    const match = (chromeOpts.debuggerAddress as string).match(/localhost:(\d+)/);
    return match ? parseInt(match[1], 10) : undefined;
  }

  return undefined;
}

async function switchToWindowByTitle(browser: WebdriverIO.Browser, targetTitle: string): Promise<boolean> {
  log.debug(`Switching to window with title containing "${targetTitle}"`);

  try {
    const handles = await browser.getWindowHandles();
    log.debug(`Available handles: ${JSON.stringify(handles)}`);

    // Build a mapping from title to handle by checking each window once
    const titleToHandle = new Map<string, string>();

    for (const handle of handles) {
      try {
        await browser.switchToWindow(handle);
        const title = await browser.getTitle();
        log.debug(`Handle ${handle.substring(0, 8)}... has title: "${title}"`);
        titleToHandle.set(title, handle);
      } catch {
        log.debug(`Handle ${handle.substring(0, 8)}... is stale, skipping`);
      }
    }

    // Find the handle with matching title from our cached mapping
    for (const [title, handle] of titleToHandle.entries()) {
      if (targetTitle.length > 0 && title.trim() === targetTitle.trim()) {
        log.debug(`Found target window with handle ${handle.substring(0, 8)}...`);
        await browser.switchToWindow(handle);
        return true;
      }
    }

    log.warn(`Could not find window with title containing "${targetTitle}"`);
    return false;
  } catch (error) {
    log.error('Failed to switch window by title:', error);
    return false;
  }
}

async function getWindowStates(browser: WebdriverIO.Browser): Promise<WindowState[]> {
  try {
    const states = await browser.tauri.execute(({ core }) => core.invoke('plugin:wdio|get_window_states'));
    return states as WindowState[];
  } catch (error) {
    log.warn('Failed to get window states:', error);
    return [];
  }
}

function findActiveWindow(states: WindowState[]): WindowState | undefined {
  // For testing, the "active" window is the one that should receive interactions.
  // Priority: 1) Visible AND focused, 2) Visible, 3) Focused, 4) First available
  // This handles platform differences (Windows webview2 vs Linux WebKit)

  // First, try to find a window that is BOTH visible AND focused
  const visibleAndFocusedWindow = states.find((w) => w.is_visible && w.is_focused);
  if (visibleAndFocusedWindow) {
    return visibleAndFocusedWindow;
  }

  // Second, find the first VISIBLE window (prioritize visibility over focus)
  // This is critical for Windows where focused window may not be visible initially
  const visibleWindow = states.find((w) => w.is_visible);
  if (visibleWindow) {
    return visibleWindow;
  }

  // Third, find any focused window (even if not visible - fallback)
  const focusedWindow = states.find((w) => w.is_focused);
  if (focusedWindow) {
    return focusedWindow;
  }

  // Fallback: return the first window (for consistency)
  return states[0];
}

/**
 * Ensure the WebDriver session is focused on the active window
 * Mirrors Electron's ensureActiveWindowFocus() - completely generic
 *
 * @param browser WebdriverIO browser instance
 * @param commandName Name of the command being executed
 * @returns Promise that resolves when focus is ensured
 */
export async function ensureActiveWindowFocus(browser: WebdriverIO.Browser, commandName: string): Promise<void> {
  // Skip auto-focus if the user has explicitly set a window label via switchWindow()
  // This prevents the auto-focus logic from silently undoing explicit switches.
  // Only skip when the label is a non-default value (user explicitly switched, not just initialized).
  if (userSwitchedWindowCache.has(browser.sessionId || 'default')) {
    log.debug('Skipping auto-focus: user has explicitly switched windows');
    return;
  }

  // Only check for focus on certain commands (like Electron)
  const focusCommands = ['getTitle', 'findElement', 'findElements', '$', '$$', 'elementClick'];
  if (!focusCommands.includes(commandName)) {
    return;
  }

  try {
    // Get all window states from Tauri (like Electron's puppeteer.targets())
    const states = await getWindowStates(browser);

    if (states.length === 0) {
      log.debug('No window states available, skipping focus check');
      return;
    }

    log.debug(`Window states: ${JSON.stringify(states)}`);

    // Find the currently active window (focused or visible)
    const activeWindow = findActiveWindow(states);

    if (!activeWindow) {
      log.debug('No active window found');
      return;
    }

    log.debug(
      `Active window: ${activeWindow.label} (title: "${activeWindow.title}", visible: ${activeWindow.is_visible}, focused: ${activeWindow.is_focused})`,
    );

    // Get current browser title to see if we're already on the right window
    const currentTitle = await browser.getTitle();
    log.debug(`Current browser title: "${currentTitle}"`);

    // If we're already on the active window, no need to switch
    if (currentTitle.trim() === activeWindow.title.trim()) {
      log.debug('Already on active window, no switch needed');
      return;
    }

    // Switch to the active window
    log.debug(`[SERVICE] Switching to active window: ${activeWindow.title}`);
    // Marked internal: this switch is the service recovering focus, not the user
    // choosing a window. Without the marker the service's own `switchToWindow`
    // would look like an explicit selection and permanently disable recovery.
    const switched = await withInternalWindowSwitch(browser, () => switchToWindowByTitle(browser, activeWindow.title));

    if (switched) {
      log.debug(`[SERVICE] Successfully switched to active window`);
      // Verify the switch worked
      const newTitle = await browser.getTitle();
      log.debug(`[SERVICE] Title after switch: "${newTitle}"`);
    } else {
      log.warn(`[SERVICE] Failed to switch to active window: ${activeWindow.title}`);
    }
  } catch (error) {
    log.warn('Failed to ensure window focus:', error);
  }
}

export function updateLastCommand(browser: WebdriverIO.Browser, commandName: string): void {
  lastCommandCache.set(browser.sessionId || 'default', commandName);
}

export function getLastCommand(browser: WebdriverIO.Browser): string | undefined {
  return lastCommandCache.get(browser.sessionId || 'default');
}

export function clearWindowState(sessionId?: string): void {
  if (sessionId) {
    lastCommandCache.delete(sessionId);
    currentWindowLabelCache.delete(sessionId);
    userSwitchedWindowCache.delete(sessionId);
    sessionProviderCache.delete(sessionId);
  } else {
    lastCommandCache.clear();
    currentWindowLabelCache.clear();
    userSwitchedWindowCache.clear();
    sessionProviderCache.clear();
  }
}
