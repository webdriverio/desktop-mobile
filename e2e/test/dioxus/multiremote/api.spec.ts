import { expect, multiRemoteBrowser } from '@wdio/globals';

describe('Dioxus multiremote API', () => {
  it('should execute in both instances', async () => {
    const multi = multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
    const [a, b] = await Promise.all([
      multi.getInstance('browserA').dioxus.execute('return "A"'),
      multi.getInstance('browserB').dioxus.execute('return "B"'),
    ]);
    expect(a).toBe('A');
    expect(b).toBe('B');
  });

  describe('mocking', () => {
    const instance = (name: string) =>
      (multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser).getInstance(name);

    afterEach(async () => {
      await instance('browserA').dioxus.restoreAllMocks();
      await instance('browserB').dioxus.restoreAllMocks();
    });

    it("should restore one instance's mock without touching the other's", async () => {
      const browserA = instance('browserA');
      const browserB = instance('browserB');
      const mockA = await browserA.dioxus.mock('get_platform_info');
      await mockA.mockReturnValue({ os: 'mock-a' });
      const mockB = await browserB.dioxus.mock('get_platform_info');
      await mockB.mockReturnValue({ os: 'mock-b' });

      await browserA.dioxus.restoreAllMocks();

      const [platformA, platformB] = await Promise.all([
        browserA.dioxus.execute(({ invoke }) => invoke('get_platform_info')),
        browserB.dioxus.execute(({ invoke }) => invoke('get_platform_info')),
      ]);
      expect((platformA as { os: string }).os).not.toBe('mock-a');
      expect(platformB).toEqual({ os: 'mock-b' });
      expect(browserA.dioxus.isMockFunction('get_platform_info')).toBe(false);
      expect(browserB.dioxus.isMockFunction('get_platform_info')).toBe(true);
    });
  });
});
