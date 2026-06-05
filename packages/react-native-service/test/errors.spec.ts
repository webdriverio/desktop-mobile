import { describe, expect, it } from 'vitest';
import { SevereServiceError } from 'webdriverio';

import { hermesUnavailable, unsupportedPlatform } from '../src/errors.js';

describe('unsupportedPlatform', () => {
  it('should be a SevereServiceError naming the platform and supported set', () => {
    const err = unsupportedPlatform('Windows');
    expect(err).toBeInstanceOf(SevereServiceError);
    expect(err.message).toContain('Windows');
    expect(err.message).toContain('Android and iOS');
  });
});

describe('hermesUnavailable', () => {
  it('should be a non-severe Error naming the Metro host and port', () => {
    const err = hermesUnavailable('localhost', 8081);
    expect(err).toBeInstanceOf(Error);
    // Recoverable (a debug-build/Metro prerequisite), not a run-aborting SevereServiceError.
    expect(err).not.toBeInstanceOf(SevereServiceError);
    expect(err.message).toContain('localhost');
    expect(err.message).toContain('8081');
  });
});
