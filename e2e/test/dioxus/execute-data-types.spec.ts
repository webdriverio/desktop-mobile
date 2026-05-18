import { browser, expect } from '@wdio/globals';

describe('Dioxus execute — data types', () => {
  it('should round-trip a number', async () => {
    expect(await browser.dioxus.execute('return 3.14')).toBeCloseTo(3.14);
  });

  it('should round-trip a boolean', async () => {
    expect(await browser.dioxus.execute('return true')).toBe(true);
  });

  it('should round-trip a string', async () => {
    expect(await browser.dioxus.execute('return "hello"')).toBe('hello');
  });

  it('should round-trip an array', async () => {
    expect(await browser.dioxus.execute('return [1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('should round-trip a nested object', async () => {
    const r = await browser.dioxus.execute('return { a: 1, b: { c: true } }');
    expect(r).toEqual({ a: 1, b: { c: true } });
  });

  it('should pass an object argument', async () => {
    const r = await browser.dioxus.execute((_dx, obj) => (obj as { x: number }).x * 2, { x: 21 });
    expect(r).toBe(42);
  });
});
