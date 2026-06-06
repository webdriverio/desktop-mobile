import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

type Greeter = { greet(name: string): string };

describe('React Native execute', () => {
  it('should execute a statement-style script with a return', async () => {
    expect(await browser.reactNative.execute('return 7 * 6')).toBe(42);
  });

  it('should call a function exposed on globalThis', async () => {
    const result = await browser.reactNative.execute(() => (globalThis as unknown as Greeter).greet('RN'));
    expect(result).toBe('Hello, RN!');
  });

  it('should round-trip JSON data types', async () => {
    const result = await browser.reactNative.execute(() => ({
      n: 1,
      s: 'x',
      b: true,
      arr: [1, 2, 3],
      obj: { k: 'v' },
    }));
    expect(result).toEqual({ n: 1, s: 'x', b: true, arr: [1, 2, 3], obj: { k: 'v' } });
  });

  it('should surface a thrown error as a rejection', async () => {
    await expect(
      browser.reactNative.execute(() => {
        throw new Error('boom-from-hermes');
      }),
    ).rejects.toThrow(/boom-from-hermes/);
  });
});
