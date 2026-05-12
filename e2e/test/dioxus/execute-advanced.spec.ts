import { browser, expect } from '@wdio/globals';

describe('Dioxus execute — advanced', () => {
  it('should execute expression string', async () => {
    expect(await browser.dioxus.execute('return 1 + 2 + 3')).toBe(6);
  });

  it('should execute multi-statement string', async () => {
    const r = await browser.dioxus.execute(`
      const x = 10;
      const y = 20;
      return x + y;
    `);
    expect(r).toBe(30);
  });

  it('should receive dioxus APIs even with no user args', async () => {
    const r = await browser.dioxus.execute((dx) => ({ hasInvoke: typeof dx?.invoke === 'function' }));
    expect(r.hasInvoke).toBe(true);
  });

  it('should forward multiple user args', async () => {
    const r = await browser.dioxus.execute((_dx, a, b, c) => [a, b, c], 'x', 'y', 'z');
    expect(r).toEqual(['x', 'y', 'z']);
  });

  it('should handle null / undefined return', async () => {
    expect(await browser.dioxus.execute('return null')).toBeNull();
  });

  it('should throw for bridge errors surfaced in functions', async () => {
    await expect(
      browser.dioxus.execute((_dx, msg) => {
        throw new Error(msg as string);
      }, 'test-error'),
    ).rejects.toThrow('test-error');
  });
});
