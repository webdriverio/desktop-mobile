import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

describe('React Native API', () => {
  it('should expose the browser.reactNative surface', () => {
    expect(browser.reactNative).toBeDefined();
    expect(typeof browser.reactNative.execute).toBe('function');
    expect(typeof browser.reactNative.mock).toBe('function');
  });

  it('should execute a basic expression', async () => {
    const result = await browser.reactNative.execute('1 + 2 + 3');
    expect(result).toBe(6);
  });

  it('should execute a function with the surface and args', async () => {
    const result = await browser.reactNative.execute((_rn, a: number, b: number) => a + b, 2, 3);
    expect(result).toBe(5);
  });

  it('should report isMockFunction false for a non-mocked target', () => {
    expect(browser.reactNative.isMockFunction('not.a.mock')).toBe(false);
  });
});
