import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAllMocks, isMockFunction, resetAllMocks, restoreAllMocks } from '../../src/commands/allMocks.js';
import { markAsEmbedded } from '../../src/commands/execute.js';
import { createMock } from '../../src/mock.js';
import mockStore from '../../src/mockStore.js';
import { createFakeMultiremote } from './multiremoteFakes.js';

function fakeMock(name: string) {
  return {
    getMockName: () => name,
    mockClear: vi.fn().mockResolvedValue(undefined),
    mockReset: vi.fn().mockResolvedValue(undefined),
    mockRestore: vi.fn().mockResolvedValue(undefined),
    __isDioxusMock: true,
  } as unknown as Parameters<typeof mockStore.setMock>[1] & {
    mockClear: ReturnType<typeof vi.fn>;
    mockReset: ReturnType<typeof vi.fn>;
    mockRestore: ReturnType<typeof vi.fn>;
  };
}

describe('all-mocks helpers', () => {
  let browser: WebdriverIO.Browser;

  beforeEach(() => {
    browser = { execute: vi.fn().mockResolvedValue(undefined) } as unknown as WebdriverIO.Browser;
  });

  afterEach(() => {
    mockStore.clear();
  });

  describe('clearAllMocks', () => {
    it('should call mockClear on every registered mock when no prefix is given', async () => {
      const a = fakeMock('dioxus.a');
      const b = fakeMock('dioxus.b');
      mockStore.setMock(browser, a);
      mockStore.setMock(browser, b);

      await clearAllMocks(browser);

      expect(a.mockClear).toHaveBeenCalled();
      expect(b.mockClear).toHaveBeenCalled();
    });

    it('should filter by prefix', async () => {
      const a = fakeMock('dioxus.fs.read');
      const b = fakeMock('dioxus.fs.write');
      const c = fakeMock('dioxus.net.fetch');
      mockStore.setMock(browser, a);
      mockStore.setMock(browser, b);
      mockStore.setMock(browser, c);

      await clearAllMocks(browser, 'fs');

      expect(a.mockClear).toHaveBeenCalled();
      expect(b.mockClear).toHaveBeenCalled();
      expect(c.mockClear).not.toHaveBeenCalled();
    });
  });

  describe('resetAllMocks', () => {
    it('should call mockReset on each mock', async () => {
      const a = fakeMock('dioxus.a');
      mockStore.setMock(browser, a);
      await resetAllMocks(browser);
      expect(a.mockReset).toHaveBeenCalled();
    });
  });

  describe('restoreAllMocks', () => {
    it('should call mockRestore on each mock', async () => {
      const a = fakeMock('dioxus.a');
      mockStore.setMock(browser, a);
      await restoreAllMocks(browser);
      expect(a.mockRestore).toHaveBeenCalled();
    });
  });

  describe.each([
    { name: 'clearAllMocks', op: clearAllMocks, method: 'mockClear' },
    { name: 'resetAllMocks', op: resetAllMocks, method: 'mockReset' },
    { name: 'restoreAllMocks', op: restoreAllMocks, method: 'mockRestore' },
  ] as const)('$name with a failing mock', ({ op, method }) => {
    it(`should call ${method} on the remaining mocks and then report the failure`, async () => {
      const failing = fakeMock('dioxus.failing');
      const a = fakeMock('dioxus.a');
      const b = fakeMock('dioxus.b');
      failing[method].mockRejectedValue(new Error('inner mock gone'));
      mockStore.setMock(browser, failing);
      mockStore.setMock(browser, a);
      mockStore.setMock(browser, b);

      await expect(op(browser)).rejects.toMatchObject({ message: `${method} failed: dioxus.failing: inner mock gone` });

      expect(a[method]).toHaveBeenCalled();
      expect(b[method]).toHaveBeenCalled();
    });
  });

  describe('restoreAllMocks against a dead app', () => {
    it('should attempt every mock, report each failure and still empty the store', async () => {
      markAsEmbedded(browser);
      await createMock('a', browser);
      await createMock('b', browser);
      await createMock('c', browser);
      vi.mocked(browser.execute).mockClear().mockRejectedValue(new Error('WebSocket is not connected'));

      await expect(restoreAllMocks(browser)).rejects.toMatchObject({
        errors: Array(3).fill(expect.objectContaining({ message: 'WebSocket is not connected' })),
      });

      expect(browser.execute).toHaveBeenCalledTimes(3);
      expect(mockStore.getAllMocks()).toEqual([]);
    });
  });

  describe('in multiremote', () => {
    let fakes: ReturnType<typeof createFakeMultiremote>;
    let mockA: ReturnType<typeof fakeMock>;
    let mockB: ReturnType<typeof fakeMock>;
    let rootMock: ReturnType<typeof fakeMock>;

    beforeEach(() => {
      fakes = createFakeMultiremote();
      mockA = fakeMock('dioxus.greet');
      mockB = fakeMock('dioxus.greet');
      rootMock = fakeMock('dioxus.greet');
      mockStore.setMock(fakes.browserA, mockA);
      mockStore.setMock(fakes.browserB, mockB);
      mockStore.setMock(fakes.root, rootMock);
    });

    describe.each([
      { name: 'clearAllMocks', op: clearAllMocks, method: 'mockClear' },
      { name: 'resetAllMocks', op: resetAllMocks, method: 'mockReset' },
      { name: 'restoreAllMocks', op: restoreAllMocks, method: 'mockRestore' },
    ] as const)('$name', ({ op, method }) => {
      it("should only touch the calling instance's mocks", async () => {
        await op(fakes.browserA);

        expect(mockA[method]).toHaveBeenCalledOnce();
        expect(mockB[method]).not.toHaveBeenCalled();
        expect(rootMock[method]).not.toHaveBeenCalled();
      });

      it("should cover every instance's mocks, and the root's own, on the root", async () => {
        await op(fakes.root);

        for (const mock of [mockA, mockB, rootMock]) {
          expect(mock[method]).toHaveBeenCalledOnce();
        }
      });
    });

    it('should apply the prefix on every instance', async () => {
      const otherA = fakeMock('dioxus.other');
      mockStore.setMock(fakes.browserA, otherA);

      await clearAllMocks(fakes.root, 'gre');

      expect(mockA.mockClear).toHaveBeenCalledOnce();
      expect(mockB.mockClear).toHaveBeenCalledOnce();
      expect(otherA.mockClear).not.toHaveBeenCalled();
    });

    it('should finish the other instances before reporting the one that failed', async () => {
      const failure = new Error('inner mock gone');
      mockA.mockRestore.mockRejectedValueOnce(failure);

      await expect(restoreAllMocks(fakes.root)).rejects.toMatchObject({
        message: 'restoreAllMocks failed on browserA: mockRestore failed: dioxus.greet: inner mock gone',
        cause: { errors: [failure] },
      });

      expect(mockB.mockRestore).toHaveBeenCalledOnce();
      expect(rootMock.mockRestore).toHaveBeenCalledOnce();
    });

    it('should report every instance that failed', async () => {
      mockA.mockReset.mockRejectedValueOnce(new Error('a failed'));
      rootMock.mockReset.mockRejectedValueOnce(new Error('root failed'));

      await expect(resetAllMocks(fakes.root)).rejects.toMatchObject({
        message:
          'resetAllMocks failed on browserA: mockReset failed: dioxus.greet: a failed; ' +
          'the multiremote root: mockReset failed: dioxus.greet: root failed',
        errors: [{ message: expect.stringContaining('a failed') }, { message: expect.stringContaining('root failed') }],
      });
      expect(mockB.mockReset).toHaveBeenCalledOnce();
    });
  });

  describe('isMockFunction', () => {
    it('should return true for a value with __isDioxusMock=true', () => {
      const fn = (() => undefined) as unknown as Record<string, unknown>;
      fn.__isDioxusMock = true;
      expect(isMockFunction(fn)).toBe(true);
    });

    it('should return false for a plain function', () => {
      expect(isMockFunction(() => undefined)).toBe(false);
    });

    it('should return false for non-functions', () => {
      expect(isMockFunction({ __isDioxusMock: true })).toBe(false);
      expect(isMockFunction(null)).toBe(false);
      expect(isMockFunction(undefined)).toBe(false);
      expect(isMockFunction('string')).toBe(false);
    });
  });
});
