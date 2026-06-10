import { describe, expect, it } from 'vitest';
import { SevereServiceError } from 'webdriverio';

import { unsupportedPlatform } from '../src/errors.js';

describe('unsupportedPlatform', () => {
  it('should be a SevereServiceError naming the platform and supported set', () => {
    const err = unsupportedPlatform('Windows', '@wdio/flutter-service');
    expect(err).toBeInstanceOf(SevereServiceError);
    expect(err.message).toContain('Windows');
    expect(err.message).toContain('@wdio/flutter-service');
    expect(err.message).toContain('Android and iOS');
  });

  it('should fall back to a generic service name', () => {
    expect(unsupportedPlatform('Windows').message).toContain('this mobile service');
  });
});
