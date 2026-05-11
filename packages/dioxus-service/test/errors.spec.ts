import { describe, expect, it } from 'vitest';

import { linuxExternalProviderUnsupported, SevereServiceError } from '../src/errors.js';

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

    it('should reference the spike findings document', () => {
      expect(linuxExternalProviderUnsupported().message).toContain('FINDINGS.md');
    });
  });
});
