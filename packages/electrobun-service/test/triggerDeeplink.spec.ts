import { mockPlatform, restorePlatform } from '@repo/test-utils';
import * as nativeCore from '@wdio/native-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { triggerDeeplink } from '../src/commands/triggerDeeplink.js';

// Keep the pure validators (validateDeeplinkUrl / getPlatformCommand) real; only
// stub the side-effecting spawn so no real process is launched.
vi.mock('@wdio/native-core', async (importOriginal) => {
  const actual = await importOriginal<typeof nativeCore>();
  return { ...actual, executeDeeplinkCommand: vi.fn(async () => {}) };
});

afterEach(() => {
  restorePlatform();
  vi.clearAllMocks();
});

describe('triggerDeeplink', () => {
  it('should spawn the macOS open handler for a valid custom-scheme URL', async () => {
    mockPlatform('darwin');
    await triggerDeeplink('wdio-electrobun://open?path=/test');
    expect(nativeCore.executeDeeplinkCommand).toHaveBeenCalledWith('open', ['wdio-electrobun://open?path=/test']);
  });

  it('should reject http/https/file URLs', async () => {
    mockPlatform('darwin');
    await expect(triggerDeeplink('https://example.com')).rejects.toThrow();
    expect(nativeCore.executeDeeplinkCommand).not.toHaveBeenCalled();
  });

  it('should throw the documented-gap error on non-macOS platforms', async () => {
    mockPlatform('win32');
    await expect(triggerDeeplink('wdio-electrobun://x')).rejects.toThrow(/macOS/);
    expect(nativeCore.executeDeeplinkCommand).not.toHaveBeenCalled();
  });
});
