import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

describe('Electrobun Execute - Data Types', () => {
  it('should return complex nested objects', async () => {
    const result = await browser.electrobun.execute(() => ({
      nested: {
        array: [1, 2, 3],
        object: { key: 'value' },
        null: null,
        boolean: true,
        number: 42,
        string: 'test',
      },
    }));
    expect(result?.nested.array).toEqual([1, 2, 3]);
    expect(result?.nested.object.key).toBe('value');
    expect(result?.nested.null).toBeNull();
    expect(result?.nested.boolean).toBe(true);
    expect(result?.nested.number).toBe(42);
    expect(result?.nested.string).toBe('test');
  });

  it('should return arrays correctly', async () => {
    const result = await browser.electrobun.execute(() => ['a', 'b', 'c']);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(result?.[0]).toBe('a');
  });

  it('should return primitive values', async () => {
    expect(await browser.electrobun.execute(() => 'a string')).toBe('a string');
    expect(await browser.electrobun.execute(() => 123)).toBe(123);
    expect(await browser.electrobun.execute(() => true)).toBe(true);
    expect(await browser.electrobun.execute(() => null)).toBeNull();
  });

  it('should handle large return values', async () => {
    const result = await browser.electrobun.execute(() => {
      const large = [];
      for (let i = 0; i < 1000; i++) {
        large.push({ id: i, value: `item-${i}` });
      }
      return large;
    });
    expect(result).toHaveLength(1000);
    expect(result?.[0]?.id).toBe(0);
    expect(result?.[999]?.id).toBe(999);
    expect(result?.[999]?.value).toBe('item-999');
  });

  it('should round-trip arguments through JSON inlining', async () => {
    const result = await browser.electrobun.execute((_eb, payload) => payload, {
      items: [1, 2, 3],
      meta: { ok: true },
    });
    expect(result).toEqual({ items: [1, 2, 3], meta: { ok: true } });
  });
});
