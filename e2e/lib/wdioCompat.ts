// The third argument is `true` in v9 and `{ attachToElement: true }` in v10, which throws on a boolean.
// v9 only checks that it's truthy, so the object works on both; the cast gets it past v9's boolean type.
export const attachToElement = { attachToElement: true } as unknown as Parameters<
  WebdriverIO.Browser['overwriteCommand']
>[2];

// v10 renamed `isMultiremote` to `isMultiRemote`, with no alias in either version.
export function isMultiremote(browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser): boolean {
  const flags = browser as unknown as { isMultiRemote?: boolean; isMultiremote?: boolean };
  return Boolean(flags.isMultiRemote ?? flags.isMultiremote);
}
