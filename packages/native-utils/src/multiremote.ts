/** Whether `browser` is a multiremote root. WebdriverIO v10 renamed `isMultiremote` to `isMultiRemote`. */
export function isMultiremote(
  browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser,
): browser is WebdriverIO.MultiRemoteBrowser {
  const flags = browser as unknown as { isMultiRemote?: boolean; isMultiremote?: boolean };
  return (flags.isMultiRemote ?? flags.isMultiremote) === true;
}
