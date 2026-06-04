import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

describe('Electrobun Execute - Advanced Patterns', () => {
  it('should pass multiple parameters to an execute function', async () => {
    const result = await browser.electrobun.execute((_eb, a, b, c) => a + b + c, 10, 20, 30);
    expect(result).toBe(60);
  });

  it('should handle destructured parameters', async () => {
    const result = await browser.electrobun.execute((_eb, { name, value }) => `${name}: ${value}`, {
      name: 'test',
      value: 42,
    });
    expect(result).toBe('test: 42');
  });

  it('should execute an async function returning an object', async () => {
    const result = await browser.electrobun.execute(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true, count: 3 };
    });
    expect(result?.ok).toBe(true);
    expect(result?.count).toBe(3);
  });

  it('should handle functions with inner function declarations', async () => {
    // String form avoids esbuild __name transpilation reaching the page.
    const result = await browser.electrobun.execute(`(() => {
      function helper(x) { return x * 2; }
      return helper(21);
    })()`);
    expect(result).toBe(42);
  });

  it('should handle functions with inner arrow functions', async () => {
    const result = await browser.electrobun.execute(`(() => {
      const helper = (x) => x * 2;
      return helper(21);
    })()`);
    expect(result).toBe(42);
  });

  it('should propagate synchronous errors from an execute function', async () => {
    await expect(
      browser.electrobun.execute(() => {
        throw new Error('Test error from execute');
      }),
    ).rejects.toThrow('Test error from execute');
  });

  it('should propagate promise rejections from an execute function', async () => {
    await expect(
      browser.electrobun.execute(async () => {
        return await Promise.reject(new Error('Async error'));
      }),
    ).rejects.toThrow('Async error');
  });

  it('should reject when inlining a non-serialisable argument', async () => {
    await expect(
      browser.electrobun.execute(
        (_eb, fn) => fn,
        () => 1,
      ),
    ).rejects.toThrow(/JSON-serialisable/);
  });
});
