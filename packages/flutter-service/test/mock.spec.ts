import { describe, expect, it, vi } from 'vitest';

import { createFlutterMock } from '../src/mock.js';
import { FlutterMockStore } from '../src/mockStore.js';
import type { VmServiceClient } from '../src/vmService.js';

function makeClient() {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const client = {
    getMainIsolateId: vi.fn().mockResolvedValue('iso-1'),
    callServiceExtension: vi.fn().mockImplementation((method: string, params: Record<string, unknown>) => {
      calls.push([method, params]);
      if (method === 'ext.wdio.getCalls') {
        return Promise.resolve({
          calls: [['x']],
          results: [{ type: 'return', value: 'mocked' }],
          invocationCallOrder: [0],
        });
      }
      return Promise.resolve({ ok: true });
    }),
  } as unknown as VmServiceClient;
  return { client, calls };
}

describe('createFlutterMock', () => {
  it('should push a tagged value via ext.wdio.setMock', async () => {
    const { client, calls } = makeClient();
    const mock = await createFlutterMock('Svc.m', () => Promise.resolve(client), new FlutterMockStore());
    await mock.mockReturnValue('mocked');
    const setMock = calls.find(([method]) => method === 'ext.wdio.setMock');
    expect(setMock?.[1]).toMatchObject({ isolateId: 'iso-1', target: 'Svc.m' });
    expect(JSON.parse(setMock?.[1].value as string)).toEqual({ kind: 'return', value: 'mocked', once: false });
  });

  it('should mark a Once value', async () => {
    const { client, calls } = makeClient();
    const mock = await createFlutterMock('Svc.m', () => Promise.resolve(client), new FlutterMockStore());
    await mock.mockResolvedValueOnce('r');
    const setMock = calls.find(([method]) => method === 'ext.wdio.setMock');
    expect(JSON.parse(setMock?.[1].value as string)).toEqual({ kind: 'resolve', value: 'r', once: true });
  });

  it('update() should read call data into the outer mock', async () => {
    const { client } = makeClient();
    const mock = await createFlutterMock('Svc.m', () => Promise.resolve(client), new FlutterMockStore());
    await mock.update();
    expect(mock.mock.calls).toEqual([['x']]);
    expect(mock.mock.results).toEqual([{ type: 'return', value: 'mocked' }]);
  });

  it('should register in the store', async () => {
    const { client } = makeClient();
    const store = new FlutterMockStore();
    await createFlutterMock('Svc.m', () => Promise.resolve(client), store);
    expect(store.getMock('Svc.m')).toBeDefined();
  });

  it('mockImplementation should reject (documented Tier-2 boundary)', async () => {
    const { client } = makeClient();
    const mock = await createFlutterMock('Svc.m', () => Promise.resolve(client), new FlutterMockStore());
    await expect(mock.mockImplementation(() => undefined)).rejects.toThrow(/not supported/);
  });

  it('mockRestore should remove the mock from the store', async () => {
    const { client } = makeClient();
    const store = new FlutterMockStore();
    const mock = await createFlutterMock('Svc.m', () => Promise.resolve(client), store);
    await mock.mockRestore();
    expect(store.getMock('Svc.m')).toBeUndefined();
  });

  it('mockClear should call ext.wdio.clearMock', async () => {
    const { client, calls } = makeClient();
    const mock = await createFlutterMock('Svc.m', () => Promise.resolve(client), new FlutterMockStore());
    await mock.mockClear();
    expect(calls.some(([method]) => method === 'ext.wdio.clearMock')).toBe(true);
  });

  it('mockReset should call ext.wdio.resetMock', async () => {
    const { client, calls } = makeClient();
    const mock = await createFlutterMock('Svc.m', () => Promise.resolve(client), new FlutterMockStore());
    await mock.mockReset();
    expect(calls.some(([method]) => method === 'ext.wdio.resetMock')).toBe(true);
  });

  it('mockReturnThis should reject (documented boundary)', async () => {
    const { client } = makeClient();
    const mock = await createFlutterMock('Svc.m', () => Promise.resolve(client), new FlutterMockStore());
    await expect(mock.mockReturnThis()).rejects.toThrow(/not supported/);
  });

  it('should re-wire an existing mock onto a new connection (reconnect)', async () => {
    const store = new FlutterMockStore();
    const first = makeClient();
    const mock = await createFlutterMock('Svc.m', () => Promise.resolve(first.client), store);
    await mock.mockReturnValue('a');
    // Reconnect: a fresh client, same store/target — the outer mock identity is preserved.
    const second = makeClient();
    const rewired = await createFlutterMock('Svc.m', () => Promise.resolve(second.client), store);
    expect(rewired).toBe(mock);
    await rewired.mockReturnValue('b');
    expect(second.calls.some(([method]) => method === 'ext.wdio.setMock')).toBe(true);
  });
});
