import { describe, expect, it } from 'vitest';
import { SevereServiceError } from 'webdriverio';

import {
  cefRendererRequired,
  deeplinkUnsupportedOnPlatform,
  nativeRendererUnsupportedPlatform,
  webKitWebDriverNotFound,
} from '../src/errors.js';

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

describe('nativeRendererUnsupportedPlatform', () => {
  it('should be a SevereServiceError so the runner aborts', () => {
    expect(nativeRendererUnsupportedPlatform('linux')).toBeInstanceOf(SevereServiceError);
  });

  it('should name the unsupported platform and the supported renderers', () => {
    const err = nativeRendererUnsupportedPlatform('freebsd' as NodeJS.Platform);
    expect(err.message).toContain('freebsd');
    expect(err.message).toContain('CEF');
    expect(err.message).toContain('WebView2');
    expect(err.message).toContain('WebKitGTK');
  });

  it('should include the renderer when given (e.g. a CEF build off macOS)', () => {
    const err = nativeRendererUnsupportedPlatform('win32', 'cef');
    expect(err.message).toContain('win32');
    expect(err.message).toContain('renderer: cef');
  });

  it('should guide a CEF build off macOS to the native renderer', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const err = nativeRendererUnsupportedPlatform(platform, 'cef');
      expect(err.message).toContain('defaultRenderer: "native"');
    }
  });

  it('should point an unsupported platform to browser mode', () => {
    const err = nativeRendererUnsupportedPlatform('freebsd' as NodeJS.Platform);
    expect(err.message).toContain("mode: 'browser'");
  });
});

describe('webKitWebDriverNotFound', () => {
  it('should be a SevereServiceError naming the install package', () => {
    const err = webKitWebDriverNotFound();
    expect(err).toBeInstanceOf(SevereServiceError);
    expect(err.message).toContain('WebKitWebDriver');
    expect(err.message).toContain('webkit2gtk-driver');
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
