import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClassifyTarget, Debugger } from '../src/types.js';

// Shared mutable state for the mocked DevTool/Connection (hoisted so the
// vi.mock factories can reference it).
const h = vi.hoisted(() => ({
  targets: [] as Debugger[],
  sent: [] as string[],
  failEnable: false,
  closed: 0,
  connectGate: undefined as Promise<void> | undefined,
  listGate: undefined as Promise<void> | undefined,
}));

vi.mock('../src/devTool.js', () => ({
  DevTool: class {
    list = async () => {
      if (h.listGate) {
        await h.listGate;
      }
      return h.targets;
    };
    version = async () => ({ browser: 'CEF', protocolVersion: '1.3' });
  },
}));

vi.mock('../src/connection.js', () => ({
  Connection: class {
    webSocketDebuggerUrl: string;
    constructor(url: string) {
      this.webSocketDebuggerUrl = url;
    }
    connect = async () => {
      if (h.connectGate) {
        await h.connectGate;
      }
    };
    send = async (method: string) => {
      h.sent.push(method);
      if (h.failEnable && method === 'Runtime.enable') {
        throw new Error('Runtime.enable failed');
      }
      return {};
    };
    on = () => this;
    close = async () => {
      h.closed++;
    };
  },
}));

import { MultiTargetCdpBridge, type MultiTargetCdpBridgeOptions } from '../src/multiTargetBridge.js';

const classify: ClassifyTarget = (t) => {
  if (t.type !== 'page') {
    return 'other';
  }
  const url = t.url ?? '';
  if (url === '' || url === 'about:blank') {
    return 'shell';
  }
  return 'content';
};

const makeBridge = (opts: Partial<MultiTargetCdpBridgeOptions> = {}) =>
  new MultiTargetCdpBridge({ classifyTarget: classify, ...opts });

const target = (id: string, url: string): Debugger => ({
  id,
  url,
  type: 'page',
  title: `title-${id}`,
  description: '',
  devtoolsFrontendUrl: '',
  devtoolsFrontendUrlCompat: '',
  faviconUrl: '',
  webSocketDebuggerUrl: `ws://localhost:9222/devtools/page/${id}`,
});

beforeEach(() => {
  h.targets = [];
  h.sent.length = 0;
  h.failEnable = false;
  h.closed = 0;
  h.connectGate = undefined;
  h.listGate = undefined;
});

describe('MultiTargetCdpBridge multi-target routing', () => {
  it('should attach to the main target on connect and enable Runtime but never navigate', async () => {
    h.targets = [target('A', 'views://mainview/index.html'), target('B', 'views://secondview/index.html')];
    const bridge = makeBridge();
    await bridge.connect();

    expect(bridge.activeLabel).toBe('main');
    expect(bridge.listWindows()).toEqual(['main', 'window-1']);
    expect(h.sent).toContain('Runtime.enable');
    expect(h.sent).not.toContain('Page.navigate');
  });

  it('should close the freshly opened connection when Runtime.enable fails', async () => {
    h.targets = [target('A', 'views://mainview/index.html')];
    h.failEnable = true;
    const bridge = makeBridge({ connectionRetryCount: 0, waitInterval: 1 });

    await expect(bridge.connect()).rejects.toThrow('Runtime.enable failed');
    expect(h.closed).toBe(1);
  });

  it('should refuse connect() after close()', async () => {
    h.targets = [target('A', 'views://mainview/index.html')];
    const bridge = makeBridge();
    await bridge.connect();
    await bridge.close();

    await expect(bridge.connect()).rejects.toThrow(/closed/);
  });

  it('should refuse switchTarget() after close() (no re-opened sockets)', async () => {
    h.targets = [target('A', 'views://mainview/index.html'), target('B', 'views://secondview/index.html')];
    const bridge = makeBridge();
    await bridge.connect();
    await bridge.close();

    await expect(bridge.switchTarget('window-1')).rejects.toThrow(/closed/);
  });

  it('should refuse refresh() after close()', async () => {
    h.targets = [target('A', 'views://mainview/index.html')];
    const bridge = makeBridge();
    await bridge.connect();
    await bridge.close();

    await expect(bridge.refresh()).rejects.toThrow(/closed/);
  });

  it('should refuse refresh() when close() races the list() await', async () => {
    h.targets = [target('A', 'views://mainview/index.html')];
    const bridge = makeBridge();
    await bridge.connect();

    let release: () => void = () => {};
    h.listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refreshing = bridge.refresh();
    refreshing.catch(() => {});

    await bridge.close();
    release();

    // The entry guard passed before close(); the post-await re-check must still
    // reject rather than return a populated list on the torn-down bridge.
    await expect(refreshing).rejects.toThrow(/closed/);
  });

  it('should refuse connect() and leave no stale active target when close() races discovery', async () => {
    h.targets = [target('A', 'views://mainview/index.html')];
    let release: () => void = () => {};
    h.listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bridge = makeBridge();
    const connecting = bridge.connect();
    connecting.catch(() => {});

    await bridge.close();
    release();

    // Without the post-discovery guard, connect() would commit #activeLabel from
    // the discovered targets, so a later send() throws NOT_CONNECTED, not BRIDGE_CLOSED.
    await expect(connecting).rejects.toThrow(/closed/);
    expect(bridge.activeLabel).toBeUndefined();
  });

  it('should not orphan a socket when two #ensureConnection calls race the same label', async () => {
    h.targets = [target('A', 'views://mainview/index.html'), target('B', 'views://secondview/index.html')];
    const bridge = makeBridge();
    await bridge.connect();

    // Gate the next connection.connect() so both switches reach the lazy-connect
    // path before either has stored — the concurrent same-label race.
    let release: () => void = () => {};
    h.connectGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const a = bridge.switchTarget('window-1');
    const b = bridge.switchTarget('window-1');
    release();
    await Promise.all([a, b]);

    // Both opened a socket; exactly one is stored and the loser is closed (not
    // orphaned). Without the winner check, h.closed would be 0 and a socket leaks.
    expect(bridge.activeLabel).toBe('window-1');
    expect(h.closed).toBe(1);
    await expect(bridge.send('Runtime.enable')).resolves.toBeDefined();
  });

  it('should not store a socket opened while close() raced #ensureConnection', async () => {
    h.targets = [target('A', 'views://mainview/index.html'), target('B', 'views://secondview/index.html')];
    const bridge = makeBridge();
    await bridge.connect();

    let release: () => void = () => {};
    h.connectGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const switching = bridge.switchTarget('window-1');
    switching.catch(() => {});

    await bridge.close();
    release();

    // Without the post-await guard, switchTarget would resolve and store the
    // window-1 socket into the already-cleared #connections map (orphaned).
    await expect(switching).rejects.toThrow(/closed/);
    // main closed by close(), window-1 closed by the guard — neither leaks.
    expect(h.closed).toBe(2);
  });

  it('should connect the auto-advanced target when the active window closes', async () => {
    h.targets = [target('A', 'views://mainview/index.html')];
    const bridge = makeBridge();
    await bridge.connect();

    h.targets = [target('A', 'views://mainview/index.html'), target('B', 'views://secondview/index.html')];
    await bridge.refresh();

    h.targets = [target('B', 'views://secondview/index.html')];
    await bridge.refresh();

    expect(bridge.activeLabel).toBe('window-1');
    await expect(bridge.send('Runtime.enable')).resolves.toBeDefined();
  });

  it('should switch the active target without navigating', async () => {
    h.targets = [target('A', 'views://mainview/index.html'), target('B', 'views://secondview/index.html')];
    const bridge = makeBridge();
    await bridge.connect();

    await bridge.switchTarget('window-1');

    expect(bridge.activeLabel).toBe('window-1');
    expect(h.sent).not.toContain('Page.navigate');
  });

  it('should expose live content targets via listTargets', async () => {
    h.targets = [target('A', 'views://mainview/index.html'), target('B', 'views://secondview/index.html')];
    const bridge = makeBridge();
    await bridge.connect();

    const labels = bridge.listTargets().map((entry) => entry.label);
    expect(labels).toEqual(['main', 'window-1']);
  });

  it('should reject switching to an unknown label', async () => {
    h.targets = [target('A', 'views://mainview/index.html')];
    const bridge = makeBridge();
    await bridge.connect();

    await expect(bridge.switchTarget('window-9')).rejects.toThrow();
  });

  it('should send a command to a specific target via sendTo', async () => {
    h.targets = [target('A', 'views://mainview/index.html'), target('B', 'views://secondview/index.html')];
    const bridge = makeBridge();
    await bridge.connect();

    await expect(bridge.sendTo('window-1', 'Runtime.evaluate')).resolves.toBeDefined();
    expect(h.sent).toContain('Runtime.evaluate');
  });

  it('should throw when no content targets are discovered', async () => {
    h.targets = [target('A', 'about:blank')];
    const bridge = makeBridge({ connectionRetryCount: 0 });

    await expect(bridge.connect()).rejects.toThrow();
  });

  it('should auto-advance the active target when the active window is pruned on refresh', async () => {
    h.targets = [target('A', 'views://mainview/index.html'), target('B', 'views://secondview/index.html')];
    const bridge = makeBridge();
    await bridge.connect();
    expect(bridge.activeLabel).toBe('main');

    h.targets = [target('B', 'views://secondview/index.html')];
    await bridge.refresh();

    expect(bridge.activeLabel).toBe('window-1');
  });

  it('should clear the active target when all targets disappear on refresh', async () => {
    h.targets = [target('A', 'views://mainview/index.html')];
    const bridge = makeBridge();
    await bridge.connect();

    h.targets = [];
    await bridge.refresh();

    expect(bridge.activeLabel).toBeUndefined();
  });
});
