import { describe, expect, it, vi } from 'vitest';

import { discoverVmServiceUrl, portFromUrl, toWebSocketUrl } from '../src/vmServiceDiscovery.js';

const browserWithLogs = (logs: Array<{ message?: string }>) =>
  ({ getLogs: vi.fn().mockResolvedValue(logs) }) as unknown as WebdriverIO.Browser;

describe('toWebSocketUrl', () => {
  it('should convert a Dart VM Service HTTP URL to its WS endpoint', () => {
    expect(toWebSocketUrl('http://127.0.0.1:1234/abc/')).toBe('ws://127.0.0.1:1234/abc/ws');
  });
});

describe('portFromUrl', () => {
  it('should extract the port', () => {
    expect(portFromUrl('http://127.0.0.1:1234/abc/')).toBe(1234);
  });
  it('should be undefined when there is no port', () => {
    expect(portFromUrl('http://host/')).toBeUndefined();
  });
});

describe('discoverVmServiceUrl', () => {
  it('should scrape the URL and forward the port on Android', async () => {
    const adbForward = vi.fn().mockResolvedValue(undefined);
    const url = await discoverVmServiceUrl(
      browserWithLogs([{ message: 'The Dart VM service is listening on http://127.0.0.1:5555/tok/' }]),
      { platform: 'android', adbForward },
    );
    expect(url).toBe('ws://127.0.0.1:5555/tok/ws');
    expect(adbForward).toHaveBeenCalledWith(5555);
  });

  it('should not adb-forward on iOS', async () => {
    const adbForward = vi.fn();
    await discoverVmServiceUrl(
      browserWithLogs([{ message: 'Dart VM service is listening on http://127.0.0.1:5555/tok/' }]),
      { platform: 'ios', adbForward },
    );
    expect(adbForward).not.toHaveBeenCalled();
  });

  it('should retry then throw when the URL never appears', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(discoverVmServiceUrl(browserWithLogs([]), { platform: 'android', retries: 3, sleep })).rejects.toThrow(
      /not found/,
    );
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
