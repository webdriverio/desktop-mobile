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
  it('should export default as TauriWorkerService', async () => {
    const mod = await import('../src/index.js');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('should export launcher as named export', async () => {
    const mod = await import('../src/index.js');
    expect(mod.launcher).toBeDefined();
    expect(typeof mod.launcher).toBe('function');
  });

  it('should export createTauriCapabilities', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.createTauriCapabilities).toBe('function');
  });

  it('should export startWdioSession (init)', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.startWdioSession).toBe('function');
  });

  it('should export cleanupWdioSession (cleanup)', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.cleanupWdioSession).toBe('function');
  });

  it('should export browser', async () => {
    const mod = await import('../src/index.js');
    expect(mod.browser).toBeDefined();
  });
});
