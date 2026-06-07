// browser.reactNative.switchWindow / listWindows — Appium context switching.
// React Native "windows" = Appium contexts: NATIVE_APP, WEBVIEW_<packageId>, etc.

export async function listWindows(browser: WebdriverIO.Browser): Promise<string[]> {
  // Appium 2 drivers may return plain context strings OR ContextInfo objects
  // ({ id, title?, ... }, e.g. via the `mobile: getContexts` extended API). Normalise
  // to the id string so callers can compare against 'NATIVE_APP' / 'WEBVIEW_*' directly.
  const contexts = (await browser.getContexts()) as unknown as Array<string | { id: string }>;
  return contexts.map((context) => (typeof context === 'string' ? context : context.id));
}

export async function switchWindow(browser: WebdriverIO.Browser, context: string): Promise<void> {
  await browser.switchContext(context);
}
