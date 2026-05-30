import { describe, expect, it } from 'vitest';

describe('@wdio/electrobun-cdp-bridge public exports', () => {
  it("should default the debugger port to CEF's 9222", async () => {
    const { DEFAULT_PORT } = await import('../src/index.js');
    expect(DEFAULT_PORT).toBe(9222);
  });

  it('should expose the CEF auto-select port range (9222-9232)', async () => {
    const { DEFAULT_PORT_RANGE_START, DEFAULT_PORT_RANGE_END } = await import('../src/index.js');
    expect(DEFAULT_PORT_RANGE_START).toBe(9222);
    expect(DEFAULT_PORT_RANGE_END).toBe(9232);
    expect(DEFAULT_PORT_RANGE_END).toBeGreaterThan(DEFAULT_PORT_RANGE_START);
  });

  it('should expose the bridge error messages', async () => {
    const { ERROR_MESSAGE } = await import('../src/index.js');
    expect(ERROR_MESSAGE.NO_PAGE_TARGETS).toBeTypeOf('string');
    expect(ERROR_MESSAGE.TARGET_NOT_FOUND).toBeTypeOf('string');
    expect(ERROR_MESSAGE.NOT_CONNECTED).toContain('CdpBridge.connect()');
  });
});
