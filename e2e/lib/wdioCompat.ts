// The third argument is `true` in v9 and `{ attachToElement: true }` in v10, which throws on a boolean.
// v9 only checks that it's truthy, so the object works on both; the cast gets it past v9's boolean type.
export const attachToElement = { attachToElement: true } as unknown as Parameters<
  WebdriverIO.Browser['overwriteCommand']
>[2];
