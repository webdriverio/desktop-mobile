import { describe, expect, it } from 'vitest';

import * as rn from '../src/index.js';

describe('@wdio/react-native-service exports', () => {
  it('should export the launcher and default worker service', () => {
    expect(typeof rn.launcher).toBe('function');
    expect(typeof rn.default).toBe('function');
  });

  it('should export standalone session helpers', () => {
    expect(typeof rn.startWdioSession).toBe('function');
    expect(typeof rn.cleanupWdioSession).toBe('function');
    expect(typeof rn.createReactNativeCapabilities).toBe('function');
  });
});
