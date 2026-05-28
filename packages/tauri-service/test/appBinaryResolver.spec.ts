import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  statSync: vi.fn(),
}));

vi.mock('@wdio/native-utils', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { statSync } from 'node:fs';
import { resolveAppBinaryPath } from '../src/appBinaryResolver.js';

const stat = (overrides: { isDirectory?: boolean; isFile?: boolean }) =>
  ({
    isDirectory: () => overrides.isDirectory ?? false,
    isFile: () => overrides.isFile ?? false,
  }) as unknown as ReturnType<typeof statSync>;

describe('resolveAppBinaryPath', () => {
  beforeEach(() => {
    // Default: assume the path doesn't exist on disk — matches the common
    // case where the user supplies a config string the launcher trusts and
    // hands to spawn. The migration guard only fires for existing dirs.
    vi.mocked(statSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should use tauri:options.application when set', () => {
    const result = resolveAppBinaryPath({}, { application: 'target/release/my-app' });
    expect(result).toBe('target/release/my-app');
  });

  it('should use service-level appBinaryPath when capability application is absent', () => {
    const result = resolveAppBinaryPath({ appBinaryPath: 'target/release/my-app' }, undefined);
    expect(result).toBe('target/release/my-app');
  });

  it('should use service-level appBinaryPath when capability application is empty', () => {
    const result = resolveAppBinaryPath({ appBinaryPath: 'target/release/my-app' }, { application: '' });
    expect(result).toBe('target/release/my-app');
  });

  it('should prefer tauri:options.application over service-level appBinaryPath', () => {
    const result = resolveAppBinaryPath({ appBinaryPath: 'unused/path' }, { application: 'target/release/my-app' });
    expect(result).toBe('target/release/my-app');
  });

  it('should throw when neither tauri:options.application nor appBinaryPath is set', () => {
    expect(() => resolveAppBinaryPath({}, undefined)).toThrow(/Tauri application path not specified/);
  });

  it('should throw when both are empty strings', () => {
    expect(() => resolveAppBinaryPath({ appBinaryPath: '' }, { application: '' })).toThrow(
      /Tauri application path not specified/,
    );
  });

  it('should throw a migration error when tauri:options.application points to an existing directory', () => {
    vi.mocked(statSync).mockReturnValue(stat({ isDirectory: true }));
    expect(() => resolveAppBinaryPath({}, { application: './my-project' })).toThrow(
      /path is a directory, not a binary/,
    );
  });

  it('should throw a migration error when appBinaryPath points to an existing directory', () => {
    vi.mocked(statSync).mockReturnValue(stat({ isDirectory: true }));
    expect(() => resolveAppBinaryPath({ appBinaryPath: './my-project' }, undefined)).toThrow(
      /path is a directory, not a binary/,
    );
  });

  it('should allow a .app bundle directory (macOS launch target)', () => {
    vi.mocked(statSync).mockReturnValue(stat({ isDirectory: true }));
    const result = resolveAppBinaryPath({}, { application: 'target/release/bundle/macos/My App.app' });
    expect(result).toBe('target/release/bundle/macos/My App.app');
  });
});
