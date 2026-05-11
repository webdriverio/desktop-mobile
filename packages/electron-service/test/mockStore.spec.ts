import type { ElectronMock } from '@wdio/native-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronServiceMockStore } from '../src/mockStore.js';

let mockStore: ElectronServiceMockStore;

beforeEach(async () => {
  mockStore = (await import('../src/mockStore.js')).default;
});

afterEach(() => {
  vi.resetModules();
});

describe('Mock Store', () => {
  const testMock = { getMockName: () => 'test mock' } as unknown as ElectronMock;

  it('should set and get a specific mock', () => {
    mockStore.setMock(testMock);
    expect(mockStore.getMock('test mock')).toBe(testMock);
  });

  it('should throw an error when there is no stored mock with a given ID', () => {
    mockStore.setMock(testMock);
    expect(() => mockStore.getMock('not a stored mock')).toThrow('No mock registered for "not a stored mock"');
  });
});

describe('getMocks', () => {
  it('should retrieve all stored mocks', () => {
    const testMock1 = { getMockName: () => 'test mock 1' } as unknown as ElectronMock;
    const testMock2 = { getMockName: () => 'test mock 2' } as unknown as ElectronMock;
    const testMock3 = { getMockName: () => 'test mock 3' } as unknown as ElectronMock;
    mockStore.setMock(testMock1);
    mockStore.setMock(testMock2);
    mockStore.setMock(testMock3);
    expect(mockStore.getMocks()).toStrictEqual([
      ['test mock 1', testMock1],
      ['test mock 2', testMock2],
      ['test mock 3', testMock3],
    ]);
  });
});

describe('deleteMock', () => {
  it('should remove a specific mock from the store', () => {
    const testMock1 = { getMockName: () => 'test mock 1' } as unknown as ElectronMock;
    const testMock2 = { getMockName: () => 'test mock 2' } as unknown as ElectronMock;
    mockStore.setMock(testMock1);
    mockStore.setMock(testMock2);

    const result = mockStore.deleteMock('test mock 1');

    expect(result).toBe(true);
    expect(mockStore.getMocks()).toStrictEqual([['test mock 2', testMock2]]);
  });

  it('should return false when deleting a non-existent mock', () => {
    const result = mockStore.deleteMock('non-existent');
    expect(result).toBe(false);
  });
});

describe('clear', () => {
  it('should remove all mocks from the store', () => {
    const testMock1 = { getMockName: () => 'test mock 1' } as unknown as ElectronMock;
    const testMock2 = { getMockName: () => 'test mock 2' } as unknown as ElectronMock;
    mockStore.setMock(testMock1);
    mockStore.setMock(testMock2);

    mockStore.clear();

    expect(mockStore.getMocks()).toStrictEqual([]);
  });
});

describe('setMockWithKey', () => {
  it('should store the mock under the explicit key, not the mock name', () => {
    const testMock = { getMockName: () => 'mock name' } as unknown as ElectronMock;
    mockStore.setMockWithKey('custom-key', testMock);
    expect(mockStore.getMock('custom-key')).toBe(testMock);
  });

  it('should allow the same mock to be stored under multiple different keys', () => {
    const testMock = { getMockName: () => 'shared mock' } as unknown as ElectronMock;
    mockStore.setMockWithKey('key-a', testMock);
    mockStore.setMockWithKey('key-b', testMock);
    expect(mockStore.getMock('key-a')).toBe(testMock);
    expect(mockStore.getMock('key-b')).toBe(testMock);
  });

  it('should allow two different mocks with the same name to be stored under different keys (collision prevention)', () => {
    const mock1 = { getMockName: () => 'same-name' } as unknown as ElectronMock;
    const mock2 = { getMockName: () => 'same-name' } as unknown as ElectronMock;
    mockStore.setMockWithKey('key-instance-0', mock1);
    mockStore.setMockWithKey('key-instance-1', mock2);
    expect(mockStore.getMock('key-instance-0')).toBe(mock1);
    expect(mockStore.getMock('key-instance-1')).toBe(mock2);
  });

  it('should not be retrievable via the mock name', () => {
    const testMock = { getMockName: () => 'mock name' } as unknown as ElectronMock;
    mockStore.setMockWithKey('custom-key', testMock);
    expect(() => mockStore.getMock('mock name')).toThrow('No mock registered for "mock name"');
  });
});

describe('deleteMockByRef', () => {
  it('should delete the entry that holds the given mock reference', () => {
    const testMock = { getMockName: () => 'ref mock' } as unknown as ElectronMock;
    mockStore.setMockWithKey('composite-key', testMock);

    const result = mockStore.deleteMockByRef(testMock);

    expect(result).toBe(true);
    expect(() => mockStore.getMock('composite-key')).toThrow('No mock registered for "composite-key"');
  });

  it('should return false when the reference is not found', () => {
    const testMock = { getMockName: () => 'not stored' } as unknown as ElectronMock;
    expect(mockStore.deleteMockByRef(testMock)).toBe(false);
  });

  it('should only delete the entry matching the reference, leaving others intact', () => {
    const mock1 = { getMockName: () => 'mock 1' } as unknown as ElectronMock;
    const mock2 = { getMockName: () => 'mock 2' } as unknown as ElectronMock;
    mockStore.setMockWithKey('key-1', mock1);
    mockStore.setMockWithKey('key-2', mock2);

    mockStore.deleteMockByRef(mock1);

    expect(() => mockStore.getMock('key-1')).toThrow();
    expect(mockStore.getMock('key-2')).toBe(mock2);
  });

  it('should find the mock even when stored under a composite null-byte key', () => {
    const testMock = { getMockName: () => 'channel mock' } as unknown as ElectronMock;
    const compositeKey = `electron.get-user\x00${0}`;
    mockStore.setMockWithKey(compositeKey, testMock);

    const result = mockStore.deleteMockByRef(testMock);

    expect(result).toBe(true);
    expect(() => mockStore.getMock(compositeKey)).toThrow();
  });
});
