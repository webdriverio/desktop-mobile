import { beforeAll, describe, expect, it } from 'vitest';

describe('@wdio/native-cdp-bridge public exports', () => {
  // Cold-importing the whole module graph can exceed the default 5s on slow CI; do it once here
  // with a longer hook timeout so the export assertions below stay at the default.
  let mod: typeof import('../src/index.js');
  beforeAll(async () => {
    mod = await import('../src/index.js');
  }, 20000);

  it('should default the debugger port to the CDP convention (9222)', () => {
    expect(mod.DEFAULT_PORT).toBe(9222);
  });

  it('should expose the single- and multi-target bridge classes plus primitives', () => {
    expect(mod.CdpBridge).toBeTypeOf('function');
    expect(mod.MultiTargetCdpBridge).toBeTypeOf('function');
    expect(mod.Connection).toBeTypeOf('function');
    expect(mod.DevTool).toBeTypeOf('function');
    expect(mod.TargetRegistry).toBeTypeOf('function');
  });

  it('should expose the bridge error messages', () => {
    expect(mod.ERROR_MESSAGE.NO_PAGE_TARGETS).toBeTypeOf('string');
    expect(mod.ERROR_MESSAGE.TARGET_NOT_FOUND).toBeTypeOf('string');
    expect(mod.ERROR_MESSAGE.NOT_CONNECTED).toContain('connect()');
  });
});
