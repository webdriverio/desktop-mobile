import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Debugger } from '../src/types.js';

const h = vi.hoisted(() => ({
  targets: [] as Debugger[],
  ctors: [] as Array<{ url: string; opts: unknown }>,
  sent: [] as string[],
  closeGate: undefined as Promise<void> | undefined,
  // Allows tests to fire the cdp:disconnect event on the last created Connection
  disconnectHandlers: [] as Array<() => void>,
  // Tracks CDP method listeners registered on each connection so tests can fire them.
  // Index matches ctors: connections[i] holds the listeners for the i-th Connection.
  cdpMethodListeners: [] as Array<Map<string, Set<(...args: unknown[]) => void>>>,
  // Tracks which listeners were removed via off() on each Connection.
  removedListeners: [] as Array<Array<{ event: string; listener: (...args: unknown[]) => void }>>,
}));

vi.mock('../src/devTool.js', () => ({
  DevTool: class {
    list = async () => h.targets;
    version = async () => ({ browser: 'Hermes', protocolVersion: '1.3' });
  },
}));

vi.mock('../src/connection.js', async () => {
  const { CDP_DISCONNECT_EVENT } = await import('../src/constants.js');
  return {
    Connection: class {
      isOpen = true;
      #methodListeners = new Map<string, Set<(...args: unknown[]) => void>>();
      #removed: Array<{ event: string; listener: (...args: unknown[]) => void }> = [];
      constructor(url: string, opts: unknown) {
        h.ctors.push({ url, opts });
        h.cdpMethodListeners.push(this.#methodListeners);
        h.removedListeners.push(this.#removed);
      }
      connect = async () => {};
      send = async (method: string) => {
        h.sent.push(method);
        return { result: { value: 'ok' } };
      };
      on = (event: string, listener: (...args: unknown[]) => void) => {
        if (event === CDP_DISCONNECT_EVENT) {
          h.disconnectHandlers.push(listener as () => void);
        } else {
          let set = this.#methodListeners.get(event);
          if (!set) {
            set = new Set();
            this.#methodListeners.set(event, set);
          }
          set.add(listener);
        }
        return this;
      };
      off = (event: string, listener: (...args: unknown[]) => void) => {
        this.#removed.push({ event, listener });
        this.#methodListeners.get(event)?.delete(listener);
        return this;
      };
      close = async () => {
        if (h.closeGate) {
          await h.closeGate;
        }
      };
      state = 1;
    },
  };
});

import { CdpBridge } from '../src/cdpBridge.js';
import { CDP_DISCONNECT_EVENT } from '../src/constants.js';

const target = (id: string, url: string, ws = `ws://localhost:8081/inspector/debug?page=${id}`): Debugger => ({
  id,
  url,
  type: 'page',
  title: id,
  description: '',
  devtoolsFrontendUrl: '',
  devtoolsFrontendUrlCompat: '',
  faviconUrl: '',
  webSocketDebuggerUrl: ws,
});

beforeEach(() => {
  h.targets = [];
  h.ctors.length = 0;
  h.sent.length = 0;
  h.closeGate = undefined;
  h.disconnectHandlers.length = 0;
  h.cdpMethodListeners.length = 0;
  h.removedListeners.length = 0;
});

describe('CdpBridge (single-target)', () => {
  it('should connect to the first target with a webSocketDebuggerUrl by default', async () => {
    h.targets = [target('A', 'http://app/a'), target('B', 'http://app/b')];
    const bridge = new CdpBridge({ port: 8081 });
    await bridge.connect();
    expect(h.ctors).toHaveLength(1);
    expect(h.ctors[0].url).toContain('page=A');
  });

  it('should honour a custom selectTarget (e.g. the live Hermes target)', async () => {
    h.targets = [target('A', 'http://app/a'), target('B', 'http://app/b')];
    const bridge = new CdpBridge({ selectTarget: (list) => list.find((t) => t.id === 'B') });
    await bridge.connect();
    expect(h.ctors[0].url).toContain('page=B');
  });

  it('should pass the origin header through to the Connection', async () => {
    h.targets = [target('A', 'http://app/a')];
    const bridge = new CdpBridge({ origin: 'http://localhost:8081' });
    await bridge.connect();
    expect((h.ctors[0].opts as { origin?: string }).origin).toBe('http://localhost:8081');
  });

  it('should throw NOT_CONNECTED when send() is called before connect()', () => {
    const bridge = new CdpBridge();
    expect(() => bridge.send('Runtime.evaluate')).toThrow();
  });

  it('should reject when no target exposes a webSocketDebuggerUrl', async () => {
    h.targets = [{ ...target('A', 'http://app/a'), webSocketDebuggerUrl: '' }];
    const bridge = new CdpBridge({ connectionRetryCount: 0, waitInterval: 1 });
    await expect(bridge.connect()).rejects.toThrow();
  });

  it('should send after connect and proxy the result', async () => {
    h.targets = [target('A', 'http://app/a')];
    const bridge = new CdpBridge();
    await bridge.connect();
    await expect(bridge.send('Runtime.evaluate')).resolves.toBeDefined();
    expect(h.sent).toContain('Runtime.evaluate');
  });

  it('should refuse connect() after close() (no orphaned socket)', async () => {
    h.targets = [target('A', 'http://app/a')];
    const bridge = new CdpBridge();
    await bridge.connect();
    await bridge.close();
    await expect(bridge.connect()).rejects.toThrow(/closed/i);
  });

  it('should refuse connect() during an in-progress close() (closed before #connection nulled)', async () => {
    h.targets = [target('A', 'http://app/a')];
    const bridge = new CdpBridge();
    await bridge.connect();

    // Hold the close handshake so #closed is set but #connection is not yet nulled.
    let release: () => void = () => {};
    h.closeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closing = bridge.close();

    // In this window the old #connection-first ordering returned "success" on a
    // tearing-down bridge; the #closed-first ordering must reject instead.
    await expect(bridge.connect()).rejects.toThrow(/closed/i);

    release();
    await closing;
  });
});

describe('CdpBridge cdp:disconnect event and self-healing', () => {
  it('should emit cdp:disconnect on the bridge when the Connection drops unexpectedly', async () => {
    h.targets = [target('A', 'http://app/a')];
    const bridge = new CdpBridge();
    await bridge.connect();

    const disconnectHandler = vi.fn();
    bridge.on(CDP_DISCONNECT_EVENT, disconnectHandler);

    // Simulate the Connection emitting its own cdp:disconnect (unexpected drop)
    expect(h.disconnectHandlers).toHaveLength(1);
    h.disconnectHandlers[0]();

    expect(disconnectHandler).toHaveBeenCalledTimes(1);
  });

  it('should null out the dead connection on disconnect so the next connect() re-establishes', async () => {
    h.targets = [target('A', 'http://app/a')];
    const bridge = new CdpBridge();
    await bridge.connect();
    expect(h.ctors).toHaveLength(1);

    // Trigger the unexpected disconnect handler registered by the bridge.
    h.disconnectHandlers[0]();

    // Now connect() should be callable again (re-discovers and opens a new socket).
    await bridge.connect();
    expect(h.ctors).toHaveLength(2);
  });

  it('should allow subscribing to cdp:disconnect before connect()', () => {
    // cdp:disconnect lives on the bridge itself (EventEmitter), not on a Connection,
    // so subscribing before connect() must not throw.
    const bridge = new CdpBridge();
    expect(() => bridge.on(CDP_DISCONNECT_EVENT, () => {})).not.toThrow();
  });
});

describe('CdpBridge CDP listener registry (reconnect survival + off)', () => {
  it('should replay CDP method listeners onto the new connection after reconnect', async () => {
    h.targets = [target('A', 'http://app/a')];
    const bridge = new CdpBridge();
    await bridge.connect();

    const listener = vi.fn();
    bridge.on('Runtime.consoleAPICalled', listener);

    // Listener is registered on the first connection.
    expect(h.cdpMethodListeners[0].get('Runtime.consoleAPICalled')?.has(listener)).toBe(true);

    // Simulate an unexpected drop — the bridge emits cdp:disconnect and the
    // consumer is expected to call connect() again to re-establish.
    h.disconnectHandlers[0]();
    await bridge.connect();

    // A second connection was created.
    expect(h.ctors).toHaveLength(2);
    // The listener was replayed onto the new connection by connect().
    expect(h.cdpMethodListeners[1].get('Runtime.consoleAPICalled')?.has(listener)).toBe(true);
  });

  it('should remove listener from registry and connection when off() is called', async () => {
    h.targets = [target('A', 'http://app/a')];
    const bridge = new CdpBridge();
    await bridge.connect();

    const listener = vi.fn();
    bridge.on('Runtime.consoleAPICalled', listener);
    bridge.off('Runtime.consoleAPICalled', listener);

    // Removed from the active connection.
    expect(h.removedListeners[0]).toContainEqual({ event: 'Runtime.consoleAPICalled', listener });
    // Reconnect must not replay the off'd listener.
    h.disconnectHandlers[0]();
    await bridge.connect();
    expect(h.ctors).toHaveLength(2);
    expect(h.cdpMethodListeners[1].get('Runtime.consoleAPICalled')?.has(listener)).toBeFalsy();
  });

  it('should be a no-op to call off() when not connected', () => {
    const bridge = new CdpBridge();
    expect(() => bridge.off('Runtime.consoleAPICalled', () => {})).not.toThrow();
  });
});
