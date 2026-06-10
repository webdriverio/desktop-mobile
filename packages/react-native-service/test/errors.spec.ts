import { describe, expect, it } from 'vitest';
import { SevereServiceError } from 'webdriverio';

import { unsupportedPlatform } from '../src/errors.js';

describe('unsupportedPlatform', () => {
  it('should be a SevereServiceError naming the platform and supported set', () => {
    const err = unsupportedPlatform('Windows');
    expect(err).toBeInstanceOf(SevereServiceError);
    expect(err.message).toContain('Windows');
    expect(err.message).toContain('Android and iOS');
  });
});
