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
import { CDP_DISCONNECT_EVENT } from '../src/constants.js';

type DrivableSocket = {
  emit: (event: string, ...args: unknown[]) => boolean;
  readyState: number;
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

describe('Connection.isOpen', () => {
  beforeEach(() => {
    h.sockets.length = 0;
  });

  it('should be false before connect, true while open, and false again after close', async () => {
    const connection = new Connection('ws://127.0.0.1:9222/devtools/page/A');
    expect(connection.isOpen).toBe(false);

    const connectPromise = connection.connect();
    const ws = h.sockets.at(-1) as DrivableSocket;
    ws.emit('open');
    await connectPromise;
    expect(connection.isOpen).toBe(true);

    const closePromise = connection.close();
    ws.emit('close');
    await closePromise;
    expect(connection.isOpen).toBe(false);
  });
});

describe('Connection cdp:disconnect event', () => {
  beforeEach(() => {
    h.sockets.length = 0;
  });

  it('should emit cdp:disconnect when the WebSocket closes unexpectedly', async () => {
    const connection = new Connection('ws://127.0.0.1:9222/devtools/page/A');
    const connectPromise = connection.connect();
    const ws = h.sockets.at(-1) as DrivableSocket;
    ws.emit('open');
    await connectPromise;

    const disconnectHandler = vi.fn();
    connection.on(CDP_DISCONNECT_EVENT, disconnectHandler);

    // Simulate an unexpected close (no explicit close() call).
    ws.emit('close');

    expect(disconnectHandler).toHaveBeenCalledTimes(1);
  });

  it('should NOT emit cdp:disconnect when close() is called explicitly', async () => {
    const connection = new Connection('ws://127.0.0.1:9222/devtools/page/A');
    const connectPromise = connection.connect();
    const ws = h.sockets.at(-1) as DrivableSocket;
    ws.emit('open');
    await connectPromise;

    const disconnectHandler = vi.fn();
    connection.on(CDP_DISCONNECT_EVENT, disconnectHandler);

    const closePromise = connection.close();
    ws.emit('close');
    await closePromise;

    expect(disconnectHandler).not.toHaveBeenCalled();
  });

  it('should NOT emit cdp:disconnect when an error triggers the internal close path', async () => {
    const connection = new Connection('ws://127.0.0.1:9222/devtools/page/A');
    const connectPromise = connection.connect();
    const ws = h.sockets.at(-1) as DrivableSocket;
    ws.emit('open');
    await connectPromise;

    const disconnectHandler = vi.fn();
    connection.on(CDP_DISCONNECT_EVENT, disconnectHandler);

    // Error → internal #close() → intentional flag set before ws.close()
    ws.emit('error', new Error('boom'));
    ws.emit('close');

    // Allow microtask queue to flush (the error handler is async)
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(disconnectHandler).not.toHaveBeenCalled();
  });
});
