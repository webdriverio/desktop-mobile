import { expect, multiRemoteBrowser } from '@wdio/globals';
import '@wdio/native-types';

type PlatformInfo = { os: string };

const root = () => multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
const instance = (name: 'browserA' | 'browserB') => root().getInstance(name);

const getPlatformInfo = async (browser: WebdriverIO.Browser) =>
  (await browser.tauri.execute(({ core }) => core.invoke('get_platform_info'))) as PlatformInfo;

const mockBoth = async () => {
  const mockA = await instance('browserA').tauri.mock('get_platform_info');
  await mockA.mockReturnValue({ os: 'mock-a' });
  const mockB = await instance('browserB').tauri.mock('get_platform_info');
  await mockB.mockReturnValue({ os: 'mock-b' });
  return [mockA, mockB] as const;
};

const getBothPlatformInfo = () =>
  Promise.all([getPlatformInfo(instance('browserA')), getPlatformInfo(instance('browserB'))]);

describe('Tauri mocking using Multiremote', () => {
  let realOs: string;

  before(async () => {
    realOs = (await getPlatformInfo(instance('browserA'))).os;
  });

  describe('per-instance mocks', () => {
    afterEach(async () => {
      await root().tauri.restoreAllMocks();
    });

    it('should give each instance its own mock', async () => {
      const [mockA, mockB] = await mockBoth();

      const [platformA, platformB] = await getBothPlatformInfo();
      expect(platformA).toEqual({ os: 'mock-a' });
      expect(platformB).toEqual({ os: 'mock-b' });

      expect(mockA).not.toBe(mockB);
      expect(mockA).toHaveBeenCalledTimes(1);
      expect(mockB).toHaveBeenCalledTimes(1);

      expect(instance('browserA').tauri.isMockFunction('get_platform_info')).toBe(true);
      expect(instance('browserB').tauri.isMockFunction('get_platform_info')).toBe(true);
      expect(root().tauri.isMockFunction('get_platform_info')).toBe(true);
    });

    it("should restore only the calling instance's mocks", async () => {
      await mockBoth();

      await instance('browserA').tauri.restoreAllMocks();

      const [platformA, platformB] = await getBothPlatformInfo();
      expect(platformA.os).toBe(realOs);
      expect(platformB).toEqual({ os: 'mock-b' });
      expect(instance('browserA').tauri.isMockFunction('get_platform_info')).toBe(false);
      expect(instance('browserB').tauri.isMockFunction('get_platform_info')).toBe(true);
      expect(root().tauri.isMockFunction('get_platform_info')).toBe(true);
    });

    it("should clear every instance's mock calls from the root", async () => {
      const [mockA, mockB] = await mockBoth();
      await getBothPlatformInfo();
      expect(mockA).toHaveBeenCalledTimes(1);
      expect(mockB).toHaveBeenCalledTimes(1);

      await root().tauri.clearAllMocks();

      expect(mockA.mock.calls).toStrictEqual([]);
      expect(mockB.mock.calls).toStrictEqual([]);

      // Each mock counts one call again only if each app's own record was cleared too.
      const [platformA, platformB] = await getBothPlatformInfo();
      expect(platformA).toEqual({ os: 'mock-a' });
      expect(platformB).toEqual({ os: 'mock-b' });
      expect(mockA).toHaveBeenCalledTimes(1);
      expect(mockB).toHaveBeenCalledTimes(1);
    });

    it("should restore every instance's mocks from the root", async () => {
      await mockBoth();

      await root().tauri.restoreAllMocks();

      const [platformA, platformB] = await getBothPlatformInfo();
      expect(platformA.os).toBe(realOs);
      expect(platformB.os).toBe(realOs);
      expect(instance('browserA').tauri.isMockFunction('get_platform_info')).toBe(false);
      expect(instance('browserB').tauri.isMockFunction('get_platform_info')).toBe(false);
      expect(root().tauri.isMockFunction('get_platform_info')).toBe(false);
    });
  });

  // Only browserA's options set restoreMocks, so only its mock is restored before the second test.
  // A restore in afterEach would hide that, so this pair cleans up once both have run.
  describe("each instance's restoreMocks", () => {
    after(async () => {
      await root().tauri.restoreAllMocks();
    });

    it('should mock a command in both instances', async () => {
      await mockBoth();

      const [platformA, platformB] = await getBothPlatformInfo();
      expect(platformA).toEqual({ os: 'mock-a' });
      expect(platformB).toEqual({ os: 'mock-b' });
    });

    it('should restore only the mocks of the instance that sets restoreMocks', async () => {
      const [platformA, platformB] = await getBothPlatformInfo();
      expect(platformA.os).toBe(realOs);
      expect(platformB).toEqual({ os: 'mock-b' });
      expect(instance('browserA').tauri.isMockFunction('get_platform_info')).toBe(false);
      expect(instance('browserB').tauri.isMockFunction('get_platform_info')).toBe(true);
    });
  });
});
