import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ElectronAdapter } from '../../src/interceptor/electron.js';
import { createIpcInterceptor } from '../../src/interceptor/index.js';

function runInBrowserContext(script: string, windowProps: Record<string, unknown> = {}) {
  const window: Record<string, unknown> = { ...windowProps };
  const ctx = vm.createContext({ window, Promise });
  vm.runInContext(script, ctx);
  return window;
}

describe('ElectronAdapter.buildBrowserIpcInjectionScript', () => {
  const adapter = new ElectronAdapter();

  it('should set window.__wdio_spy__ with a fn factory', () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    expect(typeof (window.__wdio_spy__ as Record<string, unknown>)?.fn).toBe('function');
  });

  it('should preserve an existing __wdio_spy__ across re-injection', () => {
    const existingFn = (): unknown => 'existing';
    const window: Record<string, unknown> = { __wdio_spy__: { fn: existingFn } };
    const ctx = vm.createContext({ window, Promise });
    vm.runInContext(adapter.buildBrowserIpcInjectionScript(), ctx);
    expect((window.__wdio_spy__ as { fn: unknown }).fn).toBe(existingFn);
  });

  it('should create window.__wdio_mocks__ if absent', () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    expect(window.__wdio_mocks__).toEqual({});
  });

  it('should not overwrite existing window.__wdio_mocks__', () => {
    const existing = { 'my-channel': () => {} };
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script, { __wdio_mocks__: existing });
    expect(window.__wdio_mocks__).toBe(existing);
  });

  it('should create window.electron.ipcRenderer if absent', () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    const ipcRenderer = (window.electron as Record<string, unknown>)?.ipcRenderer as Record<string, unknown>;
    expect(typeof ipcRenderer?.invoke).toBe('function');
    expect(typeof ipcRenderer?.send).toBe('function');
    expect(typeof ipcRenderer?.sendSync).toBe('function');
  });

  it('should preserve existing window.electron object and only patch ipcRenderer', () => {
    const existingElectron = { other: 'value' };
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script, { electron: existingElectron });
    const electron = window.electron as Record<string, unknown>;
    expect(electron.other).toBe('value');
    const ipcRenderer = electron.ipcRenderer as Record<string, unknown>;
    expect(typeof ipcRenderer?.invoke).toBe('function');
  });

  it('should reject with error for unmocked invoke calls', async () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    const ipcRenderer = (window.electron as Record<string, unknown>).ipcRenderer as Record<string, unknown>;
    const invoke = ipcRenderer.invoke as (channel: string, ...args: unknown[]) => Promise<unknown>;
    await expect(invoke('unknown-channel')).rejects.toThrow(
      'unmocked Electron IPC channel in browser mode: unknown-channel',
    );
  });

  it('should route invoke to window.__wdio_mocks__[channel] when registered', async () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    (window.__wdio_mocks__ as Record<string, unknown>)['get-data'] = (x: unknown) => `result:${x}`;
    const ipcRenderer = (window.electron as Record<string, unknown>).ipcRenderer as Record<string, unknown>;
    const invoke = ipcRenderer.invoke as (channel: string, ...args: unknown[]) => Promise<unknown>;
    await expect(invoke('get-data', 'hello')).resolves.toBe('result:hello');
  });

  it('should spread args to the registered mock', async () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    let capturedArgs: unknown[];
    (window.__wdio_mocks__ as Record<string, unknown>)['multi-arg'] = (...args: unknown[]) => {
      capturedArgs = args;
      return 'ok';
    };
    const ipcRenderer = (window.electron as Record<string, unknown>).ipcRenderer as Record<string, unknown>;
    const invoke = ipcRenderer.invoke as (channel: string, ...args: unknown[]) => Promise<unknown>;
    await invoke('multi-arg', 'a', 'b', 'c');
    expect(capturedArgs!).toEqual(['a', 'b', 'c']);
  });

  it('should throw synchronously for send on unmocked channels', () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    const ipcRenderer = (window.electron as Record<string, unknown>).ipcRenderer as Record<string, unknown>;
    const send = ipcRenderer.send as (channel: string) => void;
    expect(() => send('some-channel')).toThrow('unmocked Electron IPC channel in browser mode: some-channel');
  });

  it('should throw synchronously for sendSync on unmocked channels', () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    const ipcRenderer = (window.electron as Record<string, unknown>).ipcRenderer as Record<string, unknown>;
    const sendSync = ipcRenderer.sendSync as (channel: string) => void;
    expect(() => sendSync('sync-channel')).toThrow('unmocked Electron IPC channel in browser mode: sync-channel');
  });

  it('should throw with a clear message when a sendSync mock returns a Promise', () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    const spy = (window.__wdio_spy__ as { fn: () => { mockResolvedValue: (v: unknown) => unknown } }).fn;
    const mock = spy();
    (mock as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue('value');
    (window.__wdio_mocks__ as Record<string, unknown>)['sync-channel'] = mock;

    const ipcRenderer = (window.electron as Record<string, unknown>).ipcRenderer as Record<string, unknown>;
    const sendSync = ipcRenderer.sendSync as (channel: string) => unknown;
    expect(() => sendSync('sync-channel')).toThrow(/sendSync is synchronous/);
    expect(() => sendSync('sync-channel')).toThrow(/sync-channel/);
  });

  it('should return the unwrapped value when a sendSync mock returns synchronously', () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    const spy = (window.__wdio_spy__ as { fn: () => { mockReturnValue: (v: unknown) => unknown } }).fn;
    const mock = spy();
    (mock as { mockReturnValue: (v: unknown) => void }).mockReturnValue(42);
    (window.__wdio_mocks__ as Record<string, unknown>)['sync-channel'] = mock;

    const ipcRenderer = (window.electron as Record<string, unknown>).ipcRenderer as Record<string, unknown>;
    const sendSync = ipcRenderer.sendSync as (channel: string) => unknown;
    expect(sendSync('sync-channel')).toBe(42);
  });

  describe('events', () => {
    type Listener = (event: unknown, ...args: unknown[]) => void;
    type IpcRenderer = Record<string, unknown> & {
      on: (c: string, fn: Listener) => unknown;
      once: (c: string, fn: Listener) => unknown;
      off: (c: string, fn: Listener) => unknown;
      removeListener: (c: string, fn: Listener) => unknown;
      removeAllListeners: (c?: string) => unknown;
      addListener: (c: string, fn: Listener) => unknown;
    };

    function setupWindow() {
      const script = adapter.buildBrowserIpcInjectionScript();
      const window = runInBrowserContext(script);
      const ipcRenderer = (window.electron as Record<string, unknown>).ipcRenderer as IpcRenderer;
      const emit = window.__wdio_emit_electron_event__ as (channel: string, ...args: unknown[]) => void;
      return { window, ipcRenderer, emit };
    }

    it('should register on() and fire listeners with a synthetic IpcRendererEvent', () => {
      const { ipcRenderer, emit } = setupWindow();
      const calls: unknown[][] = [];
      ipcRenderer.on('did-update-info', (...args) => calls.push(args));
      emit('did-update-info', { count: 1 }, 'extra');
      expect(calls).toHaveLength(1);
      const [event, payload, extra] = calls[0] as [Record<string, unknown>, unknown, unknown];
      expect(event).toMatchObject({ ports: [], senderId: 0 });
      expect(event.sender).toBe(ipcRenderer);
      expect(payload).toEqual({ count: 1 });
      expect(extra).toBe('extra');
    });

    it('should self-remove once() listeners after firing', () => {
      const { ipcRenderer, emit } = setupWindow();
      const calls: unknown[][] = [];
      ipcRenderer.once('ping', (...args) => calls.push(args));
      emit('ping', 1);
      emit('ping', 2);
      expect(calls).toHaveLength(1);
    });

    it('should remove only the specific listener with removeListener', () => {
      const { ipcRenderer, emit } = setupWindow();
      const a: unknown[] = [];
      const b: unknown[] = [];
      const fnA: Listener = (..._args) => a.push(_args);
      const fnB: Listener = (..._args) => b.push(_args);
      ipcRenderer.on('ev', fnA);
      ipcRenderer.on('ev', fnB);
      ipcRenderer.removeListener('ev', fnA);
      emit('ev', 'payload');
      expect(a).toHaveLength(0);
      expect(b).toHaveLength(1);
    });

    it('should expose off as an alias for removeListener', () => {
      const { ipcRenderer, emit } = setupWindow();
      const calls: unknown[][] = [];
      const fn: Listener = (..._args) => calls.push(_args);
      ipcRenderer.on('ev', fn);
      ipcRenderer.off('ev', fn);
      emit('ev', 1);
      expect(calls).toHaveLength(0);
    });

    it('should clear a single channel with removeAllListeners(channel)', () => {
      const { ipcRenderer, emit } = setupWindow();
      const a: unknown[][] = [];
      const b: unknown[][] = [];
      ipcRenderer.on('keep', (...args) => b.push(args));
      ipcRenderer.on('drop', (...args) => a.push(args));
      ipcRenderer.on('drop', (...args) => a.push(args));
      ipcRenderer.removeAllListeners('drop');
      emit('drop', 1);
      emit('keep', 2);
      expect(a).toHaveLength(0);
      expect(b).toHaveLength(1);
    });

    it('should clear every channel with removeAllListeners() (no arg)', () => {
      const { ipcRenderer, emit } = setupWindow();
      const calls: unknown[][] = [];
      ipcRenderer.on('one', (...args) => calls.push(args));
      ipcRenderer.on('two', (...args) => calls.push(args));
      ipcRenderer.removeAllListeners();
      emit('one', 1);
      emit('two', 2);
      expect(calls).toHaveLength(0);
    });

    it('should be a no-op when emitting on a channel with no listeners', () => {
      const { emit } = setupWindow();
      expect(() => emit('nobody-listening', 1)).not.toThrow();
    });

    it('should not let one listener error block the rest', () => {
      const { ipcRenderer, emit } = setupWindow();
      const called: unknown[][] = [];
      ipcRenderer.on('ev', () => {
        throw new Error('boom');
      });
      ipcRenderer.on('ev', (...args) => called.push(args));
      emit('ev', 1);
      expect(called).toHaveLength(1);
    });

    it('should be chainable: on() and off() return ipcRenderer', () => {
      const { ipcRenderer } = setupWindow();
      expect(ipcRenderer.on('x', () => {})).toBe(ipcRenderer);
      expect(ipcRenderer.once('x', () => {})).toBe(ipcRenderer);
      expect(ipcRenderer.off('x', () => {})).toBe(ipcRenderer);
      expect(ipcRenderer.removeAllListeners('x')).toBe(ipcRenderer);
    });

    it('should expose addListener as an alias for on', () => {
      const { ipcRenderer, emit } = setupWindow();
      const calls: unknown[][] = [];
      ipcRenderer.addListener('ev', (...args) => calls.push(args));
      emit('ev', 'payload');
      expect(calls).toHaveLength(1);
    });
  });

  describe('fn()', () => {
    it('should create a mock with empty call history', () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      const window = runInBrowserContext(script);
      const spy = window.__wdio_spy__ as Record<string, unknown>;
      const mockFn = (spy.fn as () => Record<string, unknown>)();
      const mock = mockFn.mock as Record<string, unknown>;
      expect(mock.calls).toEqual([]);
      expect(mock.results).toEqual([]);
      expect(mock.invocationCallOrder).toEqual([]);
    });

    it('should return the same mock object identity across reads', () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      const window = runInBrowserContext(script);
      const spy = window.__wdio_spy__ as Record<string, unknown>;
      const mockFn = (spy.fn as () => Record<string, unknown>)();
      expect(mockFn.mock).toBe(mockFn.mock);
    });

    it('should record calls and results', () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      const window = runInBrowserContext(script);
      const spy = window.__wdio_spy__ as Record<string, unknown>;
      const mockFn = (spy.fn as () => (...a: unknown[]) => unknown)();
      mockFn('arg1', 'arg2');
      const mock = (mockFn as unknown as Record<string, unknown>).mock as Record<string, unknown[][]>;
      expect(mock.calls).toEqual([['arg1', 'arg2']]);
    });

    it('should support mockReturnValue', () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      const window = runInBrowserContext(script);
      const spy = window.__wdio_spy__ as Record<string, unknown>;
      const mockFn = (spy.fn as () => Record<string, unknown>)();
      (mockFn.mockReturnValue as (v: unknown) => void)(42);
      expect((mockFn as unknown as (...a: unknown[]) => unknown)()).toBe(42);
    });

    it('should support mockClear', () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      const window = runInBrowserContext(script);
      const spy = window.__wdio_spy__ as Record<string, unknown>;
      const mockFn = (spy.fn as () => Record<string, unknown>)();
      (mockFn as unknown as (...a: unknown[]) => unknown)('x');
      (mockFn.mockClear as () => void)();
      const mock = mockFn.mock as Record<string, unknown[]>;
      expect(mock.calls).toEqual([]);
      expect(mock.results).toEqual([]);
    });

    describe('async result serialization', () => {
      it('should record actual value in results for mockResolvedValue', () => {
        const script = adapter.buildBrowserIpcInjectionScript();
        const window = runInBrowserContext(script);
        const spy = window.__wdio_spy__ as Record<string, unknown>;
        const mockFn = (spy.fn as () => Record<string, unknown>)();
        (mockFn.mockResolvedValue as (v: unknown) => void)({ data: 42 });
        const returned = (mockFn as unknown as (...a: unknown[]) => Promise<unknown>)();
        returned.catch(() => {});
        const mock = mockFn.mock as Record<string, Array<{ type: string; value: unknown }>>;
        expect(mock.results[0]).toEqual({ type: 'return', value: { data: 42 } });
      });

      it('should record actual value in results for mockRejectedValue', () => {
        const script = adapter.buildBrowserIpcInjectionScript();
        const window = runInBrowserContext(script);
        const spy = window.__wdio_spy__ as Record<string, unknown>;
        const mockFn = (spy.fn as () => Record<string, unknown>)();
        (mockFn.mockRejectedValue as (v: unknown) => void)('err-reason');
        const returned = (mockFn as unknown as (...a: unknown[]) => Promise<unknown>)();
        returned.catch(() => {});
        const mock = mockFn.mock as Record<string, Array<{ type: string; value: unknown }>>;
        expect(mock.results[0]).toEqual({ type: 'throw', value: 'err-reason' });
      });

      it('should record actual value in results for mockResolvedValueOnce', () => {
        const script = adapter.buildBrowserIpcInjectionScript();
        const window = runInBrowserContext(script);
        const spy = window.__wdio_spy__ as Record<string, unknown>;
        const mockFn = (spy.fn as () => Record<string, unknown>)();
        (mockFn.mockResolvedValueOnce as (v: unknown) => void)({ data: 99 });
        const returned = (mockFn as unknown as (...a: unknown[]) => Promise<unknown>)();
        returned.catch(() => {});
        const mock = mockFn.mock as Record<string, Array<{ type: string; value: unknown }>>;
        expect(mock.results[0]).toEqual({ type: 'return', value: { data: 99 } });
      });

      it('should record actual value in results for mockRejectedValueOnce', () => {
        const script = adapter.buildBrowserIpcInjectionScript();
        const window = runInBrowserContext(script);
        const spy = window.__wdio_spy__ as Record<string, unknown>;
        const mockFn = (spy.fn as () => Record<string, unknown>)();
        (mockFn.mockRejectedValueOnce as (v: unknown) => void)('once-err');
        const returned = (mockFn as unknown as (...a: unknown[]) => Promise<unknown>)();
        returned.catch(() => {});
        const mock = mockFn.mock as Record<string, Array<{ type: string; value: unknown }>>;
        expect(mock.results[0]).toEqual({ type: 'throw', value: 'once-err' });
      });

      it('should fall back to mockResolvedValue after the queue is consumed', () => {
        const script = adapter.buildBrowserIpcInjectionScript();
        const window = runInBrowserContext(script);
        const spy = window.__wdio_spy__ as Record<string, unknown>;
        const mockFn = (spy.fn as () => Record<string, unknown>)();
        (mockFn.mockResolvedValue as (v: unknown) => void)('default');
        (mockFn.mockResolvedValueOnce as (v: unknown) => void)('once');
        const invoke = mockFn as unknown as (...a: unknown[]) => Promise<unknown>;
        invoke().catch(() => {});
        invoke().catch(() => {});
        const mock = mockFn.mock as Record<string, Array<{ type: string; value: unknown }>>;
        expect(mock.results[0]).toEqual({ type: 'return', value: 'once' });
        expect(mock.results[1]).toEqual({ type: 'return', value: 'default' });
      });

      it('should fall back to mockRejectedValue after the queue is consumed', () => {
        const script = adapter.buildBrowserIpcInjectionScript();
        const window = runInBrowserContext(script);
        const spy = window.__wdio_spy__ as Record<string, unknown>;
        const mockFn = (spy.fn as () => Record<string, unknown>)();
        (mockFn.mockRejectedValue as (v: unknown) => void)('default-err');
        (mockFn.mockRejectedValueOnce as (v: unknown) => void)('once-err');
        const invoke = mockFn as unknown as (...a: unknown[]) => Promise<unknown>;
        invoke().catch(() => {});
        invoke().catch(() => {});
        const mock = mockFn.mock as Record<string, Array<{ type: string; value: unknown }>>;
        expect(mock.results[0]).toEqual({ type: 'throw', value: 'once-err' });
        expect(mock.results[1]).toEqual({ type: 'throw', value: 'default-err' });
      });
    });
  });
});

describe('createIpcInterceptor buildBrowserIpcInjectionScript delegation', () => {
  it('should delegate to the ElectronAdapter', () => {
    const interceptor = createIpcInterceptor('electron');
    const script = interceptor.buildBrowserIpcInjectionScript();
    expect(script).toContain('window.__wdio_spy__');
    expect(script).toContain('ipcRenderer');
  });
});
