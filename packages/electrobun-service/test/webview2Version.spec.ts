import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({ existsSync: vi.fn(), readdirSync: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: fsMocks.existsSync, readdirSync: fsMocks.readdirSync }));
vi.mock('@wdio/native-utils', () => ({
  createLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { detectWebView2RuntimeVersion } from '../src/webview2Version.js';

describe('detectWebView2RuntimeVersion', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // Only ProgramFiles(x86) set, so the test is independent of the host OS's real env.
    process.env = { ...originalEnv, 'ProgramFiles(x86)': 'C:\\Program Files (x86)' };
    delete process.env.ProgramFiles;
    delete process.env.LOCALAPPDATA;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns the newest version dir that holds msedgewebview2.exe', () => {
    fsMocks.existsSync.mockImplementation((p: string) => p.includes('EdgeWebView'));
    fsMocks.readdirSync.mockReturnValue(['148.0.3967.83', '149.0.4000.1', 'not-a-version', 'BHO']);

    // Newest by numeric compare, ignoring the non-version entries.
    expect(detectWebView2RuntimeVersion()).toBe('149.0.4000.1');
  });

  it('ignores a version dir without msedgewebview2.exe', () => {
    fsMocks.existsSync.mockImplementation((p: string) => {
      if (p.endsWith('Application')) {
        return true;
      }
      if (p.includes('149.0.4000.1')) {
        return false; // newer dir present but missing the runtime exe
      }
      return p.endsWith('msedgewebview2.exe');
    });
    fsMocks.readdirSync.mockReturnValue(['148.0.3967.83', '149.0.4000.1']);

    expect(detectWebView2RuntimeVersion()).toBe('148.0.3967.83');
  });

  it('returns undefined when the runtime is not installed', () => {
    fsMocks.existsSync.mockReturnValue(false);

    expect(detectWebView2RuntimeVersion()).toBeUndefined();
  });

  it('returns undefined when no base paths are set (e.g. non-Windows)', () => {
    process.env = { ...originalEnv };
    delete process.env['ProgramFiles(x86)'];
    delete process.env.ProgramFiles;
    delete process.env.LOCALAPPDATA;
    fsMocks.existsSync.mockReturnValue(true);

    expect(detectWebView2RuntimeVersion()).toBeUndefined();
    expect(fsMocks.existsSync).not.toHaveBeenCalled();
  });
});
