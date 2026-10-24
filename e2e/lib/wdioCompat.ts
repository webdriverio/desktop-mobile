// v10 takes an options object here and throws on a boolean; v9 types it as a boolean but only checks it's truthy.
export const attachToElement = { attachToElement: true } as unknown as Parameters<
  WebdriverIO.Browser['overwriteCommand']
>[2];

// v10 renamed `isMultiremote` to `isMultiRemote`, with no alias in either version.
export function isMultiremote(browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser): boolean {
  const flags = browser as unknown as { isMultiRemote?: boolean; isMultiremote?: boolean };
  return Boolean(flags.isMultiRemote ?? flags.isMultiremote);
}
