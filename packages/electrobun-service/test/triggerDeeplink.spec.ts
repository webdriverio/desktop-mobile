import * as nativeCore from '@wdio/native-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { triggerDeeplink } from '../src/commands/triggerDeeplink.js';

// Keep the pure validators (validateDeeplinkUrl / getPlatformCommand) real; only
// stub the side-effecting spawn so no real process is launched.
vi.mock('@wdio/native-core', async (importOriginal) => {
  const actual = await importOriginal<typeof nativeCore>();
  return { ...actual, executeDeeplinkCommand: vi.fn(async () => {}) };
});

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  vi.clearAllMocks();
});

describe('triggerDeeplink', () => {
  it('should spawn the macOS open handler for a valid custom-scheme URL', async () => {
    setPlatform('darwin');
    await triggerDeeplink('wdio-electrobun://open?path=/test');
    expect(nativeCore.executeDeeplinkCommand).toHaveBeenCalledWith('open', ['wdio-electrobun://open?path=/test']);
  });

  it('should reject http/https/file URLs', async () => {
    setPlatform('darwin');
    await expect(triggerDeeplink('https://example.com')).rejects.toThrow();
    expect(nativeCore.executeDeeplinkCommand).not.toHaveBeenCalled();
  });

  it('should throw the documented-gap error on non-macOS platforms', async () => {
    setPlatform('win32');
    await expect(triggerDeeplink('wdio-electrobun://x')).rejects.toThrow(/macOS/);
    expect(nativeCore.executeDeeplinkCommand).not.toHaveBeenCalled();
  });
});
