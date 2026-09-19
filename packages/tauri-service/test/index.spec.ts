import { beforeAll, describe, expect, it, vi } from 'vitest';

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
  // Cold-importing the whole module graph can exceed the default 5s on slow CI; do it once here
  // with a longer hook timeout so the export assertions below stay at the default.
  let mod: typeof import('../src/index.js');
  beforeAll(async () => {
    mod = await import('../src/index.js');
  }, 20000);

  it('should export default as TauriWorkerService', () => {
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('should export launcher as named export', () => {
    expect(mod.launcher).toBeDefined();
    expect(typeof mod.launcher).toBe('function');
  });

  it('should export createTauriCapabilities', () => {
    expect(typeof mod.createTauriCapabilities).toBe('function');
  });

  it('should export startWdioSession (init)', () => {
    expect(typeof mod.startWdioSession).toBe('function');
  });

  it('should export cleanupWdioSession (cleanup)', () => {
    expect(typeof mod.cleanupWdioSession).toBe('function');
  });

  it('should export withExecuteOptions', () => {
    expect(typeof mod.withExecuteOptions).toBe('function');
  });

  it('should export browser', () => {
    expect(mod.browser).toBeDefined();
  });
});
