import { expect } from '@wdio/globals';
import '@wdio/native-types';

describe('Dioxus service package smoke', () => {
  afterEach(async () => {
    await browser.dioxus.restoreAllMocks();
  });

  it('should have dioxus service available', async () => {
    expect(browser.dioxus).toBeDefined();
    expect(typeof browser.dioxus.execute).toBe('function');
    expect(typeof browser.dioxus.mock).toBe('function');
  });

  it('should execute a bridge command', async () => {
    const result = await browser.dioxus.execute(({ invoke }) => invoke('get_platform_info'));
    expect(result).toBeDefined();
    expect(result).toHaveProperty('os');
    expect(result).toHaveProperty('arch');
  });

  it('should mock a bridge command', async () => {
    const mock = await browser.dioxus.mock('get_platform_info');
    await mock.mockResolvedValue({ os: 'mock-os', arch: 'mock-arch' });
    const result = await browser.dioxus.execute(({ invoke }) => invoke('get_platform_info'));
    expect(result).toEqual({ os: 'mock-os', arch: 'mock-arch' });
  });
});
