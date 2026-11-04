import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

describe('Tauri Execute - Advanced Patterns', () => {
  it('should pass multiple parameters to execute function', async () => {
    const result = await browser.tauri.execute((_tauri, a, b, c) => a + b + c, 10, 20, 30);
    expect(result).toBe(60);
  });

  it('should handle destructured parameters', async () => {
    const result = await browser.tauri.execute((_tauri, { name, value }) => `${name}: ${value}`, {
      name: 'test',
      value: 42,
    });
    expect(result).toBe('test: 42');
  });

  it('should execute async function with multiple Tauri commands', async () => {
    const result = await browser.tauri.execute(async ({ core }) => {
      const info1 = (await core.invoke('get_platform_info')) as { os: string };
      const info2 = (await core.invoke('get_platform_info')) as { os: string };
      return { os: info1.os, same: info1.os === info2.os };
    });
    expect(result?.same).toBe(true);
    expect(result?.os).toBeTruthy();
  });

  it('should handle functions with inner function declarations', async () => {
    // Note: Using string form to avoid TypeScript/esbuild __name transpilation issues
    const result = await browser.tauri.execute(`(tauri) => {
      function helper(x) { return x * 2; }
      return helper(21);
    }`);
    expect(result).toBe(42);
  });

  it('should handle functions with inner arrow functions', async () => {
    // Note: Using string form to avoid TypeScript/esbuild __name transpilation issues
    const result = await browser.tauri.execute(`(tauri) => {
      const helper = (x) => x * 2;
      return helper(21);
    }`);
    expect(result).toBe(42);
  });

  it('should propagate errors from execute function', async () => {
    await expect(
      browser.tauri.execute(() => {
        throw new Error('Test error from execute');
      }),
    ).rejects.toThrow('Test error from execute');
  });

  it('should handle promise rejections in execute', async () => {
    await expect(
      browser.tauri.execute(async () => {
        return await Promise.reject(new Error('Async error'));
      }),
    ).rejects.toThrow('Async error');
  });

  it('should provide clear error for invalid Tauri commands', async () => {
    await expect(browser.tauri.execute(({ core }) => core.invoke('nonexistent_command'))).rejects.toThrow();
  });
});
