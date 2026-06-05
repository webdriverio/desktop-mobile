// browser.reactNative.switchWindow / listWindows — Appium context switching.
// React Native "windows" = Appium contexts: NATIVE_APP, WEBVIEW_<packageId>, etc.

export async function listWindows(browser: WebdriverIO.Browser): Promise<string[]> {
  return browser.getContexts() as Promise<string[]>;
}

export async function switchWindow(browser: WebdriverIO.Browser, context: string): Promise<void> {
  await browser.switchContext(context);
}
