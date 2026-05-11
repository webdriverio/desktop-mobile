import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createIpcInterceptor } from '../../src/interceptor/index.js';
import { TauriAdapter } from '../../src/interceptor/tauri.js';

function runInBrowserContext(script: string, windowProps: Record<string, unknown> = {}) {
  const window: Record<string, unknown> = { ...windowProps };
  const ctx = vm.createContext({ window, Promise });
  vm.runInContext(script, ctx);
  return window;
}

describe('TauriAdapter.buildBrowserIpcInjectionScript', () => {
  const adapter = new TauriAdapter();

  it('should set window.__wdio_spy__ with a fn factory', () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    expect(typeof (window.__wdio_spy__ as Record<string, unknown>)?.fn).toBe('function');
  });

  it('should create window.__wdio_mocks__ if absent', () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    expect(window.__wdio_mocks__).toEqual({});
  });

  it('should not overwrite existing window.__wdio_mocks__', () => {
    const existing = { greet: () => {} };
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script, { __wdio_mocks__: existing });
    expect(window.__wdio_mocks__).toBe(existing);
  });

  it('should create window.__TAURI_INTERNALS__ if absent', () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    expect(typeof (window.__TAURI_INTERNALS__ as Record<string, unknown>)?.invoke).toBe('function');
  });

  it('should preserve existing __TAURI_INTERNALS__ object and only patch invoke', () => {
    const existingInternal = { other: 'value' };
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script, { __TAURI_INTERNALS__: existingInternal });
    const internals = window.__TAURI_INTERNALS__ as Record<string, unknown>;
    expect(internals.other).toBe('value');
    expect(typeof internals.invoke).toBe('function');
  });

  it('should invoke reject with error for unmocked commands', async () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    const internals = window.__TAURI_INTERNALS__ as Record<string, unknown>;
    const invoke = internals.invoke as (cmd: string, args: unknown) => Promise<unknown>;
    await expect(invoke('unknown_cmd', {})).rejects.toThrow('unmocked Tauri command in browser mode: unknown_cmd');
  });

  it('should invoke route to window.__wdio_mocks__[cmd] when registered', async () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    (window.__wdio_mocks__ as Record<string, unknown>).greet = (_args: unknown) => 'hello';
    const internals = window.__TAURI_INTERNALS__ as Record<string, unknown>;
    const invoke = internals.invoke as (cmd: string, args: unknown, options?: unknown) => Promise<unknown>;
    await expect(invoke('greet', { name: 'world' })).resolves.toBe('hello');
  });

  it('should pass InvokeOptions as second argument to the registered mock', async () => {
    const script = adapter.buildBrowserIpcInjectionScript();
    const window = runInBrowserContext(script);
    let capturedOptions: unknown;
    (window.__wdio_mocks__ as Record<string, unknown>).greet = (_args: unknown, opts: unknown) => {
      capturedOptions = opts;
      return 'hello';
    };
    const internals = window.__TAURI_INTERNALS__ as Record<string, unknown>;
    const invoke = internals.invoke as (cmd: string, args: unknown, options: unknown) => Promise<unknown>;
    await invoke('greet', { name: 'world' }, { headers: { 'x-test': '1' } });
    expect(capturedOptions).toEqual({ headers: { 'x-test': '1' } });
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

    it('should support mockImplementation', () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      const window = runInBrowserContext(script);
      const spy = window.__wdio_spy__ as Record<string, unknown>;
      const mockFn = (spy.fn as () => Record<string, unknown>)();
      (mockFn.mockImplementation as (fn: (x: number) => number) => void)((x: number) => x * 2);
      const result = (mockFn as unknown as (x: number) => number)(5);
      expect(result).toBe(10);
    });

    it('should return Promise.resolve(undefined) for mockResolvedValue(undefined)', async () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      const window = runInBrowserContext(script);
      const spy = window.__wdio_spy__ as Record<string, unknown>;
      const mockFn = (spy.fn as () => Record<string, unknown>)();
      (mockFn.mockResolvedValue as (v: unknown) => void)(undefined);
      const result = (mockFn as unknown as () => unknown)();
      expect(result).toBeInstanceOf(Promise);
      await expect(result as Promise<unknown>).resolves.toBeUndefined();
    });

    it('should return Promise.reject(undefined) for mockRejectedValue(undefined)', async () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      const window = runInBrowserContext(script);
      const spy = window.__wdio_spy__ as Record<string, unknown>;
      const mockFn = (spy.fn as () => Record<string, unknown>)();
      (mockFn.mockRejectedValue as (v: unknown) => void)(undefined);
      const result = (mockFn as unknown as () => unknown)();
      expect(result).toBeInstanceOf(Promise);
      await expect(result as Promise<unknown>).rejects.toBeUndefined();
    });

    it('should preserve queued once-implementations across mockClear', () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      const window = runInBrowserContext(script);
      const spy = window.__wdio_spy__ as Record<string, unknown>;
      const mockFn = (spy.fn as () => Record<string, unknown>)();
      (mockFn.mockReturnValueOnce as (v: unknown) => void)(99);
      (mockFn.mockClear as () => void)();
      const result = (mockFn as unknown as () => unknown)();
      expect(result).toBe(99);
    });

    it('should drain queued once-implementations on mockReset', () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      const window = runInBrowserContext(script);
      const spy = window.__wdio_spy__ as Record<string, unknown>;
      const mockFn = (spy.fn as () => Record<string, unknown>)();
      (mockFn.mockReturnValueOnce as (v: unknown) => void)(99);
      (mockFn.mockReset as () => void)();
      const result = (mockFn as unknown as () => unknown)();
      expect(result).toBeUndefined();
    });

    it('should return a rejected Promise for mockRejectedValue', async () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      const window = runInBrowserContext(script);
      const spy = window.__wdio_spy__ as Record<string, unknown>;
      const mockFn = (spy.fn as () => Record<string, unknown>)();
      (mockFn.mockRejectedValue as (v: unknown) => void)(new Error('oops'));
      const result = (mockFn as unknown as () => Promise<unknown>)();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).rejects.toThrow('oops');
    });

    it('should return a rejected Promise for mockRejectedValueOnce', async () => {
      const script = adapter.buildBrowserIpcInjectionScript();
      const window = runInBrowserContext(script);
      const spy = window.__wdio_spy__ as Record<string, unknown>;
      const mockFn = (spy.fn as () => Record<string, unknown>)();
      (mockFn.mockRejectedValueOnce as (v: unknown) => void)(new Error('once'));
      const result = (mockFn as unknown as () => Promise<unknown>)();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).rejects.toThrow('once');
    });
  });
});

describe('TauriAdapter browser-mode events', () => {
  const adapter = new TauriAdapter();

  type Listener = (data: { event: string; id: number; payload: unknown }) => void;
  type Window = {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>;
      transformCallback: (cb: Listener, once?: boolean) => number;
      runCallback: (id: number, data: unknown) => void;
      callbacks: Map<number, unknown>;
    };
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (event: string, eventId: number) => void };
    __wdio_emit_tauri_event__: (event: string, payload?: unknown, target?: unknown) => void;
    __wdio_tauri_listeners__: Record<string, Record<number, { handlerId: number; target?: unknown }>>;
    __wdio_mocks__: Record<string, unknown>;
  };

  function setup(extraProps: Record<string, unknown> = {}) {
    const script = adapter.buildBrowserIpcInjectionScript();
    return runInBrowserContext(script, extraProps) as unknown as Window;
  }

  it('should resolve plugin:event|listen with a numeric eventId', async () => {
    const window = setup();
    const handlerId = window.__TAURI_INTERNALS__.transformCallback(() => {});
    const id = (await window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
      event: 'foo',
      target: { kind: 'Any' },
      handler: handlerId,
    })) as number;
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('should fire the registered handler when emit is dispatched via __wdio_emit_tauri_event__', async () => {
    const window = setup();
    const received: unknown[] = [];
    const handlerId = window.__TAURI_INTERNALS__.transformCallback((data) => received.push(data));
    await window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
      event: 'foo',
      target: { kind: 'Any' },
      handler: handlerId,
    });
    window.__wdio_emit_tauri_event__('foo', { x: 1 });
    expect(received).toHaveLength(1);
    const ev = received[0] as { event: string; id: number; payload: { x: number } };
    expect(ev.event).toBe('foo');
    expect(ev.payload).toEqual({ x: 1 });
    expect(typeof ev.id).toBe('number');
  });

  it('should remove the listener via plugin:event|unlisten', async () => {
    const window = setup();
    const received: unknown[] = [];
    const handlerId = window.__TAURI_INTERNALS__.transformCallback((data) => received.push(data));
    const id = (await window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
      event: 'foo',
      target: { kind: 'Any' },
      handler: handlerId,
    })) as number;
    await window.__TAURI_INTERNALS__.invoke('plugin:event|unlisten', { event: 'foo', eventId: id });
    window.__wdio_emit_tauri_event__('foo', 'payload');
    expect(received).toHaveLength(0);
  });

  it('should also remove the listener via __TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener', async () => {
    const window = setup();
    const received: unknown[] = [];
    const handlerId = window.__TAURI_INTERNALS__.transformCallback((data) => received.push(data));
    const id = (await window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
      event: 'foo',
      target: { kind: 'Any' },
      handler: handlerId,
    })) as number;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener('foo', id);
    window.__wdio_emit_tauri_event__('foo', 'payload');
    expect(received).toHaveLength(0);
  });

  it('should fire a once-handler exactly once', async () => {
    const window = setup();
    const received: unknown[] = [];
    const handlerId = window.__TAURI_INTERNALS__.transformCallback((data) => received.push(data), true);
    await window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
      event: 'foo',
      target: { kind: 'Any' },
      handler: handlerId,
    });
    window.__wdio_emit_tauri_event__('foo', 'first');
    window.__wdio_emit_tauri_event__('foo', 'second');
    expect(received).toHaveLength(1);
    expect((received[0] as { payload: string }).payload).toBe('first');
  });

  it('should filter listeners by target on emit_to', async () => {
    const window = setup();
    const mainReceived: unknown[] = [];
    const otherReceived: unknown[] = [];
    const mainHandlerId = window.__TAURI_INTERNALS__.transformCallback((data) => mainReceived.push(data));
    const otherHandlerId = window.__TAURI_INTERNALS__.transformCallback((data) => otherReceived.push(data));
    await window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
      event: 'foo',
      target: { kind: 'AnyLabel', label: 'main' },
      handler: mainHandlerId,
    });
    await window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
      event: 'foo',
      target: { kind: 'AnyLabel', label: 'other' },
      handler: otherHandlerId,
    });
    window.__wdio_emit_tauri_event__('foo', 'msg', 'main');
    expect(mainReceived).toHaveLength(1);
    expect(otherReceived).toHaveLength(0);
    window.__wdio_emit_tauri_event__('foo', 'msg2');
    expect(mainReceived).toHaveLength(2);
    expect(otherReceived).toHaveLength(1);
  });

  it('should record plugin:event|emit on a user mock and still dispatch to subscribers', async () => {
    const window = setup();
    const emitCalls: unknown[] = [];
    window.__wdio_mocks__['plugin:event|emit'] = (args: unknown) => {
      emitCalls.push(args);
    };
    const received: unknown[] = [];
    const handlerId = window.__TAURI_INTERNALS__.transformCallback((data) => received.push(data));
    await window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
      event: 'foo',
      target: { kind: 'Any' },
      handler: handlerId,
    });
    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'foo', payload: 42 });
    expect(emitCalls).toEqual([{ event: 'foo', payload: 42 }]);
    expect(received).toHaveLength(1);
    expect((received[0] as { payload: number }).payload).toBe(42);
  });

  it('should resolve other plugin:* commands with undefined when not mocked', async () => {
    const window = setup();
    await expect(window.__TAURI_INTERNALS__.invoke('plugin:fs|read', {})).resolves.toBeUndefined();
    await expect(window.__TAURI_INTERNALS__.invoke('plugin:window|close', {})).resolves.toBeUndefined();
  });

  it('should still reject non-plugin commands when not mocked', async () => {
    const window = setup();
    await expect(window.__TAURI_INTERNALS__.invoke('my_unknown_cmd', {})).rejects.toThrow(
      'unmocked Tauri command in browser mode: my_unknown_cmd',
    );
  });
});

describe('createIpcInterceptor buildBrowserIpcInjectionScript delegation', () => {
  it('should delegate to the TauriAdapter', () => {
    const interceptor = createIpcInterceptor('tauri');
    const script = interceptor.buildBrowserIpcInjectionScript();
    expect(script).toContain('window.__wdio_spy__');
    expect(script).toContain('window.__TAURI_INTERNALS__');
  });
});
