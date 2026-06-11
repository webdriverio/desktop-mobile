// browser.reactNative.switchContext / listContexts — Appium context switching.
// The mobile counterpart of the desktop services' switchWindow/listWindows: contexts
// are NATIVE_APP, WEBVIEW_<packageId>, etc.

export async function listContexts(browser: WebdriverIO.Browser): Promise<string[]> {
  // Appium 2 drivers may return plain context strings OR ContextInfo objects
  // ({ id, title?, ... }, e.g. via the `mobile: getContexts` extended API). Normalise
  // to the id string so callers can compare against 'NATIVE_APP' / 'WEBVIEW_*' directly.
  const contexts = (await browser.getContexts()) as unknown as Array<string | { id: string }>;
  return contexts.map((context) => (typeof context === 'string' ? context : context.id));
}

export async function switchContext(browser: WebdriverIO.Browser, context: string): Promise<void> {
  await browser.switchContext(context);
}
