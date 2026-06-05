// Internal mock-layer types for @wdio/react-native-service. Kept local (not in
// @wdio/native-types) because they only describe the inner-recorder transport,
// not the public browser.reactNative.* surface.

export type InnerMockSetterMethod =
  | 'mockReturnValue'
  | 'mockReturnValueOnce'
  | 'mockResolvedValue'
  | 'mockResolvedValueOnce'
  | 'mockRejectedValue'
  | 'mockRejectedValueOnce';
