import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearAllMocks, isMockFunction, resetAllMocks, restoreAllMocks } from '../../src/commands/allMocks.js';
import mockStore from '../../src/mockStore.js';

function fakeMock(name: string) {
  return {
    getMockName: () => name,
    mockClear: vi.fn().mockResolvedValue(undefined),
    mockReset: vi.fn().mockResolvedValue(undefined),
    mockRestore: vi.fn().mockResolvedValue(undefined),
    __isDioxusMock: true,
  } as unknown as Parameters<typeof mockStore.setMock>[0] & {
    mockClear: ReturnType<typeof vi.fn>;
    mockReset: ReturnType<typeof vi.fn>;
    mockRestore: ReturnType<typeof vi.fn>;
  };
}

describe('all-mocks helpers', () => {
  afterEach(() => {
    mockStore.clear();
  });

  describe('clearAllMocks', () => {
    it('should call mockClear on every registered mock when no prefix is given', async () => {
      const a = fakeMock('dioxus.a');
      const b = fakeMock('dioxus.b');
      mockStore.setMock(a);
      mockStore.setMock(b);

      await clearAllMocks();

      expect((a as unknown as { mockClear: ReturnType<typeof vi.fn> }).mockClear).toHaveBeenCalled();
      expect((b as unknown as { mockClear: ReturnType<typeof vi.fn> }).mockClear).toHaveBeenCalled();
    });

    it('should filter by prefix', async () => {
      const a = fakeMock('dioxus.fs.read');
      const b = fakeMock('dioxus.fs.write');
      const c = fakeMock('dioxus.net.fetch');
      mockStore.setMock(a);
      mockStore.setMock(b);
      mockStore.setMock(c);

      await clearAllMocks('fs');

      expect((a as unknown as { mockClear: ReturnType<typeof vi.fn> }).mockClear).toHaveBeenCalled();
      expect((b as unknown as { mockClear: ReturnType<typeof vi.fn> }).mockClear).toHaveBeenCalled();
      expect((c as unknown as { mockClear: ReturnType<typeof vi.fn> }).mockClear).not.toHaveBeenCalled();
    });
  });

  describe('resetAllMocks', () => {
    it('should call mockReset on each mock', async () => {
      const a = fakeMock('dioxus.a');
      mockStore.setMock(a);
      await resetAllMocks();
      expect((a as unknown as { mockReset: ReturnType<typeof vi.fn> }).mockReset).toHaveBeenCalled();
    });
  });

  describe('restoreAllMocks', () => {
    it('should call mockRestore on each mock', async () => {
      const a = fakeMock('dioxus.a');
      mockStore.setMock(a);
      await restoreAllMocks();
      expect((a as unknown as { mockRestore: ReturnType<typeof vi.fn> }).mockRestore).toHaveBeenCalled();
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
