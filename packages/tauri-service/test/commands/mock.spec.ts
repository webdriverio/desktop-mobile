import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { mock } from '../../src/commands/mock.js';
import { createMock } from '../../src/mock.js';
import mockStore from '../../src/mockStore.js';
import { createFakeMultiremote } from './multiremoteFakes.js';

vi.mock('../../src/mock.js', () => ({
  createMock: vi.fn(),
}));

afterEach(() => {
  mockStore.clear();
  vi.clearAllMocks();
  delete (globalThis as any).browser;
});

function createMockedCommand(): any {
  return {
    getMockName: () => 'tauri.get_platform_info',
    mockReset: vi.fn(),
  };
}

describe('mock Command', () => {
  let mockedCommand: any;
  let browserWithTauri: WebdriverIO.Browser;

  beforeEach(async () => {
    mockedCommand = createMockedCommand();
    browserWithTauri = {
      isMultiremote: false,
      tauri: { execute: vi.fn() },
    } as unknown as WebdriverIO.Browser;
  });

  it('should return an existing mock', async () => {
    mockStore.setMock(browserWithTauri, mockedCommand);

    const retrievedMock = await mock.call({ browser: browserWithTauri }, 'get_platform_info');
    expect(retrievedMock).toBe(mockedCommand);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('should reset an existing mock', async () => {
    mockStore.setMock(browserWithTauri, mockedCommand);

    const retrievedMock = await mock.call({ browser: browserWithTauri }, 'get_platform_info');
    expect(retrievedMock.mockReset).toHaveBeenCalled();
  });

  it('should throw when no browser context is available', async () => {
    await expect(mock.call({}, 'get_platform_info')).rejects.toThrow('mock requires a valid browser context');
    expect(createMock).not.toHaveBeenCalled();
  });

  describe('when there is no existing mock', () => {
    it('should create a new mock', async () => {
      (createMock as Mock).mockReturnValue(mockedCommand);

      const createdMock = await mock.call({ browser: browserWithTauri }, 'get_platform_info');
      expect(createdMock.getMockName()).toBe('tauri.get_platform_info');
    });

    it("should put newly created mocks in the browser's store", async () => {
      (createMock as Mock).mockReturnValue(mockedCommand);

      await mock.call({ browser: browserWithTauri }, 'get_platform_info');
      expect(mockStore.getMock(browserWithTauri, 'tauri.get_platform_info')).toBe(mockedCommand);
    });

    it('should use this.browser when it has tauri capabilities', async () => {
      (createMock as Mock).mockReturnValue(mockedCommand);

      const context = { browser: browserWithTauri };
      await mock.call(context, 'get_platform_info');

      expect(createMock).toHaveBeenCalledWith('get_platform_info', browserWithTauri);
    });

    it('should fall back to globalThis.browser with tauri capabilities', async () => {
      (createMock as Mock).mockReturnValue(mockedCommand);

      const globalBrowser = {
        isMultiremote: false,
        tauri: { execute: vi.fn() },
      } as unknown as WebdriverIO.Browser;
      globalThis.browser = globalBrowser as any;

      await mock.call({}, 'get_platform_info');

      expect(createMock).toHaveBeenCalledWith('get_platform_info', globalBrowser);
    });

    it('should fall back to globalThis.browser without tauri when not multiremote', async () => {
      (createMock as Mock).mockReturnValue(mockedCommand);

      const globalBrowser = {
        isMultiremote: false,
      } as unknown as WebdriverIO.Browser;
      globalThis.browser = globalBrowser as any;

      await mock.call({}, 'get_platform_info');

      expect(createMock).toHaveBeenCalledWith('get_platform_info', globalBrowser);
    });

    it('should skip multiremote browser on this.browser and use globalThis.browser', async () => {
      (createMock as Mock).mockReturnValue(mockedCommand);

      const multiremoteBrowser = {
        isMultiremote: true,
        tauri: { execute: vi.fn() },
      } as unknown as WebdriverIO.MultiRemoteBrowser;

      const globalBrowser = {
        isMultiremote: false,
        tauri: { execute: vi.fn() },
      } as unknown as WebdriverIO.Browser;
      globalThis.browser = globalBrowser as any;

      const context = { browser: multiremoteBrowser };
      await mock.call(context, 'get_platform_info');

      expect(createMock).toHaveBeenCalledWith('get_platform_info', globalBrowser);
    });

    it('should propagate errors from createMock', async () => {
      (createMock as Mock).mockRejectedValue(new Error('browser.execute failed'));

      await expect(mock.call({ browser: browserWithTauri }, 'get_platform_info')).rejects.toThrow(
        'browser.execute failed',
      );
    });
  });

  describe('in multiremote', () => {
    let fakes: ReturnType<typeof createFakeMultiremote>;

    beforeEach(() => {
      fakes = createFakeMultiremote();
      for (const instance of [fakes.browserA, fakes.browserB]) {
        (instance as any).tauri = { execute: vi.fn() };
      }
      (fakes.root as any).tauri = { execute: vi.fn() };
      globalThis.browser = fakes.root as any;
      (createMock as Mock).mockImplementation(async () => createMockedCommand());
    });

    it('should give each instance its own mock of the same command, created in its own app', async () => {
      const mockA = await mock.call({ browser: fakes.browserA }, 'get_platform_info');
      const mockB = await mock.call({ browser: fakes.browserB }, 'get_platform_info');

      expect(mockB).not.toBe(mockA);
      expect(createMock).toHaveBeenNthCalledWith(1, 'get_platform_info', fakes.browserA);
      expect(createMock).toHaveBeenNthCalledWith(2, 'get_platform_info', fakes.browserB);
      expect(mockA.mockReset).not.toHaveBeenCalled();
    });

    it("should return and reset the instance's existing mock", async () => {
      const mockA = await mock.call({ browser: fakes.browserA }, 'get_platform_info');
      await mock.call({ browser: fakes.browserB }, 'get_platform_info');

      const again = await mock.call({ browser: fakes.browserA }, 'get_platform_info');

      expect(again).toBe(mockA);
      expect(mockA.mockReset).toHaveBeenCalledOnce();
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    it("should keep the root's mock apart from the instances'", async () => {
      const mockA = await mock.call({ browser: fakes.browserA }, 'get_platform_info');
      const rootMock = await mock.call({ browser: fakes.root }, 'get_platform_info');

      expect(rootMock).not.toBe(mockA);
      expect(createMock).toHaveBeenLastCalledWith('get_platform_info', fakes.root);
    });
  });
});
