import { describe, expect, it, vi } from 'vitest';
import { resolveAppBinaryPath } from '../src/appBinaryResolver.js';

vi.mock('@wdio/native-utils', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('resolveAppBinaryPath', () => {
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
});
