import { beforeEach, describe, expect, it, vi } from 'vitest';

// Registry of mock sockets so tests can drive the ws lifecycle (open/error/close)
// manually — the close() mock only moves readyState to CLOSING; the test decides
// when the 'close' event actually fires, which is what the race below needs.
const h = vi.hoisted(() => ({ sockets: [] as unknown[] }));

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = MockWebSocket.OPEN;
    constructor(..._args: unknown[]) {
      super();
      h.sockets.push(this);
    }
    send(_data: string) {}
    close() {
      this.readyState = 2; // CLOSING — 'close' is emitted by the test
    }
  }
  return { default: MockWebSocket };
});

import { Connection } from '../src/connection.js';

type DrivableSocket = {
  emit: (event: string, ...args: unknown[]) => boolean;
};

describe('Connection close-reason handling', () => {
  beforeEach(() => {
    h.sockets.length = 0;
  });

  it('should keep the first close reason when a plain close() races an error close', async () => {
    const connection = new Connection('ws://127.0.0.1:9222/devtools/page/A');
    const connectPromise = connection.connect();
    const ws = h.sockets.at(-1) as DrivableSocket;
    ws.emit('open');
    await connectPromise;

    const pending = connection.send('Runtime.enable');
    pending.catch(() => {}); // settled later — avoid an unhandled-rejection blip

    // Error-path close sets the reason; the racing plain close() must not blank
    // it before the single 'close' event rejects the pending promises.
    ws.emit('error', new Error('boom'));
    const closePromise = connection.close();
    ws.emit('close');
    await closePromise;

    await expect(pending).rejects.toThrow(/boom/);
  });
});
