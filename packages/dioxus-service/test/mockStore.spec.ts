import { afterEach, describe, expect, it } from 'vitest';

import mockStore, { DioxusServiceMockStore } from '../src/mockStore.js';

function fakeMock(name: string) {
  return { getMockName: () => name } as unknown as Parameters<typeof mockStore.setMock>[1];
}

const browserA = { sessionId: 'session-a' } as unknown as WebdriverIO.Browser;
const browserB = { sessionId: 'session-b' } as unknown as WebdriverIO.Browser;

describe('DioxusServiceMockStore', () => {
  afterEach(() => {
    mockStore.clear();
  });

  it('should expose a singleton default export', () => {
    expect(mockStore).toBeInstanceOf(DioxusServiceMockStore);
  });

  it('should store and retrieve a mock by browser and name', () => {
    const m = fakeMock('dioxus.greet');
    expect(mockStore.setMock(browserA, m)).toBe(m);
    expect(mockStore.getMock(browserA, 'dioxus.greet')).toBe(m);
  });

  it('should overwrite a mock of the same name on the same browser', () => {
    const first = fakeMock('dioxus.greet');
    const second = fakeMock('dioxus.greet');
    mockStore.setMock(browserA, first);
    mockStore.setMock(browserA, second);
    expect(mockStore.getMock(browserA, 'dioxus.greet')).toBe(second);
  });

  it('should keep a mock of the same name on each browser', () => {
    const mockA = fakeMock('dioxus.greet');
    const mockB = fakeMock('dioxus.greet');
    mockStore.setMock(browserA, mockA);
    mockStore.setMock(browserB, mockB);
    expect(mockStore.getMock(browserA, 'dioxus.greet')).toBe(mockA);
    expect(mockStore.getMock(browserB, 'dioxus.greet')).toBe(mockB);
  });

  it('should throw when looking up an unregistered mock', () => {
    expect(() => mockStore.getMock(browserA, 'dioxus.missing')).toThrow('No mock registered for "dioxus.missing"');
  });

  it('should throw for a mock that only another browser has', () => {
    mockStore.setMock(browserA, fakeMock('dioxus.greet'));
    expect(() => mockStore.getMock(browserB, 'dioxus.greet')).toThrow('No mock registered for "dioxus.greet"');
  });

  it("should list only the browser's own mocks", () => {
    const a = fakeMock('dioxus.a');
    const b = fakeMock('dioxus.b');
    mockStore.setMock(browserA, a);
    mockStore.setMock(browserA, b);
    mockStore.setMock(browserB, fakeMock('dioxus.c'));
    expect(mockStore.getMocks(browserA)).toEqual([
      ['dioxus.a', a],
      ['dioxus.b', b],
    ]);
  });

  it("should list every browser's mocks", () => {
    const mockA = fakeMock('dioxus.greet');
    const mockB = fakeMock('dioxus.greet');
    mockStore.setMock(browserA, mockA);
    mockStore.setMock(browserB, mockB);
    expect(mockStore.getAllMocks()).toEqual([
      ['dioxus.greet', mockA],
      ['dioxus.greet', mockB],
    ]);
  });

  it('should delete an individual mock', () => {
    mockStore.setMock(browserA, fakeMock('dioxus.a'));
    expect(mockStore.deleteMock(browserA, 'dioxus.a')).toBe(true);
    expect(mockStore.getAllMocks()).toEqual([]);
  });

  it("should leave another browser's mock of the same name when deleting", () => {
    const mockB = fakeMock('dioxus.greet');
    mockStore.setMock(browserA, fakeMock('dioxus.greet'));
    mockStore.setMock(browserB, mockB);
    expect(mockStore.deleteMock(browserA, 'dioxus.greet')).toBe(true);
    expect(mockStore.getAllMocks()).toEqual([['dioxus.greet', mockB]]);
  });

  it('should return false when deleting a non-existent mock', () => {
    expect(mockStore.deleteMock(browserA, 'dioxus.missing')).toBe(false);
  });

  it("should clear every browser's mocks", () => {
    mockStore.setMock(browserA, fakeMock('dioxus.a'));
    mockStore.setMock(browserB, fakeMock('dioxus.b'));
    mockStore.clear();
    expect(mockStore.getAllMocks()).toEqual([]);
  });
});
