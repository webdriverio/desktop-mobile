import type { TauriMock } from '@wdio/native-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TauriServiceMockStore } from '../src/mockStore.js';

describe('TauriServiceMockStore', () => {
  let store: TauriServiceMockStore;
  const browserA = { sessionId: 'session-a' } as unknown as WebdriverIO.Browser;
  const browserB = { sessionId: 'session-b' } as unknown as WebdriverIO.Browser;

  beforeEach(() => {
    store = new TauriServiceMockStore();
  });

  describe('setMock', () => {
    it('should store a mock and return it', () => {
      const mock = createMock('tauri.testCommand');
      const result = store.setMock(browserA, mock);
      expect(result).toBe(mock);
    });

    it('should overwrite existing mock with same name on the same browser', () => {
      const mock1 = createMock('tauri.testCommand');
      const mock2 = createMock('tauri.testCommand');
      store.setMock(browserA, mock1);
      store.setMock(browserA, mock2);
      expect(store.getMock(browserA, 'tauri.testCommand')).toBe(mock2);
    });

    it('should keep a mock of the same name on each browser', () => {
      const mockA = createMock('tauri.testCommand');
      const mockB = createMock('tauri.testCommand');
      store.setMock(browserA, mockA);
      store.setMock(browserB, mockB);
      expect(store.getMock(browserA, 'tauri.testCommand')).toBe(mockA);
      expect(store.getMock(browserB, 'tauri.testCommand')).toBe(mockB);
    });
  });

  describe('getMock', () => {
    it('should return stored mock', () => {
      const mock = createMock('tauri.testCommand');
      store.setMock(browserA, mock);
      expect(store.getMock(browserA, 'tauri.testCommand')).toBe(mock);
    });

    it('should throw error for non-existent mock', () => {
      expect(() => store.getMock(browserA, 'tauri.nonExistent')).toThrow('No mock registered for "tauri.nonExistent"');
    });

    it('should throw for a mock that only another browser has', () => {
      store.setMock(browserA, createMock('tauri.testCommand'));
      expect(() => store.getMock(browserB, 'tauri.testCommand')).toThrow('No mock registered for "tauri.testCommand"');
    });
  });

  describe('getMocks', () => {
    it('should return empty array when no mocks stored', () => {
      expect(store.getMocks(browserA)).toEqual([]);
    });

    it("should return only the browser's own mocks as entries", () => {
      const mock1 = createMock('tauri.command1');
      const mock2 = createMock('tauri.command2');
      store.setMock(browserA, mock1);
      store.setMock(browserA, mock2);
      store.setMock(browserB, createMock('tauri.command3'));
      expect(store.getMocks(browserA)).toEqual([
        ['tauri.command1', mock1],
        ['tauri.command2', mock2],
      ]);
    });
  });

  describe('getAllMocks', () => {
    it("should return every browser's mocks", () => {
      const mockA = createMock('tauri.testCommand');
      const mockB = createMock('tauri.testCommand');
      store.setMock(browserA, mockA);
      store.setMock(browserB, mockB);
      expect(store.getAllMocks()).toEqual([
        ['tauri.testCommand', mockA],
        ['tauri.testCommand', mockB],
      ]);
    });
  });

  describe('deleteMock', () => {
    it('should remove mock and return true', () => {
      const mock = createMock('tauri.testCommand');
      store.setMock(browserA, mock);
      expect(store.deleteMock(browserA, 'tauri.testCommand')).toBe(true);
      expect(() => store.getMock(browserA, 'tauri.testCommand')).toThrow();
      expect(store.getAllMocks()).toEqual([]);
    });

    it('should return false for non-existent mock', () => {
      expect(store.deleteMock(browserA, 'tauri.nonExistent')).toBe(false);
    });

    it("should leave another browser's mock of the same name", () => {
      const mockB = createMock('tauri.testCommand');
      store.setMock(browserA, createMock('tauri.testCommand'));
      store.setMock(browserB, mockB);
      expect(store.deleteMock(browserA, 'tauri.testCommand')).toBe(true);
      expect(store.getAllMocks()).toEqual([['tauri.testCommand', mockB]]);
    });
  });

  describe('clear', () => {
    it("should remove every browser's mocks", () => {
      store.setMock(browserA, createMock('tauri.command1'));
      store.setMock(browserB, createMock('tauri.command2'));
      store.clear();
      expect(store.getAllMocks()).toEqual([]);
    });

    it('should be safe to call on empty store', () => {
      store.clear();
      expect(store.getAllMocks()).toEqual([]);
    });
  });
});

function createMock(name: string): TauriMock {
  const mock = vi.fn() as unknown as TauriMock;
  mock.getMockName = () => name;
  mock.mockClear = vi.fn().mockResolvedValue(mock);
  mock.mockReset = vi.fn().mockResolvedValue(mock);
  mock.mockRestore = vi.fn().mockResolvedValue(mock);
  mock.update = vi.fn().mockResolvedValue(mock);
  mock.__isTauriMock = true;
  return mock;
}
