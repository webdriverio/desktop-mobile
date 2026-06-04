import { describe, expect, it } from 'vitest';

describe('@wdio/cdp-bridge public exports', () => {
  it('should default the debugger port to the CDP convention (9222)', async () => {
    const { DEFAULT_PORT } = await import('../src/index.js');
    expect(DEFAULT_PORT).toBe(9222);
  });

  it('should expose the single- and multi-target bridge classes plus primitives', async () => {
    const mod = await import('../src/index.js');
    expect(mod.CdpBridge).toBeTypeOf('function');
    expect(mod.MultiTargetCdpBridge).toBeTypeOf('function');
    expect(mod.Connection).toBeTypeOf('function');
    expect(mod.DevTool).toBeTypeOf('function');
    expect(mod.TargetRegistry).toBeTypeOf('function');
  });

  it('should expose the bridge error messages', async () => {
    const { ERROR_MESSAGE } = await import('../src/index.js');
    expect(ERROR_MESSAGE.NO_PAGE_TARGETS).toBeTypeOf('string');
    expect(ERROR_MESSAGE.TARGET_NOT_FOUND).toBeTypeOf('string');
    expect(ERROR_MESSAGE.NOT_CONNECTED).toContain('connect()');
  });
});
