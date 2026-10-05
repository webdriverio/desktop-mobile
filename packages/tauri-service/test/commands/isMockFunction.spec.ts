/// <reference types="../../@types/vitest" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMockFunction } from '../../src/commands/mock.js';
import { createMock } from '../../src/mock.js';
import { clearWindowState } from '../../src/window.js';

describe('isMockFunction Command', () => {
  beforeEach(async () => {
    clearWindowState();
    globalThis.browser = {
      tauri: {
        execute: vi.fn(),
      },
      execute: vi.fn().mockResolvedValue(true),
      options: {},
    } as unknown as WebdriverIO.Browser;
    // createMock calls execute() which uses the embedded path (fetch) by default
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ value: null }),
      }),
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it('should return true for a Tauri mock', async () => {
    const mockFn = await createMock('get_platform_info');
    expect(isMockFunction(mockFn)).toBe(true);
  });

  it('should return false for a non-mock function', () => {
    const regularFn = () => {};
    expect(isMockFunction(regularFn)).toBe(false);
  });

  it('should return false for non-function values', () => {
    expect(isMockFunction(null)).toBe(false);
    expect(isMockFunction(undefined)).toBe(false);
    expect(isMockFunction({})).toBe(false);
    expect(isMockFunction('string')).toBe(false);
    expect(isMockFunction(42)).toBe(false);
  });

  it('should return false for a function without __isTauriMock property', () => {
    const fn = () => {};
    expect(isMockFunction(fn)).toBe(false);
  });

  it('should return false for a function with __isTauriMock set to false', () => {
    const fn = (() => {}) as any;
    fn.__isTauriMock = false;
    expect(isMockFunction(fn)).toBe(false);
  });
});
