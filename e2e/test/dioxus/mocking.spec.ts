import { browser, expect } from '@wdio/globals';

describe('Dioxus mocking', () => {
  afterEach(async () => {
    await browser.dioxus.restoreAllMocks();
  });

  it('should mock a bridge command', async () => {
    const mock = await browser.dioxus.mock('get_platform_info');
    await mock.mockReturnValue({ os: 'mock-os', arch: 'mock-arch' });

    const result = await browser.dioxus.execute(({ invoke }) => invoke('get_platform_info'));
    await mock.update();
    expect(result).toEqual({ os: 'mock-os', arch: 'mock-arch' });
    expect(mock.mock.calls.length).toBeGreaterThan(0);
  });

  it('should report isMockFunction', async () => {
    await browser.dioxus.mock('get_platform_info');
    expect(browser.dioxus.isMockFunction('get_platform_info')).toBe(true);
    expect(browser.dioxus.isMockFunction('no_such')).toBe(false);
  });

  it('should clearAllMocks without restoring', async () => {
    const mock = await browser.dioxus.mock('get_platform_info');
    await mock.mockReturnValue({ os: 'x' });
    await browser.dioxus.execute(({ invoke }) => invoke('get_platform_info'));
    await mock.update();
    await browser.dioxus.clearAllMocks();
    await mock.update();
    expect(mock.mock.calls.length).toBe(0);
  });

  it('should resetAllMocks', async () => {
    const mock = await browser.dioxus.mock('get_platform_info');
    await mock.mockReturnValue({ os: 'overridden' });
    await browser.dioxus.resetAllMocks();
    // After reset the mock function has no implementation (vitest mockReset
    // semantics) — the proxy still intercepts calls but returns undefined/null.
    const result = await browser.dioxus.execute(({ invoke }) => invoke('get_platform_info'));
    const r = result as { os: string } | null | undefined;
    expect(r?.os).not.toBe('overridden');
  });

  it('should use the withImplementation implementation until an async callback settles', async () => {
    const mock = await browser.dioxus.mock('get_platform_info');
    await mock.mockReturnValue({ os: 'default' });

    const result = await mock.withImplementation(
      () => ({ os: 'temporary' }),
      async ({ invoke }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return invoke('get_platform_info');
      },
    );

    expect(result).toEqual({ os: 'temporary' });
    expect(mock.mock.calls).toHaveLength(1);
    const after = await browser.dioxus.execute(({ invoke }) => invoke('get_platform_info'));
    expect(after).toEqual({ os: 'default' });
  });

  it('should reject withImplementation with a plain error once the command is no longer mocked', async () => {
    const mock = await browser.dioxus.mock('get_platform_info');
    await mock.mockRestore();

    await expect(
      mock.withImplementation(
        () => ({ os: 'temporary' }),
        () => undefined,
      ),
    ).rejects.toThrow(/^get_platform_info is not mocked in this window$/);
  });
});
