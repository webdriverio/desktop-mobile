import { coldImport } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@wdio/native-utils', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@wdio/globals', () => ({
  browser: {},
}));

describe('Tauri Service package exports', () => {
  const mod = coldImport(() => import('../src/index.js'));

  it('should export default as TauriWorkerService', () => {
    expect(mod().default).toBeDefined();
    expect(typeof mod().default).toBe('function');
  });

  it('should export launcher as named export', () => {
    expect(mod().launcher).toBeDefined();
    expect(typeof mod().launcher).toBe('function');
  });

  it('should export createTauriCapabilities', () => {
    expect(typeof mod().createTauriCapabilities).toBe('function');
  });

  it('should export startWdioSession (init)', () => {
    expect(typeof mod().startWdioSession).toBe('function');
  });

  it('should export cleanupWdioSession (cleanup)', () => {
    expect(typeof mod().cleanupWdioSession).toBe('function');
  });

  it('should export withExecuteOptions', () => {
    expect(typeof mod().withExecuteOptions).toBe('function');
  });

  it('should export browser', () => {
    expect(mod().browser).toBeDefined();
  });
});
