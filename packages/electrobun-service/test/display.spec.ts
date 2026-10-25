import { mockPlatform, restorePlatform } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { needsOwnDisplay } from '../src/display.js';

describe('needsOwnDisplay', () => {
  afterEach(() => {
    restorePlatform();
  });

  it('should start a display on Linux when none is set', () => {
    mockPlatform('linux');
    expect(needsOwnDisplay({})).toBe(true);
  });

  it('should reuse an X11 or Wayland display already set, such as WebdriverIO v10 starts', () => {
    mockPlatform('linux');
    expect(needsOwnDisplay({ DISPLAY: ':99' })).toBe(false);
    expect(needsOwnDisplay({ WAYLAND_DISPLAY: 'wayland-1' })).toBe(false);
  });

  it('should never start one off Linux', () => {
    mockPlatform('darwin');
    expect(needsOwnDisplay({})).toBe(false);
  });
});
