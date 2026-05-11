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

  it('should provide no-op stubs for on, once, removeListener, removeAllListeners', () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    const ipcRenderer = (window.electron as Record<string, unknown>).ipcRenderer as Record<string, unknown>;
    expect(typeof ipcRenderer.on).toBe('function');
    expect(typeof ipcRenderer.once).toBe('function');
    expect(typeof ipcRenderer.removeListener).toBe('function');
    expect(typeof ipcRenderer.removeAllListeners).toBe('function');
    expect(() => (ipcRenderer.on as Function)('channel', () => {})).not.toThrow();
    expect(() => (ipcRenderer.once as Function)('channel', () => {})).not.toThrow();
    expect(() => (ipcRenderer.removeListener as Function)('channel', () => {})).not.toThrow();
    expect(() => (ipcRenderer.removeAllListeners as Function)('channel')).not.toThrow();
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
