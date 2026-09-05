import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getWebKitWebDriverPath, waitForWebKitWebDriverReady, webKitWebDriverArgs } from '../src/webkitDriver.js';

vi.mock('node:child_process', () => ({ execSync: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn() }));

const mockedExecSync = vi.mocked(execSync);
const mockedExistsSync = vi.mocked(existsSync);

describe('getWebKitWebDriverPath', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return undefined on non-Linux platforms without probing', () => {
    expect(getWebKitWebDriverPath('darwin')).toBeUndefined();
    expect(getWebKitWebDriverPath('win32')).toBeUndefined();
    expect(mockedExecSync).not.toHaveBeenCalled();
  });

  it('should return the PATH match from `which` when it exists', () => {
    mockedExecSync.mockReturnValue('/usr/bin/WebKitWebDriver\n');
    mockedExistsSync.mockImplementation((p) => p === '/usr/bin/WebKitWebDriver');
    expect(getWebKitWebDriverPath('linux')).toBe('/usr/bin/WebKitWebDriver');
  });

  it('should fall back to common paths when not on PATH', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockedExistsSync.mockImplementation((p) => p === '/usr/lib/webkit2gtk-4.1/WebKitWebDriver');
    expect(getWebKitWebDriverPath('linux')).toBe('/usr/lib/webkit2gtk-4.1/WebKitWebDriver');
  });

  it('should return undefined when WebKitWebDriver is not found anywhere', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockedExistsSync.mockReturnValue(false);
    expect(getWebKitWebDriverPath('linux')).toBeUndefined();
  });
});

describe('webKitWebDriverArgs', () => {
  it('should use equals-form flags (space-form makes WebKitWebDriver print usage and exit)', () => {
    expect(webKitWebDriverArgs('127.0.0.1', 4444)).toEqual(['--host=127.0.0.1', '--port=4444']);
  });
});

describe('waitForWebKitWebDriverReady', () => {
  it('should resolve once /status returns a value', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: { ready: true, message: 'ok' } }),
    }) as unknown as typeof fetch;
    await expect(waitForWebKitWebDriverReady('127.0.0.1', 4444, 1000, fetchImpl)).resolves.toBeUndefined();
  });

  it('should throw when /status never becomes ready within the timeout', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(waitForWebKitWebDriverReady('127.0.0.1', 4444, 10, fetchImpl)).rejects.toThrow(/did not become ready/);
  });
});
