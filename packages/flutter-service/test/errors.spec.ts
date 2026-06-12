import { describe, expect, it } from 'vitest';
import { SevereServiceError } from 'webdriverio';

import { unsupportedPlatform, vmServiceUnavailable } from '../src/errors.js';

describe('unsupportedPlatform', () => {
  it('should be a SevereServiceError naming the Flutter service and the supported set', () => {
    const err = unsupportedPlatform('Windows');
    expect(err).toBeInstanceOf(SevereServiceError);
    expect(err.message).toContain('Windows');
    expect(err.message).toContain('@wdio/flutter-service');
    expect(err.message).toContain('Android and iOS');
  });
});

describe('vmServiceUnavailable', () => {
  it('should be a non-severe Error naming the host and detail', () => {
    const err = vmServiceUnavailable('localhost', 'connect timeout');
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SevereServiceError);
    expect(err.message).toContain('localhost');
    expect(err.message).toContain('connect timeout');
    expect(err.message).toContain('enableFlutterDriverExtension');
  });
});
