import { describe, expect, it } from 'vitest';
import { SevereServiceError } from 'webdriverio';

import { cefRendererRequired, deeplinkUnsupportedOnPlatform } from '../src/errors.js';

describe('cefRendererRequired', () => {
  it('should be a SevereServiceError so the runner aborts', () => {
    const err = cefRendererRequired('darwin');
    expect(err).toBeInstanceOf(SevereServiceError);
  });

  it('should explain the CEF renderer requirement', () => {
    const err = cefRendererRequired('darwin');
    expect(err.message).toContain('CEF renderer');
    expect(err.message).toContain('electrobun.config.ts');
  });

  it('should name the current platform in the message', () => {
    expect(cefRendererRequired('linux').message).toContain('linux');
    expect(cefRendererRequired('win32').message).toContain('win32');
  });
});

describe('deeplinkUnsupportedOnPlatform', () => {
  it('should be a plain Error (a recoverable command rejection, not severe)', () => {
    const err = deeplinkUnsupportedOnPlatform('win32');
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SevereServiceError);
  });

  it('should state that only macOS is supported and name the platform', () => {
    const err = deeplinkUnsupportedOnPlatform('linux');
    expect(err.message).toContain('macOS');
    expect(err.message).toContain('linux');
  });
});
