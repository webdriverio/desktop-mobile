import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@wdio/native-core', async () => {
  const actual = await vi.importActual<typeof import('@wdio/native-core')>('@wdio/native-core');
  return {
    ...actual,
    executeDeeplinkCommand: vi.fn().mockResolvedValue(undefined),
  };
});

import { executeDeeplinkCommand } from '@wdio/native-core';
import { triggerDeeplink } from '../../src/commands/triggerDeeplink.js';

const originalPlatform = process.platform;

afterEach(() => {
  vi.mocked(executeDeeplinkCommand).mockClear();
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

describe('triggerDeeplink', () => {
  it('should spawn the macOS open command for a valid custom-protocol URL', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    await triggerDeeplink('myapp://open?file=test');

    expect(executeDeeplinkCommand).toHaveBeenCalledWith('open', ['myapp://open?file=test']);
  });

  it('should spawn rundll32 on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    await triggerDeeplink('myapp://open');

    expect(executeDeeplinkCommand).toHaveBeenCalledWith('rundll32.exe', [
      'url.dll,FileProtocolHandler',
      'myapp://open',
    ]);
  });

  it('should spawn gio open on Linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    await triggerDeeplink('myapp://open');

    expect(executeDeeplinkCommand).toHaveBeenCalledWith('gio', ['open', 'myapp://open']);
  });

  it('should reject http URLs', async () => {
    await expect(triggerDeeplink('http://example.com')).rejects.toThrow(/Invalid deeplink protocol: http/);
    expect(executeDeeplinkCommand).not.toHaveBeenCalled();
  });

  it('should reject https URLs', async () => {
    await expect(triggerDeeplink('https://example.com')).rejects.toThrow(/Invalid deeplink protocol: https/);
    expect(executeDeeplinkCommand).not.toHaveBeenCalled();
  });

  it('should reject file URLs', async () => {
    await expect(triggerDeeplink('file:///tmp/test')).rejects.toThrow(/Invalid deeplink protocol: file/);
    expect(executeDeeplinkCommand).not.toHaveBeenCalled();
  });

  it('should reject malformed URLs', async () => {
    await expect(triggerDeeplink('')).rejects.toThrow(/Invalid deeplink URL/);
    await expect(triggerDeeplink('not a url')).rejects.toThrow(/Invalid deeplink URL/);
  });

  it('should propagate spawn failures from native-core', async () => {
    vi.mocked(executeDeeplinkCommand).mockRejectedValueOnce(new Error('ENOENT'));

    await expect(triggerDeeplink('myapp://test')).rejects.toThrow(/ENOENT/);
  });
});
