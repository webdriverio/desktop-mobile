import type { Stats } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  statSync: vi.fn(),
}));

vi.mock('../src/pathResolver.js', () => ({
  getTauriBinaryPath: vi.fn(),
}));

const fakeStats = (overrides: { isFile?: boolean; isDirectory?: boolean }): Stats =>
  ({
    isFile: () => overrides.isFile ?? false,
    isDirectory: () => overrides.isDirectory ?? false,
  }) as Stats;

describe('looksLikeBuiltBinary', () => {
  let looksLikeBuiltBinary: typeof import('../src/appBinaryResolver.js').looksLikeBuiltBinary;
  let statSync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    ({ looksLikeBuiltBinary } = await import('../src/appBinaryResolver.js'));
    ({ statSync } = (await import('node:fs')) as unknown as { statSync: ReturnType<typeof vi.fn> });
    statSync.mockReset();
  });

  it('should return true for an existing regular file', () => {
    statSync.mockReturnValue(fakeStats({ isFile: true }));
    expect(looksLikeBuiltBinary('target/release/my-app', 'linux')).toBe(true);
  });

  it('should return true for an existing .app bundle on darwin', () => {
    statSync.mockReturnValue(fakeStats({ isDirectory: true }));
    expect(looksLikeBuiltBinary('target/release/bundle/macos/My App.app', 'darwin')).toBe(true);
  });

  it('should return false for a .app directory on a non-darwin platform', () => {
    statSync.mockReturnValue(fakeStats({ isDirectory: true }));
    expect(looksLikeBuiltBinary('target/release/My App.app', 'linux')).toBe(false);
  });

  it('should return false for a directory that is not a .app bundle', () => {
    statSync.mockReturnValue(fakeStats({ isDirectory: true }));
    expect(looksLikeBuiltBinary('src-tauri', 'darwin')).toBe(false);
  });

  it('should return false when the path does not exist', () => {
    statSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(looksLikeBuiltBinary('does/not/exist', 'linux')).toBe(false);
  });
});

describe('resolveAppBinaryPath', () => {
  let resolveAppBinaryPath: typeof import('../src/appBinaryResolver.js').resolveAppBinaryPath;
  let statSync: ReturnType<typeof vi.fn>;
  let getTauriBinaryPath: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    ({ resolveAppBinaryPath } = await import('../src/appBinaryResolver.js'));
    ({ statSync } = (await import('node:fs')) as unknown as { statSync: ReturnType<typeof vi.fn> });
    ({ getTauriBinaryPath } = (await import('../src/pathResolver.js')) as unknown as {
      getTauriBinaryPath: ReturnType<typeof vi.fn>;
    });
    statSync.mockReset();
    getTauriBinaryPath.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should trust tauri:options.application when it points at an existing file', async () => {
    statSync.mockReturnValue(fakeStats({ isFile: true }));
    const result = await resolveAppBinaryPath({}, { application: 'target/release/my-app' });
    expect(result).toBe('target/release/my-app');
    expect(getTauriBinaryPath).not.toHaveBeenCalled();
  });

  it('should fall back to getTauriBinaryPath when tauri:options.application is not a built artefact', async () => {
    statSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    getTauriBinaryPath.mockResolvedValue('resolved/binary/path');
    const result = await resolveAppBinaryPath({}, { application: 'src-tauri' });
    expect(result).toBe('resolved/binary/path');
    expect(getTauriBinaryPath).toHaveBeenCalledWith('src-tauri');
  });

  it('should use service-level appBinaryPath when capability application is absent', async () => {
    const result = await resolveAppBinaryPath({ appBinaryPath: 'target/release/my-app' }, undefined);
    expect(result).toBe('target/release/my-app');
    expect(getTauriBinaryPath).not.toHaveBeenCalled();
  });

  it('should prefer tauri:options.application over service-level appBinaryPath', async () => {
    statSync.mockReturnValue(fakeStats({ isFile: true }));
    const result = await resolveAppBinaryPath(
      { appBinaryPath: 'unused/path' },
      { application: 'target/release/my-app' },
    );
    expect(result).toBe('target/release/my-app');
  });

  it('should throw when neither tauri:options.application nor appBinaryPath is set', async () => {
    await expect(resolveAppBinaryPath({}, undefined)).rejects.toThrow(/Tauri application path not specified/);
  });
});
