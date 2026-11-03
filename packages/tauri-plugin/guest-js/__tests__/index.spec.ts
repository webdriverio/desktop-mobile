import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@wdio/native-spy', () => ({
  fn: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

function createTauriMock(invokeImpl?: (...args: unknown[]) => unknown) {
  return {
    core: { invoke: vi.fn(invokeImpl ?? (async () => undefined)) },
    log: {
      trace: vi.fn().mockResolvedValue(undefined),
      debug: vi.fn().mockResolvedValue(undefined),
      info: vi.fn().mockResolvedValue(undefined),
      warn: vi.fn().mockResolvedValue(undefined),
      error: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('CleanupRegistry', () => {
  let registry: any;

  beforeEach(async () => {
    vi.useFakeTimers();
    const mod = await import('../index.js');
    const RegistryClass = (mod.cleanupRegistry as any).constructor;
    registry = new RegistryClass();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should add and clear timers', () => {
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    registry.addTimer(100);
    registry.addTimer(200);
    registry.clearTimers();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(100);
    expect(spy).toHaveBeenCalledWith(200);
  });

  it('should not call clearTimeout when no timers registered', () => {
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    registry.clearTimers();
    expect(spy).not.toHaveBeenCalled();
  });

  it('should add and run listener cleanup functions', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    registry.addListener(fn1);
    registry.addListener(fn2);
    registry.cleanup();

    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
  });

  it('should clear timers during cleanup', () => {
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    registry.addTimer(300);
    registry.cleanup();

    expect(spy).toHaveBeenCalledWith(300);
  });

  it('should clear the timer set after cleanup', () => {
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    registry.addTimer(400);
    registry.cleanup();
    spy.mockClear();

    registry.cleanup();
    expect(spy).not.toHaveBeenCalled();
  });

  it('should clear the listener set after cleanup', () => {
    const fn1 = vi.fn();
    registry.addListener(fn1);
    registry.cleanup();
    fn1.mockClear();

    registry.cleanup();
    expect(fn1).not.toHaveBeenCalled();
  });

  it('should ignore errors thrown by listener cleanup functions', () => {
    const thrower = vi.fn(() => {
      throw new Error('cleanup error');
    });
    const fn2 = vi.fn();
    registry.addListener(thrower);
    registry.addListener(fn2);

    expect(() => registry.cleanup()).not.toThrow();
    expect(thrower).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
  });

  it('should handle duplicate timer ids', () => {
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    registry.addTimer(500);
    registry.addTimer(500);
    registry.clearTimers();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should handle duplicate listener functions', () => {
    const fn1 = vi.fn();
    registry.addListener(fn1);
    registry.addListener(fn1);
    registry.cleanup();

    expect(fn1).toHaveBeenCalledTimes(1);
  });
});

describe('getConsoleForwardingCode', () => {
  let getConsoleForwardingCode: typeof import('../index.js')['getConsoleForwardingCode'];

  beforeEach(async () => {
    const mod = await import('../index.js');
    getConsoleForwardingCode = mod.getConsoleForwardingCode;
  });

  it('should return a non-empty string', () => {
    const code = getConsoleForwardingCode();
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);
  });

  it('should contain console method overrides', () => {
    const code = getConsoleForwardingCode();
    expect(code).toContain('console.log');
    expect(code).toContain('console.debug');
    expect(code).toContain('console.info');
    expect(code).toContain('console.warn');
    expect(code).toContain('console.error');
  });

  it('should store original console methods', () => {
    const code = getConsoleForwardingCode();
    expect(code).toContain('originalConsole');
    expect(code).toContain('console.log.bind(console)');
  });

  it('should use Object.defineProperty for overriding', () => {
    const code = getConsoleForwardingCode();
    expect(code).toContain('Object.defineProperty');
  });

  it('should check for window.__TAURI__.log availability', () => {
    const code = getConsoleForwardingCode();
    expect(code).toContain('window.__TAURI__');
    expect(code).toContain('.log');
  });

  it('should forward to Tauri log plugin', () => {
    const code = getConsoleForwardingCode();
    expect(code).toContain('forward');
    expect(code).toContain('window.__TAURI__.log');
  });

  it('should be an IIFE', () => {
    const code = getConsoleForwardingCode();
    expect(code).toContain('(function()');
  });
});

describe('execute', () => {
  let execute: typeof import('../index.js')['execute'];
  let originalInvoke: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    originalInvoke = vi.fn() as ReturnType<typeof vi.fn>;
    originalInvoke.mockResolvedValue('executed');
    (window as any).__TAURI__ = createTauriMock(originalInvoke as (...args: unknown[]) => unknown);

    const mod = await import('../index.js');
    await mod.init();
    execute = mod.execute;
  });

  afterEach(() => {
    delete (window as any).__TAURI__;
    vi.restoreAllMocks();
  });

  it('should throw when window.__TAURI__ is not available', async () => {
    delete (window as any).__TAURI__;
    await expect(execute('return 1')).rejects.toThrow('window.__TAURI__ is not available');
  });

  it('should call the original invoke with the wrapped script', async () => {
    await execute('(tauri) => tauri.core.invoke("test")');

    const pluginCalls = originalInvoke.mock.calls.filter((call: unknown[]) => call[0] === 'plugin:wdio|execute');
    expect(pluginCalls.length).toBe(1);
    expect(pluginCalls[0][1]).toEqual(
      expect.objectContaining({
        request: expect.objectContaining({
          script: expect.stringContaining('__wdio_tauri'),
          args: [],
        }),
      }),
    );
  });

  it('should serialize additional arguments into the wrapped script', async () => {
    await execute('(tauri, a, b) => a + b', {}, '["hello",42]');

    const pluginCalls = originalInvoke.mock.calls.filter((call: unknown[]) => call[0] === 'plugin:wdio|execute');
    expect(pluginCalls[0][1].request.script).toContain('["hello",42]');
  });

  it('should return the result from invoke', async () => {
    const result = await execute('(tauri) => "test"');
    expect(result).toBe('executed');
  });

  it('should wrap invoke errors with a descriptive message', async () => {
    originalInvoke.mockRejectedValueOnce(new Error('invoke failed'));

    await expect(execute('(tauri) => tauri.core.invoke("bad")')).rejects.toThrow(
      'Failed to execute script: invoke failed',
    );
  });

  it('should handle non-Error invoke rejections', async () => {
    originalInvoke.mockRejectedValueOnce('string error');

    await expect(execute('(tauri) => tauri.core.invoke("bad")')).rejects.toThrow(
      'Failed to execute script: string error',
    );
  });

  it('should wrap async arrow functions with Tauri API injection', async () => {
    // Test that async arrow function is routed to function-like path
    await execute('async (tauri, value) => ({ received: value, hasTauri: !!tauri?.core })', 'test-value');

    // Should be routed to function-like path (has Tauri API injected)
    const pluginCalls = originalInvoke.mock.calls.filter((call: unknown[]) => call[0] === 'plugin:wdio|execute');
    expect(pluginCalls[0][1]).toEqual(
      expect.objectContaining({
        request: expect.objectContaining({
          script: expect.stringContaining('__wdio_tauri'),
        }),
      }),
    );
  });

  it('should call a single-parameter arrow function named with $', async () => {
    await execute('$ => $.core.invoke("test")');

    const pluginCalls = originalInvoke.mock.calls.filter((call: unknown[]) => call[0] === 'plugin:wdio|execute');
    expect(pluginCalls[0][1].request.script).toContain('await ($ => $.core.invoke("test"))(__wdio_tauri');
  });

  it('should route statement-style string scripts to statement path', async () => {
    await execute('return 42');

    const pluginCalls = originalInvoke.mock.calls.filter((call: unknown[]) => call[0] === 'plugin:wdio|execute');
    expect(pluginCalls[0][1].request.script).toContain('(async function() { return 42 }).apply(null, [])');
  });

  it('should route expression-style string scripts to expression path', async () => {
    await execute('1 + 2 + 3');

    const pluginCalls = originalInvoke.mock.calls.filter((call: unknown[]) => call[0] === 'plugin:wdio|execute');
    expect(pluginCalls[0][1].request.script).toContain('(async function() { return 1 + 2 + 3; }).apply(null, [])');
  });

  it('should embed args into string script body so arguments[0] etc. are accessible', async () => {
    await execute('return arguments[0] + arguments[1]', {}, '[10,32]');

    const pluginCalls = originalInvoke.mock.calls.filter((call: unknown[]) => call[0] === 'plugin:wdio|execute');
    expect(pluginCalls[0][1].request.script).toContain('.apply(null, [10,32])');
  });

  it('should handle statement-style string scripts', async () => {
    originalInvoke.mockResolvedValue(42);
    const result = await execute('return 42');

    // Should be routed to statement path (no Tauri injection needed)
    const pluginCalls = originalInvoke.mock.calls.filter((call: unknown[]) => call[0] === 'plugin:wdio|execute');
    expect(pluginCalls[0][1].request.script).toContain('return 42');
    expect(result).toBe(42);
  });

  it('should handle expression-style string scripts', async () => {
    originalInvoke.mockResolvedValue(6);
    const result = await execute('1 + 2 + 3');

    // Should be routed to expression path (wrapped with return)
    const pluginCalls = originalInvoke.mock.calls.filter((call: unknown[]) => call[0] === 'plugin:wdio|execute');
    expect(pluginCalls[0][1].request.script).toContain('return 1 + 2 + 3');
    expect(result).toBe(6);
  });

  it('should treat try{ (no space) as a statement, not an expression', async () => {
    await execute('try{x=1}catch(e){e}');

    const pluginCalls = originalInvoke.mock.calls.filter((call: unknown[]) => call[0] === 'plugin:wdio|execute');
    const sent = pluginCalls[0][1].request.script as string;
    expect(sent).toContain('try{x=1}catch(e){e}');
    expect(sent).not.toContain('return try{');
  });

  it('should treat do{ (no space) as a statement, not an expression', async () => {
    await execute('do{x++}while(x<3)');

    const pluginCalls = originalInvoke.mock.calls.filter((call: unknown[]) => call[0] === 'plugin:wdio|execute');
    const sent = pluginCalls[0][1].request.script as string;
    expect(sent).toContain('do{x++}while(x<3)');
    expect(sent).not.toContain('return do{');
  });

  it('should treat async(42) as an expression, not a function-like script', async () => {
    await execute('async(42)');

    const pluginCalls = originalInvoke.mock.calls.filter((call: unknown[]) => call[0] === 'plugin:wdio|execute');
    const sent = pluginCalls[0][1].request.script as string;
    expect(sent).not.toContain('__wdio_tauri');
    expect(sent).toContain('async(42)');
  });
});

describe('setupConsoleForwarding', () => {
  let originalLog: typeof console.log;
  let originalDebug: typeof console.debug;
  let originalInfo: typeof console.info;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;
  let originalTrace: typeof console.trace;

  beforeEach(() => {
    originalLog = console.log;
    originalDebug = console.debug;
    originalInfo = console.info;
    originalWarn = console.warn;
    originalError = console.error;
    originalTrace = console.trace;
  });

  afterEach(() => {
    Object.defineProperty(console, 'log', { value: originalLog, writable: true, configurable: true });
    Object.defineProperty(console, 'debug', { value: originalDebug, writable: true, configurable: true });
    Object.defineProperty(console, 'info', { value: originalInfo, writable: true, configurable: true });
    Object.defineProperty(console, 'warn', { value: originalWarn, writable: true, configurable: true });
    Object.defineProperty(console, 'error', { value: originalError, writable: true, configurable: true });
    Object.defineProperty(console, 'trace', { value: originalTrace, writable: true, configurable: true });
    delete (window as any).__TAURI__;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('should wrap console methods after init', async () => {
    vi.resetModules();
    const logBefore = console.log;
    (window as any).__TAURI__ = createTauriMock();

    const mod = await import('../index.js');
    await mod.init();

    expect(console.log).not.toBe(logBefore);
  });

  it('should call the original console method when wrapped', async () => {
    vi.resetModules();
    const logSpy = vi.fn();
    Object.defineProperty(console, 'log', { value: logSpy, writable: true, configurable: true });

    (window as any).__TAURI__ = createTauriMock();

    const mod = await import('../index.js');
    await mod.init();

    console.log('test message');

    expect(logSpy).toHaveBeenCalled();
  });

  it('should forward console.warn to Tauri log plugin', async () => {
    vi.resetModules();
    const tauriMock = createTauriMock();
    (window as any).__TAURI__ = tauriMock;

    const mod = await import('../index.js');
    await mod.init();

    console.warn('warning message');

    await vi.waitFor(() => {
      expect(tauriMock.log.warn).toHaveBeenCalled();
    });
  });

  it('should fall back to WDIO plugin log_frontend when log plugin is not available', async () => {
    vi.resetModules();
    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI__ = {
      core: { invoke: mockInvoke },
    };

    const mod = await import('../index.js');
    await mod.init();

    console.warn('fallback warning');

    await vi.waitFor(() => {
      const logFrontendCalls = mockInvoke.mock.calls.filter(
        (call: unknown[]) => call[0] === 'plugin:wdio|log_frontend',
      );
      expect(logFrontendCalls.length).toBeGreaterThan(0);
    });
  });

  it('should forward console.error to Tauri log plugin', async () => {
    vi.resetModules();
    const tauriMock = createTauriMock();
    (window as any).__TAURI__ = tauriMock;

    const mod = await import('../index.js');
    await mod.init();

    console.error('error message');

    await vi.waitFor(() => {
      expect(tauriMock.log.error).toHaveBeenCalled();
    });
  });

  it('should stringify non-string arguments', async () => {
    vi.resetModules();
    const tauriMock = createTauriMock();
    (window as any).__TAURI__ = tauriMock;

    const mod = await import('../index.js');
    await mod.init();

    console.warn({ key: 'value' });

    await vi.waitFor(() => {
      const calls = tauriMock.log.warn.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toContain('{"key":"value"}');
    });
  });
});

describe('IPC interception', () => {
  const originalFetch = window.fetch;
  let appFetch: ReturnType<typeof vi.fn>;

  // Sends each command as Tauri's IPC does: one fetch per invoke, settled through runCallback
  function installTauriInternals(ipcOrigin = 'ipc://localhost') {
    const callbacks = new Map<number, (data: unknown) => void>();
    let nextId = 1;
    const internals = {
      convertFileSrc: (filePath: string, protocol = 'asset') =>
        `${ipcOrigin.replace('ipc', protocol)}/${encodeURIComponent(filePath)}`,
      runCallback: (id: number, data: unknown) => callbacks.get(id)?.(data),
      invoke: (cmd: string, payload: unknown = {}, options?: { headers?: Record<string, string> }) =>
        new Promise((resolve, reject) => {
          const callback = nextId++;
          const error = nextId++;
          callbacks.set(callback, resolve);
          callbacks.set(error, reject);
          const headers = new Headers(options?.headers);
          headers.set('Content-Type', 'application/json');
          headers.set('Tauri-Callback', String(callback));
          headers.set('Tauri-Error', String(error));
          fetch(internals.convertFileSrc(cmd, 'ipc'), { method: 'POST', body: JSON.stringify(payload), headers }).then(
            async (response) =>
              internals.runCallback(
                response.headers.get('Tauri-Response') === 'ok' ? callback : error,
                await response.json(),
              ),
            reject,
          );
        }),
    };
    (window as any).__TAURI_INTERNALS__ = internals;
    return internals;
  }

  async function loadPlugin() {
    vi.resetModules();
    const mod = await import('../index.js');
    await mod.init();
  }

  beforeEach(() => {
    appFetch = vi.fn(
      async (url: string) =>
        new Response(JSON.stringify(`app:${url}`), {
          headers: { 'Tauri-Response': 'ok', 'Content-Type': 'application/json' },
        }),
    );
    window.fetch = appFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    window.fetch = originalFetch;
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__wdio_mocks__;
    delete (window as any).wdioTauri;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it.each([
    ['ipc://localhost', 'macOS and Linux'],
    ['http://ipc.localhost', 'Windows'],
  ])('should route a command the app invokes to its mock with %s URLs (%s)', async (ipcOrigin) => {
    const internals = installTauriInternals(ipcOrigin);
    const mockFn = vi.fn().mockResolvedValue('mocked-result');
    (window as any).__wdio_mocks__ = { 'plugin:my|command': mockFn };
    await loadPlugin();

    await expect(internals.invoke('plugin:my|command', { foo: 'bar' })).resolves.toBe('mocked-result');

    expect(mockFn).toHaveBeenCalledWith({ foo: 'bar' });
    expect(appFetch).not.toHaveBeenCalledWith(`${ipcOrigin}/plugin%3Amy%7Ccommand`, expect.anything());
  });

  it('should call the mock before invoke returns', async () => {
    const internals = installTauriInternals();
    const mockFn = vi.fn();
    (window as any).__wdio_mocks__ = { my_command: mockFn };
    await loadPlugin();

    const pending = internals.invoke('my_command');

    expect(mockFn).toHaveBeenCalledOnce();
    await pending;
  });

  it('should reject with the error the mock throws', async () => {
    const internals = installTauriInternals();
    const failure = new Error('mock error');
    (window as any).__wdio_mocks__ = {
      failing_command: () => {
        throw failure;
      },
    };
    await loadPlugin();

    await expect(internals.invoke('failing_command')).rejects.toBe(failure);
  });

  it('should send a command with no mock to the app', async () => {
    const internals = installTauriInternals();
    (window as any).__wdio_mocks__ = { other_command: vi.fn() };
    await loadPlugin();

    await expect(internals.invoke('my_command')).resolves.toBe('app:ipc://localhost/my_command');
  });

  it('should send a mocked command to the app when the request skips mocks', async () => {
    const internals = installTauriInternals();
    const mockFn = vi.fn();
    (window as any).__wdio_mocks__ = { 'plugin:event|emit': mockFn };
    await loadPlugin();

    await expect(
      internals.invoke('plugin:event|emit', { event: 'foo' }, { headers: { 'Wdio-Skip-Mocks': '1' } }),
    ).resolves.toBe('app:ipc://localhost/plugin%3Aevent%7Cemit');
    expect(mockFn).not.toHaveBeenCalled();
  });

  it('should pass a binary payload to the mock unchanged', async () => {
    installTauriInternals();
    const mockFn = vi.fn();
    (window as any).__wdio_mocks__ = { upload: mockFn };
    await loadPlugin();
    const bytes = new Uint8Array([1, 2, 3]);

    void window.fetch('ipc://localhost/upload', {
      method: 'POST',
      body: bytes,
      headers: { 'Content-Type': 'application/octet-stream', 'Tauri-Callback': '1', 'Tauri-Error': '2' },
    });

    expect(mockFn).toHaveBeenCalledWith(bytes);
  });

  it('should leave requests that are not IPC commands to fetch', async () => {
    installTauriInternals();
    await loadPlugin();

    await window.fetch('https://example.com/data');

    expect(appFetch).toHaveBeenCalledWith('https://example.com/data', undefined);
  });

  it("should leave fetch alone without Tauri's IPC, as in browser mode", async () => {
    (window as any).__TAURI_INTERNALS__ = { invoke: vi.fn() };
    await loadPlugin();

    expect(window.fetch).toBe(appFetch);
  });

  it('should wrap fetch once when the plugin loads again', async () => {
    installTauriInternals();
    await loadPlugin();
    const interceptedFetch = window.fetch;

    await loadPlugin();

    expect(window.fetch).not.toBe(appFetch);
    expect(window.fetch).toBe(interceptedFetch);
  });

  it('should restore fetch on cleanupInvokeInterception', async () => {
    installTauriInternals();
    await loadPlugin();

    window.wdioTauri?.cleanupInvokeInterception?.();

    expect(window.fetch).toBe(appFetch);
  });

  it('should snapshot window.__TAURI__.core when the app sets it up after init', async () => {
    vi.useFakeTimers();
    (window as any).__TAURI__ = {};
    await loadPlugin();

    const core = { invoke: vi.fn() };
    (window as any).__TAURI__.core = core;
    await vi.advanceTimersByTimeAsync(500);

    expect((window as any).__wdio_original_core__).toBe(core);
    vi.useRealTimers();
    delete (window as any).__TAURI__;
    delete (window as any).__wdio_original_core__;
    delete (window as any).__wdio_original_tauri__;
  });
});

describe('init', () => {
  afterEach(() => {
    delete (window as any).__TAURI__;
    delete (window as any).__wdio_spy__;
    delete (window as any).wdioTauri;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('should set up window.wdioTauri', async () => {
    vi.resetModules();
    (window as any).__TAURI__ = createTauriMock();

    const mod = await import('../index.js');
    await mod.init();

    expect(window.wdioTauri).toBeDefined();
    expect(typeof window.wdioTauri?.execute).toBe('function');
    expect(typeof window.wdioTauri?.cleanupAll).toBe('function');
    expect(typeof window.wdioTauri?.cleanupLogListeners).toBe('function');
  });

  it('should expose __wdio_spy__ on window', async () => {
    vi.resetModules();
    (window as any).__TAURI__ = createTauriMock();

    const mod = await import('../index.js');
    await mod.init();

    expect((window as any).__wdio_spy__).toBeDefined();
  });

  it('should snapshot __wdio_original_tauri__ before invoke interception', async () => {
    vi.resetModules();
    const tauri = createTauriMock();
    (window as any).__TAURI__ = tauri;

    const mod = await import('../index.js');
    await mod.init();

    expect((window as any).__wdio_original_tauri__).toBe(tauri);
  });

  it('should snapshot __wdio_original_core__ before invoke interception', async () => {
    vi.resetModules();
    const tauri = createTauriMock();
    (window as any).__TAURI__ = tauri;

    const mod = await import('../index.js');
    await mod.init();

    expect((window as any).__wdio_original_core__).toBe(tauri.core);
  });

  it('should not re-initialize when called twice', async () => {
    vi.resetModules();
    (window as any).__TAURI__ = createTauriMock();

    const mod = await import('../index.js');
    await mod.init();
    const firstWdioTauri = window.wdioTauri;

    await mod.init();
    expect(window.wdioTauri).toBe(firstWdioTauri);
  });

  it('should set waitForInit on window.wdioTauri', async () => {
    vi.resetModules();
    (window as any).__TAURI__ = createTauriMock();

    const mod = await import('../index.js');
    await mod.init();

    expect(typeof (window.wdioTauri as any).waitForInit).toBe('function');
  });

  it('should provide cleanupAll that calls individual cleanup functions', async () => {
    vi.resetModules();
    (window as any).__TAURI__ = createTauriMock();

    const mod = await import('../index.js');
    await mod.init();

    const backendCleanup = vi.fn();
    const frontendCleanup = vi.fn();
    (window.wdioTauri as any).cleanupBackendLogListener = backendCleanup;
    (window.wdioTauri as any).cleanupFrontendLogListener = frontendCleanup;

    window.wdioTauri?.cleanupAll();

    expect(backendCleanup).toHaveBeenCalledOnce();
    expect(frontendCleanup).toHaveBeenCalledOnce();
  });
});

describe('waitForInit', () => {
  afterEach(() => {
    delete (window as any).__TAURI__;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('should resolve after auto-init triggered by module import', async () => {
    vi.resetModules();
    (window as any).__TAURI__ = createTauriMock();

    const mod = await import('../index.js');
    await expect(mod.waitForInit()).resolves.toBeUndefined();
  });

  it('should resolve after explicit init() call', async () => {
    vi.resetModules();
    (window as any).__TAURI__ = createTauriMock();

    const mod = await import('../index.js');
    await mod.init();
    await expect(mod.waitForInit()).resolves.toBeUndefined();
  });
});

describe('cleanupRegistry export', () => {
  it('should export cleanupRegistry instance', async () => {
    const mod = await import('../index.js');
    expect(mod.cleanupRegistry).toBeDefined();
    expect(typeof mod.cleanupRegistry.addTimer).toBe('function');
    expect(typeof mod.cleanupRegistry.addListener).toBe('function');
    expect(typeof mod.cleanupRegistry.cleanup).toBe('function');
  });
});
