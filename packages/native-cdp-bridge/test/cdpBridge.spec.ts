import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Debugger } from '../src/types.js';

const h = vi.hoisted(() => ({
  targets: [] as Debugger[],
  ctors: [] as Array<{ url: string; opts: unknown }>,
  sent: [] as string[],
  closeGate: undefined as Promise<void> | undefined,
}));

vi.mock('../src/devTool.js', () => ({
  DevTool: class {
    list = async () => h.targets;
    version = async () => ({ browser: 'Hermes', protocolVersion: '1.3' });
  },
}));

vi.mock('../src/connection.js', () => ({
  Connection: class {
    constructor(url: string, opts: unknown) {
      h.ctors.push({ url, opts });
    }
    connect = async () => {};
    send = async (method: string) => {
      h.sent.push(method);
      return { result: { value: 'ok' } };
    };
    on = () => this;
    close = async () => {
      if (h.closeGate) {
        await h.closeGate;
      }
    };
    state = 1;
  },
}));

import { CdpBridge } from '../src/cdpBridge.js';

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
