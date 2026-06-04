// Internal mock-layer types for @wdio/electrobun-service. Kept local (not in
// @wdio/native-types) because they only describe the inner-recorder transport,
// not the public browser.electrobun.* surface.

export type InnerMockSetterMethod =
  | 'mockReturnValue'
  | 'mockReturnValueOnce'
  | 'mockResolvedValue'
  | 'mockResolvedValueOnce'
  | 'mockRejectedValue'
  | 'mockRejectedValueOnce';
