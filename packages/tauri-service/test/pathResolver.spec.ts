import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWebKitWebDriverPath } from '../src/pathResolver.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('@wdio/native-utils', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('getWebKitWebDriverPath', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.restoreAllMocks();
  });

  it('should return undefined on non-Linux platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    expect(getWebKitWebDriverPath()).toBeUndefined();
  });

  it('should find WebKitWebDriver in PATH on linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue('/usr/bin/WebKitWebDriver\n');
    vi.mocked(existsSync).mockImplementation((path) => {
      return path.toString() === '/usr/bin/WebKitWebDriver';
    });

    expect(getWebKitWebDriverPath()).toBe('/usr/bin/WebKitWebDriver');
  });

  it('should check fallback paths on linux when not in PATH', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found');
    });
    vi.mocked(existsSync).mockImplementation((path) => {
      return path.toString() === '/usr/lib/webkit2gtk-4.1/WebKitWebDriver';
    });

    expect(getWebKitWebDriverPath()).toBe('/usr/lib/webkit2gtk-4.1/WebKitWebDriver');
  });

  it('should return undefined on linux when WebKitWebDriver is not found anywhere', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found');
    });
    vi.mocked(existsSync).mockReturnValue(false);

    expect(getWebKitWebDriverPath()).toBeUndefined();
  });
});
