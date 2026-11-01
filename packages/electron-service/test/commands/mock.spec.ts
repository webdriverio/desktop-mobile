import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { createClassMock } from '../../src/classMock.js';
import { mock } from '../../src/commands/mock.js';
import { createMock } from '../../src/mock.js';
import mockStore from '../../src/mockStore.js';
import { createFakeMultiremote } from './multiremoteFakes.js';

vi.mock('../../src/mock.js', () => ({
  createMock: vi.fn(),
}));
vi.mock('../../src/classMock.js', () => ({
  createClassMock: vi.fn(),
}));

afterEach(() => {
  mockStore.clear();
  vi.clearAllMocks();
  delete (globalThis as { browser?: unknown }).browser;
});

function createMockedGetName(): any {
  return {
    getMockName: () => 'electron.app.getName',
    mockReset: vi.fn(),
  };
}

describe('mock Command', () => {
  let mockedGetName: any;
  let browserWithElectron: WebdriverIO.Browser;

  beforeEach(async () => {
    mockedGetName = createMockedGetName();
    browserWithElectron = {
      electron: { execute: vi.fn() },
    } as unknown as WebdriverIO.Browser;
  });

  it('should return an existing mock', async () => {
    mockStore.setMock(browserWithElectron, mockedGetName);

    const retrievedMock = await mock.call({ browser: browserWithElectron }, 'app', 'getName');
    expect(retrievedMock).toBe(mockedGetName);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('should reset an existing mock', async () => {
    mockStore.setMock(browserWithElectron, mockedGetName);

    const retrievedMock = await mock.call({ browser: browserWithElectron }, 'app', 'getName');
    expect(retrievedMock.mockReset).toHaveBeenCalled();
  });

  it('should fall back to the global browser', async () => {
    globalThis.browser = browserWithElectron;
    (createMock as Mock).mockReturnValue(mockedGetName);

    await mock.call(undefined, 'app', 'getName');

    expect(createMock).toHaveBeenCalledWith('app', 'getName', browserWithElectron);
  });

  it('should throw when no browser context is available', async () => {
    await expect(mock.call({}, 'app', 'getName')).rejects.toMatchObject({
      message: 'mock requires a valid browser context',
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  describe('when there is no existing mock', () => {
    it('should create a new mock', async () => {
      (createMock as Mock).mockReturnValue(mockedGetName);

      const createdMock = await mock.call({ browser: browserWithElectron }, 'app', 'getName');
      expect(createdMock.getMockName()).toBe('electron.app.getName');
      expect(createMock).toHaveBeenCalledWith('app', 'getName', browserWithElectron);
    });

    it("should put newly created mocks in the browser's store", async () => {
      (createMock as Mock).mockReturnValue(mockedGetName);

      await mock.call({ browser: browserWithElectron }, 'app', 'getName');
      expect(mockStore.getMock(browserWithElectron, 'electron.app.getName')).toBe(mockedGetName);
    });
  });

  describe('class mock path (no funcName)', () => {
    it('should call createClassMock with the browser when no funcName is provided', async () => {
      const mockClassInstance = { getMockName: () => 'electron.Tray', __constructor: vi.fn() };
      (createClassMock as Mock).mockResolvedValue(mockClassInstance);

      const result = await mock.call({ browser: browserWithElectron }, 'Tray');
      expect(createClassMock).toHaveBeenCalledWith('Tray', browserWithElectron);
      expect(result).toBe(mockClassInstance);
    });

    it('should not store class mocks under the class name', async () => {
      (createClassMock as Mock).mockResolvedValue({ getMockName: () => 'electron.Tray' });

      await mock.call({ browser: browserWithElectron }, 'Tray');
      expect(mockStore.getMocks(browserWithElectron)).toEqual([]);
    });
  });

  describe('in multiremote', () => {
    let fakes: ReturnType<typeof createFakeMultiremote>;

    beforeEach(() => {
      fakes = createFakeMultiremote();
      globalThis.browser = fakes.root as unknown as WebdriverIO.Browser;
      (createMock as Mock).mockImplementation(async () => createMockedGetName());
    });

    it('should give each instance its own mock of the same function, created in its own app', async () => {
      const mockA = await mock.call({ browser: fakes.browserA }, 'app', 'getName');
      const mockB = await mock.call({ browser: fakes.browserB }, 'app', 'getName');

      expect(mockB).not.toBe(mockA);
      expect(createMock).toHaveBeenNthCalledWith(1, 'app', 'getName', fakes.browserA);
      expect(createMock).toHaveBeenNthCalledWith(2, 'app', 'getName', fakes.browserB);
      expect(mockA.mockReset).not.toHaveBeenCalled();
    });

    it("should return and reset the instance's existing mock", async () => {
      const mockA = await mock.call({ browser: fakes.browserA }, 'app', 'getName');
      await mock.call({ browser: fakes.browserB }, 'app', 'getName');

      const again = await mock.call({ browser: fakes.browserA }, 'app', 'getName');

      expect(again).toBe(mockA);
      expect(mockA.mockReset).toHaveBeenCalledOnce();
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    it('should create a class mock in the calling instance only', async () => {
      (createClassMock as Mock).mockResolvedValue({ getMockName: () => 'electron.Tray' });

      await mock.call({ browser: fakes.browserB }, 'Tray');

      expect(createClassMock).toHaveBeenCalledExactlyOnceWith('Tray', fakes.browserB);
    });

    it("should keep the root's mock apart from the instances'", async () => {
      const mockA = await mock.call({ browser: fakes.browserA }, 'app', 'getName');
      const rootMock = await mock.call({ browser: fakes.root }, 'app', 'getName');

      expect(rootMock).not.toBe(mockA);
      expect(createMock).toHaveBeenLastCalledWith('app', 'getName', fakes.root);
    });
  });
});
