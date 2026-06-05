import { describe, expect, it } from 'vitest';

import * as rn from '../src/index.js';

describe('@wdio/react-native-service exports', () => {
  it('should expose the Metro constants', () => {
    expect(rn.DEFAULT_METRO_HOST).toBe('localhost');
    expect(rn.DEFAULT_METRO_PORT).toBe(8081);
  });

  it('should expose the Hermes bridge foundation', () => {
    expect(typeof rn.createHermesBridge).toBe('function');
    expect(typeof rn.selectHermesTarget).toBe('function');
    expect(typeof rn.metroOrigin).toBe('function');
  });
});
