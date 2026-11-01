import type { ElectronFunctionMock } from '@wdio/native-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAllMocks } from '../../src/commands/clearAllMocks.js';
import { resetAllMocks } from '../../src/commands/resetAllMocks.js';
import { restoreAllMocks } from '../../src/commands/restoreAllMocks.js';
import mockStore, { type MockOwner } from '../../src/mockStore.js';
import { createFakeMultiremote } from './multiremoteFakes.js';

type MockApiMethod = { getMockName: () => string; [key: string]: ReturnType<typeof vi.fn> | (() => string) };

function createMockApiMethod(name: string, mockMethod: string): MockApiMethod {
  return { getMockName: () => name, [mockMethod]: vi.fn() };
}

function store(owner: MockOwner, mock: MockApiMethod) {
  mockStore.setMock(owner, mock as unknown as ElectronFunctionMock);
  return mock;
}

describe.each([
  { name: 'clearAllMocks', fn: clearAllMocks, mockMethod: 'mockClear' },
  { name: 'resetAllMocks', fn: resetAllMocks, mockMethod: 'mockReset' },
  { name: 'restoreAllMocks', fn: restoreAllMocks, mockMethod: 'mockRestore' },
] as const)('$name Command', ({ name, fn, mockMethod }) => {
  let browser: WebdriverIO.Browser;
  let mockedGetName: MockApiMethod;
  let mockedShowOpenDialog: MockApiMethod;

  beforeEach(() => {
    browser = { sessionId: 'session' } as unknown as WebdriverIO.Browser;
    mockedGetName = store(browser, createMockApiMethod('electron.app.getName', mockMethod));
    mockedShowOpenDialog = store(browser, createMockApiMethod('electron.dialog.showOpenDialog', mockMethod));
  });

  afterEach(() => {
    mockStore.clear();
    delete (globalThis as { browser?: unknown }).browser;
  });

  it('should operate on all mock functions when no apiName is specified', async () => {
    await fn.call({ browser });
    expect(mockedGetName[mockMethod]).toHaveBeenCalled();
    expect(mockedShowOpenDialog[mockMethod]).toHaveBeenCalled();
  });

  it('should operate only on mock functions for a specific API', async () => {
    await fn.call({ browser }, 'app');
    expect(mockedGetName[mockMethod]).toHaveBeenCalled();
    expect(mockedShowOpenDialog[mockMethod]).not.toHaveBeenCalled();
  });

  it('should match the apiName as a literal prefix', async () => {
    await fn.call({ browser }, 'dialog.show');
    await fn.call({ browser }, 'a.p');
    expect(mockedShowOpenDialog[mockMethod]).toHaveBeenCalledOnce();
    expect(mockedGetName[mockMethod]).not.toHaveBeenCalled();
  });

  it('should match a browser-mode channel by prefix', async () => {
    const browserModeMock = store(browser, createMockApiMethod('electron.get-user', mockMethod));
    (browserModeMock[mockMethod] as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('page closed'));

    await expect(fn.call({ browser }, 'get-')).rejects.toMatchObject({
      message: `${mockMethod} failed: electron.get-user: page closed`,
    });

    expect(browserModeMock[mockMethod]).toHaveBeenCalledOnce();
  });

  it('should attempt every mock and then report the one that failed', async () => {
    (mockedGetName[mockMethod] as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('inner mock gone'));

    await expect(fn.call({ browser })).rejects.toMatchObject({
      message: `${mockMethod} failed: electron.app.getName: inner mock gone`,
    });

    expect(mockedShowOpenDialog[mockMethod]).toHaveBeenCalled();
  });

  it('should fall back to the global browser', async () => {
    globalThis.browser = browser;

    await fn.call(undefined);

    expect(mockedGetName[mockMethod]).toHaveBeenCalled();
  });

  it('should throw when no browser context is available', async () => {
    await expect(fn.call({})).rejects.toMatchObject({ message: `${name} requires a valid browser context` });
  });

  describe('in multiremote', () => {
    let fakes: ReturnType<typeof createFakeMultiremote>;
    let mockA: MockApiMethod;
    let mockB: MockApiMethod;
    let rootMock: MockApiMethod;

    beforeEach(() => {
      mockStore.clear();
      fakes = createFakeMultiremote();
      globalThis.browser = fakes.root as unknown as WebdriverIO.Browser;
      mockA = store(fakes.browserA, createMockApiMethod('electron.app.getName', mockMethod));
      mockB = store(fakes.browserB, createMockApiMethod('electron.app.getName', mockMethod));
      rootMock = store(fakes.root, createMockApiMethod('electron.app.getName', mockMethod));
    });

    it("should operate only on the calling instance's mocks", async () => {
      await fn.call({ browser: fakes.browserA });

      expect(mockA[mockMethod]).toHaveBeenCalledOnce();
      expect(mockB[mockMethod]).not.toHaveBeenCalled();
      expect(rootMock[mockMethod]).not.toHaveBeenCalled();
    });

    it("should operate on every instance's mocks, and the root's own, on the root", async () => {
      await fn.call({ browser: fakes.root }, 'app');

      for (const mock of [mockA, mockB, rootMock]) {
        expect(mock[mockMethod]).toHaveBeenCalledOnce();
      }
    });

    it('should finish the other instances before reporting the one that failed', async () => {
      const failure = new Error('inner mock gone');
      (mockA[mockMethod] as ReturnType<typeof vi.fn>).mockRejectedValueOnce(failure);

      await expect(fn.call({ browser: fakes.root })).rejects.toMatchObject({
        message: `${name} failed on browserA: ${mockMethod} failed: electron.app.getName: inner mock gone`,
        cause: { errors: [failure] },
      });

      expect(mockB[mockMethod]).toHaveBeenCalledOnce();
      expect(rootMock[mockMethod]).toHaveBeenCalledOnce();
    });

    it('should report every instance that failed', async () => {
      (mockA[mockMethod] as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('a failed'));
      (rootMock[mockMethod] as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('root failed'));

      await expect(fn.call({ browser: fakes.root })).rejects.toMatchObject({
        message:
          `${name} failed on browserA: ${mockMethod} failed: electron.app.getName: a failed; ` +
          `the multiremote root: ${mockMethod} failed: electron.app.getName: root failed`,
        errors: [{ message: expect.stringContaining('a failed') }, { message: expect.stringContaining('root failed') }],
      });
    });
  });
});
