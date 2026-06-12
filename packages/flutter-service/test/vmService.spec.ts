import { beforeEach, describe, expect, it, vi } from 'vitest';

// A minimal fake `ws` WebSocket — hoisted so the vi.mock factory can reference it.
const { instances, FakeWs } = vi.hoisted(() => {
  const instances: FakeWebSocket[] = [];
  class FakeWebSocket {
    static OPEN = 1;
    readyState = 1;
    url: string;
    sent: string[] = [];
    #handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    constructor(url: string) {
      this.url = url;
      instances.push(this);
      setTimeout(() => this.emit('open'), 0);
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.#handlers[event] ??= [];
      this.#handlers[event].push(fn);
      return this;
    }
    once(event: string, fn: (...args: unknown[]) => void) {
      const wrap = (...args: unknown[]) => {
        this.off(event, wrap);
        fn(...args);
      };
      return this.on(event, wrap);
    }
    off(event: string, fn: (...args: unknown[]) => void) {
      this.#handlers[event] = (this.#handlers[event] ?? []).filter((h) => h !== fn);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const h of [...(this.#handlers[event] ?? [])]) {
        h(...args);
      }
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.readyState = 3;
      this.emit('close');
    }
  }
  return { instances, FakeWs: FakeWebSocket };
});
vi.mock('ws', () => ({ default: FakeWs }));

import { VmServiceClient } from '../src/vmService.js';

type FakeWebSocket = { sent: string[]; emit: (event: string, ...args: unknown[]) => void };

/** Respond to the Nth RPC the client sent (waits for it to be sent first). */
async function answerRpc(ws: FakeWebSocket, index: number, result: unknown): Promise<void> {
  while (ws.sent.length <= index) {
    await new Promise((r) => setTimeout(r, 0));
  }
  ws.emit('message', JSON.stringify({ id: JSON.parse(ws.sent[index]).id, result }));
}

describe('VmServiceClient', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('should connect and report connected', async () => {
    const client = new VmServiceClient('ws://x/ws');
    await client.connect();
    expect(client.connected).toBe(true);
  });

  it('should reject an rpc when not connected', async () => {
    await expect(new VmServiceClient('ws://x/ws').rpc('getVM')).rejects.toThrow(/not connected/);
  });

  it('should resolve an rpc when a matching response arrives', async () => {
    const client = new VmServiceClient('ws://x/ws');
    await client.connect();
    const p = client.getVM();
    await answerRpc(instances[0], 0, { isolates: [{ id: 'iso' }] });
    expect(await p).toEqual({ isolates: [{ id: 'iso' }] });
  });

  it('getMainIsolateId should return the first isolate id', async () => {
    const client = new VmServiceClient('ws://x/ws');
    await client.connect();
    const p = client.getMainIsolateId();
    await answerRpc(instances[0], 0, { isolates: [{ id: 'iso-9' }] });
    expect(await p).toBe('iso-9');
  });

  it('getMainIsolateId should prefer the isolate named main over positional order', async () => {
    const client = new VmServiceClient('ws://x/ws');
    await client.connect();
    const p = client.getMainIsolateId();
    await answerRpc(instances[0], 0, {
      isolates: [
        { id: 'iso-worker', name: 'worker' },
        { id: 'iso-main', name: 'main' },
      ],
    });
    expect(await p).toBe('iso-main');
  });

  it('resolveRootLibrary should chain getVM + getIsolate', async () => {
    const client = new VmServiceClient('ws://x/ws');
    await client.connect();
    const p = client.resolveRootLibrary();
    await answerRpc(instances[0], 0, { isolates: [{ id: 'iso' }] });
    await answerRpc(instances[0], 1, { rootLib: { id: 'root' } });
    expect(await p).toEqual({ isolateId: 'iso', rootLibraryId: 'root' });
  });

  it('should reject an rpc on a JSON-RPC error', async () => {
    const client = new VmServiceClient('ws://x/ws');
    await client.connect();
    const ws = instances[0];
    const p = client.rpc('bad');
    while (ws.sent.length === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
    ws.emit('message', JSON.stringify({ id: JSON.parse(ws.sent[0]).id, error: 'nope' }));
    await expect(p).rejects.toThrow(/nope/);
  });

  it('close() should mark the client not connected', async () => {
    const client = new VmServiceClient('ws://x/ws');
    await client.connect();
    await client.close();
    expect(client.connected).toBe(false);
  });
});
