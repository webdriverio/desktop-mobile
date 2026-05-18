import { browser, expect } from '@wdio/globals';

describe('Dioxus API', () => {
  it('should execute a string script', async () => {
    const result = await browser.dioxus.execute('return 42');
    expect(result).toBe(42);
  });

  it('should execute a function with dioxus APIs', async () => {
    const result = await browser.dioxus.execute((dx) => ({
      hasInvoke: typeof dx?.invoke === 'function',
    }));
    expect(result.hasInvoke).toBe(true);
  });

  it('should invoke a registered bridge command', async () => {
    const result = await browser.dioxus.execute(({ invoke }) => invoke('get_platform_info'));
    expect(result).toHaveProperty('os');
    expect(result).toHaveProperty('arch');
  });

  it('should pass arguments to a function script', async () => {
    const result = await browser.dioxus.execute((_dx, a, b) => ({ sum: (a as number) + (b as number) }), 3, 4);
    expect(result.sum).toBe(7);
  });

  it('should handle invoke errors gracefully', async () => {
    await expect(browser.dioxus.execute(({ invoke }) => invoke('no_such_command'))).rejects.toThrow();
  });
});
