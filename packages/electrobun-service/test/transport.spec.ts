import { describe, expect, it } from 'vitest';

import type { ResolvedElectrobunApp } from '../src/electrobunConfig.js';
import { resolveTransport } from '../src/transport.js';

// `renderer` is what `readRenderer` writes onto the resolved app: build.json's
// `renderer ?? defaultRenderer`, lower-cased, or undefined when unrecorded.
const app = (renderer?: string): ResolvedElectrobunApp => ({
  binaryPath: '/app/bin',
  bundlePath: '/app',
  resourcesDir: '/app/Resources',
  buildJsonPath: '/app/Resources/build.json',
  renderer,
});

describe('resolveTransport', () => {
  it('should return cef on macOS regardless of the recorded renderer', () => {
    expect(resolveTransport(app('cef'), 'darwin')).toBe('cef');
    expect(resolveTransport(app('native'), 'darwin')).toBe('cef');
    expect(resolveTransport(app(undefined), 'darwin')).toBe('cef');
  });

  it('should return webview2 on Windows for the native renderer', () => {
    expect(resolveTransport(app('native'), 'win32')).toBe('webview2');
    expect(resolveTransport(app('webview2'), 'win32')).toBe('webview2');
  });

  it('should default to webview2 on Windows when no renderer is recorded', () => {
    expect(resolveTransport(app(undefined), 'win32')).toBe('webview2');
    expect(resolveTransport(app(''), 'win32')).toBe('webview2');
  });

  it('should return undefined on Windows for an explicit CEF build (CEF serves no /json there)', () => {
    expect(resolveTransport(app('cef'), 'win32')).toBeUndefined();
  });

  it('should match the CEF renderer exactly, not by substring', () => {
    // A renderer value that merely contains "cef" is NOT a CEF build → still WebView2.
    expect(resolveTransport(app('native-cefless'), 'win32')).toBe('webview2');
  });

  it('should return webkitgtk on Linux for the native renderer (W3C WebDriver)', () => {
    expect(resolveTransport(app('native'), 'linux')).toBe('webkitgtk');
    expect(resolveTransport(app(undefined), 'linux')).toBe('webkitgtk');
    expect(resolveTransport(app(''), 'linux')).toBe('webkitgtk');
  });

  it('should return undefined on Linux for an explicit CEF build (CEF serves no /json there)', () => {
    expect(resolveTransport(app('cef'), 'linux')).toBeUndefined();
  });

  it('should return undefined on any other platform', () => {
    expect(resolveTransport(app('native'), 'freebsd' as NodeJS.Platform)).toBeUndefined();
    expect(resolveTransport(app(undefined), 'freebsd' as NodeJS.Platform)).toBeUndefined();
  });
});
