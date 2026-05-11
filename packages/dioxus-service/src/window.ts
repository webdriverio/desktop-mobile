// Multi-window helpers for `@wdio/dioxus-service`.
//
// The Dioxus bridge auto-labels windows in creation order — first is 'main',
// subsequent are 'window-1', 'window-2', .... This module exposes:
//
//   - Active-label/list helpers that call into the bridge via
//     `dx.invoke('__list_windows')` / `dx.invoke('__active_window')`.
//   - A per-sessionId label cache so service code can ask "what window did
//     the user last switch to?" without re-querying the bridge.
//   - `switchWindowByLabel` which validates the label exists, resolves it
//     to a WebDriver handle, and updates the cache.
//
// Phase 4 scope: provider 'external' only (Windows/Linux msedgedriver
// proxy). Phase 6 (embedded provider) will branch the switch path so the
// embedded driver can switch by label directly without handle resolution.

import { createLogger } from '@wdio/native-utils';

import { execute } from './commands/execute.js';

const log = createLogger('dioxus-service', 'window');

const currentWindowLabelCache = new Map<string, string>();

const DEFAULT_WINDOW_LABEL = 'main';

function sessionKey(browser: WebdriverIO.Browser): string {
  return browser.sessionId || 'default';
}

/**
 * Default label assigned to the first window in any Dioxus app.
 * Mirrors the bridge's `window_state::allocate_label(0)` output.
 */
export function getDefaultWindowLabel(): string {
  return DEFAULT_WINDOW_LABEL;
}

/**
 * Last label the test process explicitly switched to in this session,
 * defaulting to 'main' when no switch has happened yet.
 */
export function getCurrentWindowLabel(browser: WebdriverIO.Browser): string {
  return currentWindowLabelCache.get(sessionKey(browser)) ?? DEFAULT_WINDOW_LABEL;
}

/**
 * Internal: update the per-session label cache after a successful switch.
 * Exposed for tests; production code should call {@link switchWindowByLabel}.
 */
export function setCurrentWindowLabel(browser: WebdriverIO.Browser, label: string): void {
  currentWindowLabelCache.set(sessionKey(browser), label);
}

/**
 * Drop cached state for a session (or all sessions when omitted). Used in
 * the worker service's `after()` hook to prevent label leakage across
 * spec files in the same WDIO worker.
 */
export function clearWindowState(browserOrSessionId?: WebdriverIO.Browser | string): void {
  if (!browserOrSessionId) {
    currentWindowLabelCache.clear();
    return;
  }
  const key = typeof browserOrSessionId === 'string' ? browserOrSessionId : sessionKey(browserOrSessionId);
  currentWindowLabelCache.delete(key);
}

/**
 * Active window label as reported by the bridge. Falls back to 'main' if
 * the bridge isn't available (e.g. when the webview is mid-load).
 */
export async function getActiveWindowLabel(browser: WebdriverIO.Browser): Promise<string> {
  try {
    const result = await execute(browser, (dx) => dx.invoke('__active_window'));
    return (result as string | null) ?? DEFAULT_WINDOW_LABEL;
  } catch (error) {
    log.warn('Failed to read active window label via bridge:', error);
    return DEFAULT_WINDOW_LABEL;
  }
}

/**
 * Live windows, in registration order. The bridge filters out windows
 * whose `Weak<Window>` has been dropped (closed).
 */
export async function listWindowLabels(browser: WebdriverIO.Browser): Promise<string[]> {
  const result = await execute(browser, (dx) => dx.invoke('__list_windows'));
  if (!Array.isArray(result)) {
    throw new Error(`[@wdio/dioxus-service] expected __list_windows to return an array, got ${typeof result}`);
  }
  // Validate item shape: a bridge protocol drift could return `[null]` or
  // `[42]`, which the rest of the service would silently misinterpret
  // (e.g. `includes()` returning false where a downstream caller expects
  // a missing-label error). Catch the mismatch here at the boundary.
  if (!result.every((item) => typeof item === 'string')) {
    const types = result.map((item) => (item === null ? 'null' : typeof item)).join(', ');
    throw new Error(`[@wdio/dioxus-service] __list_windows returned non-string items: [${types}]`);
  }
  return result as string[];
}

/**
 * Walk WebDriver's window handles, asking each one which Dioxus window
 * label it corresponds to. Returns the handle string for the matching
 * label, or throws if no handle reports that label.
 */
async function resolveLabelToHandle(browser: WebdriverIO.Browser, targetLabel: string): Promise<string> {
  const handles = await browser.getWindowHandles();
  const discovered = new Map<string, string>();

  for (const handle of handles) {
    try {
      await browser.switchToWindow(handle);
      const handleLabel = await execute(browser, (dx) => dx.invoke('__active_window'));
      if (typeof handleLabel === 'string' && handleLabel.length > 0) {
        discovered.set(handleLabel, handle);
        if (handleLabel === targetLabel) {
          return handle;
        }
      }
    } catch {
      log.debug(`Handle ${handle.slice(0, 8)}... unreachable, skipping`);
    }
  }

  const labels = [...discovered.keys()].join(', ') || 'none';
  throw new Error(
    `[@wdio/dioxus-service] no window with label "${targetLabel}" found after checking all handles. Discovered: ${labels}`,
  );
}

/**
 * Switch the active WebDriver context to the window labelled `label`.
 *
 *   1. Validates that `label` is in the bridge's live-window list.
 *   2. Walks handles via `resolveLabelToHandle` (which leaves the driver
 *      on the matching handle as a side effect).
 *   3. Updates the per-session label cache.
 *
 * If resolution fails, the original handle is restored before the error
 * is propagated.
 */
export async function switchWindowByLabel(browser: WebdriverIO.Browser, label: string): Promise<void> {
  const available = await listWindowLabels(browser);
  if (!available.includes(label)) {
    throw new Error(
      `[@wdio/dioxus-service] window label "${label}" not found. Available: ${available.join(', ') || '(none)'}`,
    );
  }

  const originalHandle = await browser.getWindowHandle();
  try {
    // resolveLabelToHandle leaves the driver focused on the matching
    // handle when it succeeds — no follow-up switchToWindow call needed.
    await resolveLabelToHandle(browser, label);
  } catch (switchError) {
    await browser.switchToWindow(originalHandle).catch(() => undefined);
    // Re-throw the inner error unmodified — it already carries the
    // package prefix and discoverable context (which handles were
    // probed, etc.). Wrapping here produced a double-prefixed string.
    throw switchError;
  }

  setCurrentWindowLabel(browser, label);
  log.debug(`switched to window: ${label}`);
}
