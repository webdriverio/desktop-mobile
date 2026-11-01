import { describe, expect, it } from 'vitest';
import { standaloneRequestTimeout } from '../src/standalone.js';

describe('standaloneRequestTimeout', () => {
  it('should return an empty object when options or connectionRetryTimeout is omitted', () => {
    expect(standaloneRequestTimeout()).toEqual({});
    expect(standaloneRequestTimeout({})).toEqual({});
    expect(standaloneRequestTimeout({ connectionRetryTimeout: undefined })).toEqual({});
  });

  it('should return connectionRetryTimeout when set', () => {
    expect(standaloneRequestTimeout({ connectionRetryTimeout: 60_000 })).toEqual({
      connectionRetryTimeout: 60_000,
    });
  });
});
