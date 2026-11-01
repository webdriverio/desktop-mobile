import type { ElectronFunctionMock } from '@wdio/native-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { ElectronServiceMockStore } from '../src/mockStore.js';

const createMock = (name: string) => ({ getMockName: () => name }) as unknown as ElectronFunctionMock;

describe('ElectronServiceMockStore', () => {
  let store: ElectronServiceMockStore;
  const browserA = { sessionId: 'session-a' } as unknown as WebdriverIO.Browser;
  const browserB = { sessionId: 'session-b' } as unknown as WebdriverIO.Browser;

  beforeEach(() => {
    store = new ElectronServiceMockStore();
  });

  describe('setMock', () => {
    it('should store a mock under its name and return it', () => {
      const mock = createMock('electron.app.getName');
      expect(store.setMock(browserA, mock)).toBe(mock);
      expect(store.getMock(browserA, 'electron.app.getName')).toBe(mock);
    });

    it('should overwrite an existing mock with the same name on the same browser', () => {
      const mock1 = createMock('electron.app.getName');
      const mock2 = createMock('electron.app.getName');
      store.setMock(browserA, mock1);
      store.setMock(browserA, mock2);
      expect(store.getMock(browserA, 'electron.app.getName')).toBe(mock2);
    });

    it('should keep a mock of the same name on each browser', () => {
      const mockA = createMock('electron.app.getName');
      const mockB = createMock('electron.app.getName');
      store.setMock(browserA, mockA);
      store.setMock(browserB, mockB);
      expect(store.getMock(browserA, 'electron.app.getName')).toBe(mockA);
      expect(store.getMock(browserB, 'electron.app.getName')).toBe(mockB);
    });
  });

  describe('getMock', () => {
    it('should throw when there is no stored mock with a given ID', () => {
      store.setMock(browserA, createMock('electron.app.getName'));
      expect(() => store.getMock(browserA, 'not a stored mock')).toThrow('No mock registered for "not a stored mock"');
    });

    it('should throw for a mock that only another browser has', () => {
      store.setMock(browserA, createMock('electron.app.getName'));
      expect(() => store.getMock(browserB, 'electron.app.getName')).toThrow(
        'No mock registered for "electron.app.getName"',
      );
    });
  });

  describe('getMocks', () => {
    it('should return an empty array for a browser with no mocks', () => {
      expect(store.getMocks(browserA)).toEqual([]);
    });

    it("should return only the browser's own mocks as entries", () => {
      const mock1 = createMock('electron.app.getName');
      const mock2 = createMock('electron.dialog.showOpenDialog');
      store.setMock(browserA, mock1);
      store.setMock(browserA, mock2);
      store.setMock(browserB, createMock('electron.app.getVersion'));
      expect(store.getMocks(browserA)).toStrictEqual([
        ['electron.app.getName', mock1],
        ['electron.dialog.showOpenDialog', mock2],
      ]);
    });
  });

  describe('deleteMock', () => {
    it('should remove a specific mock and return true', () => {
      const mock2 = createMock('electron.app.getVersion');
      store.setMock(browserA, createMock('electron.app.getName'));
      store.setMock(browserA, mock2);

      expect(store.deleteMock(browserA, 'electron.app.getName')).toBe(true);
      expect(store.getMocks(browserA)).toStrictEqual([['electron.app.getVersion', mock2]]);
    });

    it('should return false when deleting a non-existent mock', () => {
      expect(store.deleteMock(browserA, 'non-existent')).toBe(false);
    });

    it("should leave another browser's mock of the same name", () => {
      const mockB = createMock('electron.app.getName');
      store.setMock(browserA, createMock('electron.app.getName'));
      store.setMock(browserB, mockB);

      expect(store.deleteMock(browserA, 'electron.app.getName')).toBe(true);
      expect(store.getMocks(browserA)).toEqual([]);
      expect(store.getMocks(browserB)).toStrictEqual([['electron.app.getName', mockB]]);
    });
  });

  describe('clear', () => {
    it("should remove every browser's mocks", () => {
      store.setMock(browserA, createMock('electron.app.getName'));
      store.setMock(browserB, createMock('electron.app.getVersion'));

      store.clear();

      expect(store.getMocks(browserA)).toEqual([]);
      expect(store.getMocks(browserB)).toEqual([]);
    });
  });
});
