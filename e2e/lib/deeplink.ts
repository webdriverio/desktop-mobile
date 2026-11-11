/**
 * Shared deeplink testing helpers for Electron and Tauri
 */

/**
 * Type for the electron/tauri API context accessor
 */
type ContextAccessor = () => { execute<T>(fn: (context: unknown) => T | undefined): Promise<T | undefined> };

type BrowserAccessor = () => WebdriverIO.Browser;

/**
 * Create deeplink test helpers for a given context accessor.
 * In multiremote, pass the instance to wait on: the root runs `waitUntil` on every instance.
 */
export function createDeeplinkHelpers(
  contextAccessor: ContextAccessor,
  browserAccessor: BrowserAccessor = () => browser,
) {
  const getContext = contextAccessor;

  /**
   * Helper: Wait for a specific number of deeplinks to be received
   */
  async function waitForDeeplink(expectedCount = 1, timeoutMsg = 'App did not receive the deeplink') {
    const ctx = getContext();
    await browserAccessor().waitUntil(
      async () => {
        const count = (await ctx.execute(() => (globalThis as { deeplinkCount?: number }).deeplinkCount)) ?? 0;
        return count >= expectedCount;
      },
      {
        timeout: 30000,
        timeoutMsg,
      },
    );
  }

  /**
   * Helper: Wait for deeplink state to stabilize (no more incoming deeplinks)
   */
  async function waitForDeeplinkStability() {
    const ctx = getContext();
    let previousCount = (await ctx.execute(() => (globalThis as { deeplinkCount?: number }).deeplinkCount)) ?? 0;

    const waitOn = browserAccessor();
    await waitOn.waitUntil(
      async () => {
        await waitOn.pause(1000);
        const currentCount = (await ctx.execute(() => (globalThis as { deeplinkCount?: number }).deeplinkCount)) ?? 0;
        const isStable = currentCount === previousCount;
        previousCount = currentCount;
        return isStable;
      },
      {
        timeout: 5000,
        timeoutMsg: 'Deeplink state did not stabilize',
      },
    );
  }

  /**
   * Helper: Clear deeplink state
   */
  async function clearDeeplinkState() {
    const ctx = getContext();
    await ctx.execute(() => {
      globalThis.receivedDeeplinks = [];
      globalThis.deeplinkCount = 0;
    });
  }

  return {
    waitForDeeplink,
    waitForDeeplinkStability,
    clearDeeplinkState,
  };
}

/**
 * Whether Tauri's `triggerDeeplink()` emits the deep-link event in the app, rather than opening the URL through
 * the OS. Mirrors the route choice in tauri-service's `triggerDeeplink.ts`; the configs treat an unset
 * `DRIVER_PROVIDER` as `'external'`.
 */
export function tauriDeeplinkEmitsInApp(provider = process.env.DRIVER_PROVIDER ?? 'external'): boolean {
  return provider === 'embedded' || (provider === 'crabnebula' && process.platform === 'darwin');
}
