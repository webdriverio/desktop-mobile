import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('../src/mockStore.js', () => ({
  default: {
    deleteMock: vi.fn(),
    getMock: vi.fn(),
    setMock: vi.fn(),
  },
}));

vi.mock('../src/commands/execute.js', () => ({
  execute: vi.fn(),
}));

import { execute as tauriExecute } from '../src/commands/execute.js';
import { createMock } from '../src/mock.js';
import mockStore from '../src/mockStore.js';

const mockExecute = vi.mocked(tauriExecute);

function makeBrowser(): WebdriverIO.Browser {
  return { isMultiremote: false } as unknown as WebdriverIO.Browser;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createMock', () => {
  it('should call tauriExecute once for registration', async () => {
    const browser = makeBrowser();
    await createMock('my_cmd', browser);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('should return a TauriMock with __isTauriMock', async () => {
    const browser = makeBrowser();
    const mock = await createMock('my_cmd', browser);
    expect(mock.__isTauriMock).toBe(true);
  });

  it('should set mock name to tauri.<command>', async () => {
    const browser = makeBrowser();
    const mock = await createMock('platform_info', browser);
    expect(mock.getMockName()).toBe('tauri.platform_info');
  });

  describe('update()', () => {
    it('should populate calls from parsed call data', async () => {
      const browser = makeBrowser();
      mockExecute.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
        calls: [['arg1'], ['arg2']],
        results: [
          { type: 'return', value: 'a' },
          { type: 'return', value: 'b' },
        ],
        invocationCallOrder: [0, 1],
      });

      const mock = await createMock('my_cmd', browser);
      await mock.update();

      expect(mock.mock.calls).toHaveLength(2);
      expect(mock.mock.calls[0]).toEqual(['arg1']);
      expect(mock.mock.calls[1]).toEqual(['arg2']);
    });

    it('should not duplicate existing calls on a second update', async () => {
      const browser = makeBrowser();
      const syncPayload = {
        calls: [['arg1']],
        results: [{ type: 'return', value: 'x' }],
        invocationCallOrder: [0],
      };
      mockExecute
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(syncPayload)
        .mockResolvedValueOnce(syncPayload);

      const mock = await createMock('my_cmd', browser);
      await mock.update();
      await mock.update();

      expect(mock.mock.calls).toHaveLength(1);
    });

    it('should replace outer data when inner call count shrinks', async () => {
      const browser = makeBrowser();
      const twoCallsPayload = {
        calls: [['a'], ['b']],
        results: [
          { type: 'return', value: 1 },
          { type: 'return', value: 2 },
        ],
        invocationCallOrder: [0, 1],
      };
      const zeroCallsPayload = { calls: [], results: [], invocationCallOrder: [] };
      mockExecute
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(twoCallsPayload)
        .mockResolvedValueOnce(zeroCallsPayload);

      const mock = await createMock('my_cmd', browser);
      await mock.update();
      expect(mock.mock.calls).toHaveLength(2);

      await mock.update();
      expect(mock.mock.calls).toHaveLength(0);
      expect(mock.mock.results).toHaveLength(0);
      expect(mock.mock.invocationCallOrder).toHaveLength(0);
    });

    it('should use fallback result when syncData.results entry is missing', async () => {
      const browser = makeBrowser();
      mockExecute.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
        calls: [['arg1']],
        results: [],
        invocationCallOrder: [],
      });

      const mock = await createMock('my_cmd', browser);
      await mock.update();

      expect(mock.mock.results[0]).toEqual({ type: 'return', value: undefined });
    });

    it('should return a mock object for chaining', async () => {
      const browser = makeBrowser();
      mockExecute
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ calls: [], results: [], invocationCallOrder: [] });

      const mock = await createMock('my_cmd', browser);
      const result = await mock.update();
      expect(typeof result).toBe('function');
      expect((result as { __isTauriMock?: boolean }).__isTauriMock).toBe(true);
    });
  });

  describe('mockReset() race-condition hack', () => {
    it('should preserve mock name after mockReset', async () => {
      const browser = makeBrowser();
      const mock = await createMock('my_cmd', browser);
      const nameBefore = mock.getMockName();

      mockExecute.mockResolvedValueOnce(undefined);
      await mock.mockReset();

      expect(mock.getMockName()).toBe(nameBefore);
    });

    it('should restore async mockClear after mockReset completes', async () => {
      const browser = makeBrowser();
      const mock = await createMock('my_cmd', browser);

      mockExecute.mockResolvedValueOnce(undefined);
      await mock.mockReset();

      // After mockReset, calling mockClear should again go through tauriExecute (async path)
      // If the sync outerMockClear was accidentally left in place, mockExecute wouldn't be called
      mockExecute.mockResolvedValueOnce(undefined);
      await mock.mockClear();
      expect(mockExecute).toHaveBeenCalled();
    });

    it('should clear calls after mockReset', async () => {
      const browser = makeBrowser();
      const syncPayload = { calls: [['arg']], results: [{ type: 'return', value: 1 }], invocationCallOrder: [0] };
      mockExecute.mockResolvedValueOnce(undefined).mockResolvedValueOnce(syncPayload).mockResolvedValueOnce(undefined);

      const mock = await createMock('my_cmd', browser);
      await mock.update();
      expect(mock.mock.calls).toHaveLength(1);

      await mock.mockReset();
      expect(mock.mock.calls).toHaveLength(0);
    });
  });

  describe('mockRestore()', () => {
    it("should delete the tauri-prefixed name from the browser's mocks", async () => {
      const browser = makeBrowser();
      const mock = await createMock('my_cmd', browser);

      mockExecute.mockResolvedValueOnce(undefined);
      await mock.mockRestore();

      expect(mockStore.deleteMock).toHaveBeenCalledWith(browser, 'tauri.my_cmd');
    });
  });

  describe('when the app call fails', () => {
    async function mockWithOneCall(browser = makeBrowser()) {
      const syncPayload = { calls: [['arg']], results: [{ type: 'return', value: 1 }], invocationCallOrder: [0] };
      mockExecute.mockResolvedValueOnce(undefined).mockResolvedValueOnce(syncPayload);
      const mock = await createMock('my_cmd', browser);
      await mock.update();
      expect(mock.mock.calls).toHaveLength(1);
      mockExecute.mockRejectedValueOnce(new Error('invalid session id'));
      return mock;
    }

    it('should keep the outer calls on mockClear, so they stay in step with the app', async () => {
      const mock = await mockWithOneCall();

      await expect(mock.mockClear()).rejects.toMatchObject({ message: 'invalid session id' });

      expect(mock.mock.calls).toHaveLength(1);
    });

    it('should keep the outer calls, its name and its async mockClear on mockReset', async () => {
      const mock = await mockWithOneCall();

      await expect(mock.mockReset()).rejects.toMatchObject({ message: 'invalid session id' });

      expect(mock.mock.calls).toHaveLength(1);
      expect(mock.getMockName()).toBe('tauri.my_cmd');
      mockExecute.mockClear();
      await mock.mockClear();
      expect(mockExecute).toHaveBeenCalledOnce();
    });

    it('should still clear the outer calls and drop the store entry on mockRestore', async () => {
      const browser = makeBrowser();
      const mock = await mockWithOneCall(browser);

      await expect(mock.mockRestore()).rejects.toMatchObject({ message: 'invalid session id' });

      expect(mock.mock.calls).toHaveLength(0);
      expect(mockStore.deleteMock).toHaveBeenCalledWith(browser, 'tauri.my_cmd');
    });

    it('should still drop the store entry on mockRestore in browser mode', async () => {
      const execute = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('page closed'));
      const browser = { isMultiremote: false, __wdioBrowserMode__: true, execute } as unknown as WebdriverIO.Browser;
      const mock = await createMock('my_cmd', browser);

      await expect(mock.mockRestore()).rejects.toMatchObject({ message: 'page closed' });

      expect(mockStore.deleteMock).toHaveBeenCalledWith(browser, 'tauri.my_cmd');
    });
  });

  describe('wrapperMock', () => {
    it('should return the outer mock state', async () => {
      const browser = makeBrowser();
      const wrapper = await createMock('my_cmd', browser);
      expect(wrapper.mock).toBeDefined();
      expect(Array.isArray(wrapper.mock.calls)).toBe(true);
    });

    it('should have bound and functional wrapperMock.update', async () => {
      const browser = makeBrowser();
      const wrapper = await createMock('my_cmd', browser);

      mockExecute.mockResolvedValueOnce({ calls: [], results: [], invocationCallOrder: [] });
      const result = await wrapper.update();
      expect(result).toBeDefined();
    });
  });
});
