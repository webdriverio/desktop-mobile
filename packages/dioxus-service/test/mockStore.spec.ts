import { afterEach, describe, expect, it } from 'vitest';

import mockStore, { DioxusServiceMockStore } from '../src/mockStore.js';

function fakeMock(name: string) {
  return { getMockName: () => name } as unknown as Parameters<typeof mockStore.setMock>[0];
}

describe('DioxusServiceMockStore', () => {
  afterEach(() => {
    mockStore.clear();
  });

  it('should expose a singleton default export', () => {
    expect(mockStore).toBeInstanceOf(DioxusServiceMockStore);
  });

  it('should store and retrieve a mock by name', () => {
    const m = fakeMock('dioxus.greet');
    mockStore.setMock(m);
    expect(mockStore.getMock('dioxus.greet')).toBe(m);
  });

  it('should throw when looking up an unregistered mock', () => {
    expect(() => mockStore.getMock('dioxus.missing')).toThrow(/No mock registered/);
  });

  it('should list all registered mocks', () => {
    mockStore.setMock(fakeMock('dioxus.a'));
    mockStore.setMock(fakeMock('dioxus.b'));
    expect(
      mockStore
        .getMocks()
        .map(([n]) => n)
        .sort(),
    ).toEqual(['dioxus.a', 'dioxus.b']);
  });

  it('should delete an individual mock', () => {
    mockStore.setMock(fakeMock('dioxus.a'));
    expect(mockStore.deleteMock('dioxus.a')).toBe(true);
    expect(mockStore.getMocks()).toEqual([]);
  });

  it('should return false when deleting a non-existent mock', () => {
    expect(mockStore.deleteMock('dioxus.missing')).toBe(false);
  });

  it('should clear all mocks', () => {
    mockStore.setMock(fakeMock('dioxus.a'));
    mockStore.setMock(fakeMock('dioxus.b'));
    mockStore.clear();
    expect(mockStore.getMocks()).toEqual([]);
  });
});
