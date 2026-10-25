import { mockPlatform, restorePlatform } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { needsOwnDisplay, x11Env } from '../src/display.js';

describe('needsOwnDisplay', () => {
  afterEach(() => {
    restorePlatform();
  });

  it('should start an X display on Linux unless one is set', () => {
    mockPlatform('linux');
    expect(needsOwnDisplay({})).toBe(true);
    expect(needsOwnDisplay({ WAYLAND_DISPLAY: 'wayland-0' })).toBe(true);
    expect(needsOwnDisplay({ DISPLAY: ':99' })).toBe(false);
  });

  it('should never start one off Linux', () => {
    mockPlatform('darwin');
    expect(needsOwnDisplay({})).toBe(false);
  });
});

describe('x11Env', () => {
  it('should force X11 and drop the Wayland display', () => {
    const env = x11Env({ WAYLAND_DISPLAY: 'wayland-0', GDK_BACKEND: 'wayland', XDG_SESSION_TYPE: 'wayland' });

    expect(env).toEqual({ GDK_BACKEND: 'x11', XDG_SESSION_TYPE: 'x11' });
  });

  it('should keep every other variable and leave the input unchanged', () => {
    const input = { PATH: '/usr/bin', DISPLAY: ':1', WAYLAND_DISPLAY: 'wayland-0' };

    expect(x11Env(input)).toEqual({ PATH: '/usr/bin', DISPLAY: ':1', GDK_BACKEND: 'x11', XDG_SESSION_TYPE: 'x11' });
    expect(input.WAYLAND_DISPLAY).toBe('wayland-0');
  });
});
