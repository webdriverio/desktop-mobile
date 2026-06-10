import { describe, expect, it } from 'vitest';

import { FlutterMockStore } from '../src/mockStore.js';

const fakeMock = (name: string) => ({ name }) as never;

describe('FlutterMockStore', () => {
  it('should set, get, and list mocks', () => {
    const store = new FlutterMockStore();
    const m = fakeMock('a');
    expect(store.setMock('A.b', m)).toBe(m);
    expect(store.getMock('A.b')).toBe(m);
    expect(store.getMocks()).toEqual([['A.b', m]]);
  });

  it('should return undefined for an unknown target', () => {
    expect(new FlutterMockStore().getMock('nope')).toBeUndefined();
  });

  it('should delete a mock', () => {
    const store = new FlutterMockStore();
    store.setMock('A.b', fakeMock('a'));
    expect(store.deleteMock('A.b')).toBe(true);
    expect(store.getMock('A.b')).toBeUndefined();
  });

  it('should clear all mocks', () => {
    const store = new FlutterMockStore();
    store.setMock('A.b', fakeMock('a'));
    store.setMock('C.d', fakeMock('c'));
    store.clear();
    expect(store.getMocks()).toEqual([]);
  });
});
