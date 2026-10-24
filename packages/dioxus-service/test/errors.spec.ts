import { describe, expect, it } from 'vitest';

import {
  linuxExternalProviderUnsupported,
  SevereServiceError,
  windowsExternalProviderUnsupported,
} from '../src/errors.js';

describe('errors', () => {
  describe('linuxExternalProviderUnsupported', () => {
    it('should return a SevereServiceError instance', () => {
      const err = linuxExternalProviderUnsupported();
      expect(err).toBeInstanceOf(SevereServiceError);
    });

    it('should point users at the embedded provider', () => {
      expect(linuxExternalProviderUnsupported().message).toContain("'embedded'");
    });

    it('should explain why external is unsupported on Linux', () => {
      expect(linuxExternalProviderUnsupported().message).toContain('upstream Dioxus');
    });

    it('should link the tracking issue', () => {
      expect(linuxExternalProviderUnsupported().message).toContain('desktop-mobile/issues/713');
    });
  });

  describe('windowsExternalProviderUnsupported', () => {
    it('should return a SevereServiceError instance', () => {
      expect(windowsExternalProviderUnsupported()).toBeInstanceOf(SevereServiceError);
    });

    it('should point users at the embedded provider', () => {
      expect(windowsExternalProviderUnsupported().message).toContain("'embedded'");
    });

    it('should link the tracking issue', () => {
      expect(windowsExternalProviderUnsupported().message).toContain('desktop-mobile/issues/713');
    });
  });
});
