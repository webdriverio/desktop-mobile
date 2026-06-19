import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLogLines } from '../src/logParser.js';
import { closeLogWriter, getLogWriter, isLogWriterInitialized } from '../src/logWriter.js';

vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    waitUntilWindowAvailable: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../src/commands/mock.js', () => ({
  clearAllMocks: vi.fn().mockResolvedValue(undefined),
  resetAllMocks: vi.fn().mockResolvedValue(undefined),
  restoreAllMocks: vi.fn().mockResolvedValue(undefined),
  isMockFunction: vi.fn(),
  mock: vi.fn(),
}));

vi.mock('../src/mockStore.js', () => ({
  default: {
    clear: vi.fn(),
    getMocks: vi.fn().mockReturnValue([]),
    getMock: vi.fn(),
  },
}));

vi.mock('../src/commands/execute.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/window.js', () => ({
  clearWindowState: vi.fn(),
  ensureActiveWindowFocus: vi.fn().mockResolvedValue(undefined),
  getDefaultWindowLabel: vi.fn().mockReturnValue('main'),
  listWindowLabels: vi.fn().mockResolvedValue(['main']),
  setCurrentWindowLabel: vi.fn(),
  setSessionProvider: vi.fn(),
  switchWindowByLabel: vi.fn().mockResolvedValue(undefined),
}));

import { waitUntilWindowAvailable } from '@wdio/native-utils';
import { execute as executeCommand } from '../src/commands/execute.js';
import { clearAllMocks, resetAllMocks, restoreAllMocks } from '../src/commands/mock.js';
import mockStore from '../src/mockStore.js';
import TauriWorkerService from '../src/service.js';
import { clearWindowState, ensureActiveWindowFocus, setCurrentWindowLabel } from '../src/window.js';

function createMockBrowser(overrides: Record<string, unknown> = {}): WebdriverIO.Browser {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    executeAsync: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockResolvedValue(undefined),
    isMultiremote: false,
    sessionId: 'test-session-123',
    instances: [],
    getInstance: vi.fn(),
    overwriteCommand: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    tauri: {
      execute: vi.fn().mockResolvedValue(undefined),
    },
    capabilities: {},
    ...overrides,
  } as unknown as WebdriverIO.Browser;
}

describe('TauriWorkerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('console wrapping', () => {
    it('should patch browser.execute only once', () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);
      (service as any).patchBrowserExecute(mockBrowser);
      (service as any).patchBrowserExecute(mockBrowser);

      const symbol = Object.getOwnPropertySymbols(mockBrowser).find((s) =>
        s.toString().includes('wdio-tauri-execute-patched'),
      );
      expect(symbol).toBeDefined();
    });

    it('should not wrap execute if already patched', () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);
      const firstExecute = mockBrowser.execute;

      (service as any).patchBrowserExecute(mockBrowser);
      const secondExecute = mockBrowser.execute;

      expect(firstExecute).toBe(secondExecute);
    });

    it('should wrap string scripts in IIFE with done callback for non-embedded providers', () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined);
      const mockExecuteAsync = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute, executeAsync: mockExecuteAsync });
      const service = new TauriWorkerService({ driverProvider: 'official' }, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);
      mockBrowser.execute('return document.title');

      // String scripts should use executeAsync with explicit done callback for WebKit compatibility
      expect(mockExecuteAsync).toHaveBeenCalled();
      const callArgs = mockExecuteAsync.mock.calls[0];
      // The script should contain .then( to handle async results and __wdio_error__ for error handling
      expect(callArgs[0]).toContain('.then(');
      expect(callArgs[0]).toContain('__wdio_error__');
      // execute should NOT be called for string scripts
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should prepend return for expression-style string scripts on non-embedded providers', () => {
      const mockExecuteAsync = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ executeAsync: mockExecuteAsync });
      const service = new TauriWorkerService({ driverProvider: 'official' }, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);
      mockBrowser.execute('1 + 2 + 3');

      expect(mockExecuteAsync).toHaveBeenCalled();
      expect(mockExecuteAsync.mock.calls[0][0]).toContain('return 1 + 2 + 3;');
    });

    it('should not prepend return for statement-style string scripts on non-embedded providers', () => {
      const mockExecuteAsync = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ executeAsync: mockExecuteAsync });
      const service = new TauriWorkerService({ driverProvider: 'official' }, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);
      mockBrowser.execute('const x = 1; return x');

      expect(mockExecuteAsync).toHaveBeenCalled();
      const wrappedScript = mockExecuteAsync.mock.calls[0][0] as string;
      // The body should NOT have an extra "return" prepended
      expect(wrappedScript).toContain('const x = 1; return x');
      expect(wrappedScript).not.toMatch(/return const/);
    });

    it('should pass function scripts as-is for non-embedded providers using executeAsync', () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined);
      const mockExecuteAsync = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute, executeAsync: mockExecuteAsync });
      const service = new TauriWorkerService({ driverProvider: 'official' }, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);
      const testFn = (a: number, b: number) => a + b;
      mockBrowser.execute(testFn as any, 1, 2);

      // Functions should use executeAsync for WebKit compatibility
      expect(mockExecuteAsync).toHaveBeenCalledWith(expect.stringContaining('(a, b) => a + b'), 1, 2);
      // execute should NOT be called
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should route executeWithinTauri through executeAsync on non-embedded providers', () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined);
      const mockExecuteAsync = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute, executeAsync: mockExecuteAsync });
      const service = new TauriWorkerService({ driverProvider: 'official' }, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);

      // Simulate the internal call that commands/execute.ts makes
      const executeWithinTauri = async function executeWithinTauri(
        _script: string,
        _execOptions: object,
        _argsJson: string,
      ) {};
      mockBrowser.execute(executeWithinTauri as any, 'fn string', {}, '[]');

      // Must use executeAsync — the async function returns a Promise that the sync
      // WebDriver endpoint on WebKit (WKWebView/macOS) cannot await.
      expect(mockExecuteAsync).toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should pass string scripts as-is to sync execute for embedded provider', () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute });
      const service = new TauriWorkerService({ driverProvider: 'embedded' }, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);
      mockBrowser.execute('return document.title');

      expect(mockExecute).toHaveBeenCalledWith('return document.title');
    });

    it('should pass function scripts unchanged to sync execute for embedded provider', () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute });
      const service = new TauriWorkerService({ driverProvider: 'embedded' }, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);
      const testFn = (a: number, b: number) => a + b;
      mockBrowser.execute(testFn as any, 1, 2);

      // For embedded, pass the script through untouched — WebdriverIO wraps the function with
      // its polyfill and returns via `return (fn).apply(null, arguments)`, which is a valid
      // function body for the W3C-compliant embedded WebDriver.
      expect(mockExecute).toHaveBeenCalledWith(testFn, 1, 2);
    });
  });

  describe('before()', () => {
    it('should initialize standard browser with tauri API and patched execute', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      await service.before({} as any, [], mockBrowser);

      expect(waitUntilWindowAvailable).toHaveBeenCalledWith(mockBrowser);
      expect((mockBrowser as any).tauri).toBeDefined();
      expect(typeof (mockBrowser as any).tauri.execute).toBe('function');
      expect(typeof (mockBrowser as any).tauri.mock).toBe('function');
      expect(typeof (mockBrowser as any).tauri.clearAllMocks).toBe('function');
      expect(typeof (mockBrowser as any).tauri.resetAllMocks).toBe('function');
      expect(typeof (mockBrowser as any).tauri.restoreAllMocks).toBe('function');
      expect(typeof (mockBrowser as any).tauri.triggerDeeplink).toBe('function');
      expect(typeof (mockBrowser as any).tauri.switchWindow).toBe('function');
      expect(typeof (mockBrowser as any).tauri.listWindows).toBe('function');
    });

    it('should initialize window label from options', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({ windowLabel: 'settings' }, { 'wdio:tauriServiceOptions': {} });

      await service.before({} as any, [], mockBrowser);

      expect(setCurrentWindowLabel).toHaveBeenCalledWith(mockBrowser, 'settings');
    });

    it('should default window label to main when not configured', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      await service.before({} as any, [], mockBrowser);

      expect(setCurrentWindowLabel).toHaveBeenCalledWith(mockBrowser, 'main');
    });

    it('should call patchBrowserExecute for standard browser', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      await service.before({} as any, [], mockBrowser);

      const symbol = Object.getOwnPropertySymbols(mockBrowser).find((s) =>
        s.toString().includes('wdio-tauri-execute-patched'),
      );
      expect(symbol).toBeDefined();
    });

    it('should wait for plugin initialization on standard browser', async () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined);
      const mockExecuteAsync = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute, executeAsync: mockExecuteAsync });
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      await service.before({} as any, [], mockBrowser);

      // For non-embedded providers, executeAsync is used (WebKit compatibility)
      expect(mockExecuteAsync).toHaveBeenCalled();
    });

    it('should skip plugin initialization wait for crabnebula driver provider', async () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined);
      const mockExecuteAsync = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute, executeAsync: mockExecuteAsync });
      const service = new TauriWorkerService({ driverProvider: 'crabnebula' }, { 'wdio:tauriServiceOptions': {} });

      await service.before({} as any, [], mockBrowser);

      // CrabNebula skips the plugin initialization wait entirely
      expect(mockExecute).not.toHaveBeenCalled();
      expect(mockExecuteAsync).not.toHaveBeenCalled();
    });

    it('should handle plugin initialization error gracefully', async () => {
      const mockExecuteAsync = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ executeAsync: mockExecuteAsync });
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      await expect(service.before({} as any, [], mockBrowser)).resolves.not.toThrow();
    });

    it('should install command overrides after initialization', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      await service.before({} as any, [], mockBrowser);

      expect(mockBrowser.overwriteCommand).toHaveBeenCalledWith('click', expect.any(Function), true);
      expect(mockBrowser.overwriteCommand).toHaveBeenCalledWith('doubleClick', expect.any(Function), true);
      expect(mockBrowser.overwriteCommand).toHaveBeenCalledWith('setValue', expect.any(Function), true);
      expect(mockBrowser.overwriteCommand).toHaveBeenCalledWith('clearValue', expect.any(Function), true);
    });

    it('should run the original command then sync mocks in the override body', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      vi.mocked(mockStore.getMocks).mockReturnValue([['tauri.cmd', { update: mockUpdate } as any]]);

      // Capture the override WDIO registered for 'click' and invoke it the way
      // WDIO would (override(originalCommand, ...args)). This guards the override
      // *body* — not just that it was registered — so dropping updateAllMocks()
      // would fail here.
      const clickCall = vi.mocked(mockBrowser.overwriteCommand).mock.calls.find((c) => c[0] === 'click');
      expect(clickCall).toBeDefined();
      const override = clickCall![1] as unknown as (
        this: unknown,
        originalCommand: (...args: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) => Promise<unknown>;

      const originalCommand = vi.fn().mockResolvedValue('ok');
      const result = await override.call({}, originalCommand);

      expect(originalCommand).toHaveBeenCalledOnce();
      expect(mockUpdate).toHaveBeenCalledOnce();
      expect(result).toBe('ok');
    });

    it('should clear stale mocks at session start for embedded driver provider', async () => {
      const mockBrowser = createMockBrowser();
      const originalExecute = mockBrowser.execute as ReturnType<typeof vi.fn>;
      const service = new TauriWorkerService({ driverProvider: 'embedded' }, { 'wdio:tauriServiceOptions': {} });

      await service.before({} as any, [], mockBrowser);

      // For embedded, patchedExecute passes function scripts through untouched, so
      // clearStaleMocks reaches originalExecute as a function with its name preserved.
      const clearCall = originalExecute.mock.calls.find(
        ([script]) => typeof script === 'function' && script.name === 'clearStaleMocks',
      );
      expect(clearCall).toBeDefined();
    });

    it('should not clear stale mocks for non-embedded driver providers', async () => {
      const mockBrowser = createMockBrowser();
      const originalExecute = mockBrowser.execute as ReturnType<typeof vi.fn>;
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      await service.before({} as any, [], mockBrowser);

      const clearCall = originalExecute.mock.calls.find(
        ([script]) => typeof script === 'string' && script.includes('__wdio_mocks__'),
      );
      expect(clearCall).toBeUndefined();
    });

    it('should handle stale mock clearing errors gracefully for embedded provider', async () => {
      const mockExecute = vi.fn().mockImplementation((script: unknown) => {
        if (typeof script === 'string' && script.includes('__wdio_mocks__')) {
          return Promise.reject(new Error('execute failed'));
        }
        return Promise.resolve(undefined);
      });
      const mockBrowser = createMockBrowser({ execute: mockExecute });
      const service = new TauriWorkerService({ driverProvider: 'embedded' }, { 'wdio:tauriServiceOptions': {} });

      await expect(service.before({} as any, [], mockBrowser)).resolves.not.toThrow();
    });
  });

  describe('tauri.execute()', () => {
    it('should call updateAllMocks after execute', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      vi.mocked(executeCommand).mockResolvedValueOnce('result' as any);
      vi.mocked(mockStore.getMocks).mockReturnValue([]);

      await (mockBrowser as any).tauri.execute(() => 'result');

      expect(mockStore.getMocks).toHaveBeenCalled();
    });

    it('should return the result from execute', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      vi.mocked(executeCommand).mockResolvedValueOnce('my-result' as any);

      const result = await (mockBrowser as any).tauri.execute(() => 'my-result');

      expect(result).toBe('my-result');
    });

    it('should call update() on each mock in the store after execute', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      vi.mocked(mockStore.getMocks).mockReturnValue([['tauri.read_clipboard', { update: mockUpdate } as any]]);
      vi.mocked(executeCommand).mockResolvedValueOnce(undefined as any);

      await (mockBrowser as any).tauri.execute(() => undefined);

      expect(mockUpdate).toHaveBeenCalledOnce();
    });

    it('should throw AggregateError when a mock update fails on both initial attempt and retry', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      const failingUpdate = vi.fn().mockRejectedValue(new Error('connection refused'));
      vi.mocked(mockStore.getMocks).mockReturnValue([['tauri.cmd', { update: failingUpdate } as any]]);
      vi.mocked(executeCommand).mockResolvedValueOnce(undefined as any);

      await expect((mockBrowser as any).tauri.execute(() => undefined)).rejects.toThrow(AggregateError);
      expect(failingUpdate).toHaveBeenCalledTimes(2);
    });

    it('should succeed when a mock update fails on first attempt but succeeds on retry', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      const updateFn = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce(undefined);
      vi.mocked(mockStore.getMocks).mockReturnValue([['tauri.cmd', { update: updateFn } as any]]);
      vi.mocked(executeCommand).mockResolvedValueOnce(undefined as any);

      await expect((mockBrowser as any).tauri.execute(() => undefined)).resolves.not.toThrow();
      expect(updateFn).toHaveBeenCalledTimes(2);
    });

    it('should include the failing mock ID in the AggregateError message', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      const failingUpdate = vi.fn().mockRejectedValue(new Error('fail'));
      vi.mocked(mockStore.getMocks).mockReturnValue([['tauri.read_file', { update: failingUpdate } as any]]);
      vi.mocked(executeCommand).mockResolvedValueOnce(undefined as any);

      const err = await (mockBrowser as any).tauri.execute(() => undefined).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AggregateError);
      expect((err as AggregateError).message).toContain('tauri.read_file');
    });

    it('should run mock updates sequentially on win32', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      try {
        const mockBrowser = createMockBrowser();
        const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
        await service.before({} as any, [], mockBrowser);

        const callOrder: string[] = [];
        const makeUpdate = (id: string) =>
          vi.fn().mockImplementation(async () => {
            callOrder.push(`start:${id}`);
            await Promise.resolve();
            callOrder.push(`end:${id}`);
          });

        vi.mocked(mockStore.getMocks).mockReturnValue([
          ['tauri.a', { update: makeUpdate('a') } as any],
          ['tauri.b', { update: makeUpdate('b') } as any],
        ]);
        vi.mocked(executeCommand).mockResolvedValueOnce(undefined as any);

        await (mockBrowser as any).tauri.execute(() => undefined);

        expect(callOrder).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }
    });
  });

  describe('tauri.emitEvent()', () => {
    it('should be exposed on the tauri API', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);
      expect(typeof (mockBrowser as any).tauri.emitEvent).toBe('function');
    });

    it('should call browser.execute with the helper invocation in browser mode', async () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute });
      const service = new TauriWorkerService(
        { mode: 'browser', devServerUrl: 'http://localhost:1420' },
        { 'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: 'http://localhost:1420' } },
      );
      await service.before({} as any, [], mockBrowser);

      mockExecute.mockClear();
      await (mockBrowser as any).tauri.emitEvent('foo', { x: 1 });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [fn, ...args] = mockExecute.mock.calls[0];
      expect(typeof fn).toBe('function');
      expect(args).toEqual(['foo', { x: 1 }, undefined]);
    });

    it('should activate browser mode when mode is set only at the capability level', async () => {
      // Real configs use services: ['tauri'] + capability-level wdio:tauriServiceOptions, so the
      // worker must read options from the capability (not just service-level), or before() falls
      // back to the native binary path. Regression for the browser-mode package test.
      const mockUrl = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ url: mockUrl });
      const service = new TauriWorkerService(
        {} as never,
        {
          'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: 'http://localhost:5173' },
        } as never,
      );

      await service.before({} as never, [], mockBrowser);

      // Browser mode navigates to the dev server; the native path never would.
      expect(mockUrl).toHaveBeenCalledWith('http://localhost:5173');
      expect(mockBrowser.overwriteCommand).toHaveBeenCalledWith('url', expect.any(Function), false);
    });

    it('should pass the target through in browser mode', async () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute });
      const service = new TauriWorkerService(
        { mode: 'browser', devServerUrl: 'http://localhost:1420' },
        { 'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: 'http://localhost:1420' } },
      );
      await service.before({} as any, [], mockBrowser);

      mockExecute.mockClear();
      await (mockBrowser as any).tauri.emitEvent('focus', null, 'main');

      const [, , , target] = mockExecute.mock.calls[0];
      expect(target).toBe('main');
    });

    it('should call execute() with a function that uses tauri.event in native mode', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      vi.mocked(executeCommand).mockResolvedValueOnce(undefined as any);

      await (mockBrowser as any).tauri.emitEvent('foo', 'payload');

      expect(executeCommand).toHaveBeenCalledTimes(1);
      const [, fn, ...args] = vi.mocked(executeCommand).mock.calls[0];
      expect(typeof fn).toBe('function');
      expect(args).toEqual(['foo', 'payload']);
    });

    it('should route through tauri.event.emit() when target is omitted in native mode', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      vi.mocked(executeCommand).mockResolvedValueOnce(undefined as any);
      await (mockBrowser as any).tauri.emitEvent('foo', 'payload');

      const [, fn, ...args] = vi.mocked(executeCommand).mock.calls[0];
      const emit = vi.fn().mockResolvedValue(undefined);
      const emitTo = vi.fn().mockResolvedValue(undefined);
      await (fn as any)({ event: { emit, emitTo } }, ...args);

      expect(emit).toHaveBeenCalledWith('foo', 'payload');
      expect(emitTo).not.toHaveBeenCalled();
    });

    it('should route through tauri.event.emitTo() when target is provided in native mode', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      vi.mocked(executeCommand).mockResolvedValueOnce(undefined as any);
      await (mockBrowser as any).tauri.emitEvent('foo', 'payload', 'main');

      const [, fn, ...args] = vi.mocked(executeCommand).mock.calls[0];
      const emit = vi.fn().mockResolvedValue(undefined);
      const emitTo = vi.fn().mockResolvedValue(undefined);
      await (fn as any)({ event: { emit, emitTo } }, ...args);

      expect(emitTo).toHaveBeenCalledWith('main', 'foo', 'payload');
      expect(emit).not.toHaveBeenCalled();
    });

    it('should call updateAllMocks after emitting in browser mode', async () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute });
      const service = new TauriWorkerService(
        { mode: 'browser', devServerUrl: 'http://localhost:1420' },
        { 'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: 'http://localhost:1420' } },
      );
      await service.before({} as any, [], mockBrowser);

      vi.mocked(mockStore.getMocks).mockReturnValue([]);

      await (mockBrowser as any).tauri.emitEvent('foo');

      expect(mockStore.getMocks).toHaveBeenCalled();
    });

    it('should call updateAllMocks after emitting in native mode', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      vi.mocked(executeCommand).mockResolvedValueOnce(undefined as any);
      vi.mocked(mockStore.getMocks).mockReturnValue([]);

      await (mockBrowser as any).tauri.emitEvent('foo');

      expect(mockStore.getMocks).toHaveBeenCalled();
    });
  });

  describe('tauri.isMockFunction()', () => {
    it('should return true when the command name is in the mock store', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      vi.mocked(mockStore.getMock).mockReturnValue({} as any);

      expect((mockBrowser as any).tauri.isMockFunction('read_clipboard')).toBe(true);
      expect(mockStore.getMock).toHaveBeenCalledWith('tauri.read_clipboard');
    });

    it('should return false when the command name is not in the mock store', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      vi.mocked(mockStore.getMock).mockImplementation(() => {
        throw new Error('not found');
      });

      expect((mockBrowser as any).tauri.isMockFunction('unknown_command')).toBe(false);
    });

    it('should delegate to base isMockFunction for non-string values', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      const { isMockFunction: baseMockFn } = await import('../src/commands/mock.js');
      vi.mocked(baseMockFn).mockReturnValue(false);

      (mockBrowser as any).tauri.isMockFunction({});

      expect(baseMockFn).toHaveBeenCalledWith({});
    });
  });

  describe('beforeTest()', () => {
    it('should call clearAllMocks when clearMocks option is true', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({ clearMocks: true }, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.beforeTest({}, {});

      expect(clearAllMocks).toHaveBeenCalled();
    });

    it('should call resetAllMocks when resetMocks option is true', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({ resetMocks: true }, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.beforeTest({}, {});

      expect(resetAllMocks).toHaveBeenCalled();
    });

    it('should call restoreAllMocks when restoreMocks option is true', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({ restoreMocks: true }, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.beforeTest({}, {});

      expect(restoreAllMocks).toHaveBeenCalled();
    });

    it('should not call any mock functions when all options are false', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService(
        { clearMocks: false, resetMocks: false, restoreMocks: false },
        { 'wdio:tauriServiceOptions': {} },
      );
      (service as any).browser = mockBrowser;

      await service.beforeTest({}, {});

      expect(clearAllMocks).not.toHaveBeenCalled();
      expect(resetAllMocks).not.toHaveBeenCalled();
      expect(restoreAllMocks).not.toHaveBeenCalled();
    });

    it('should call all mock functions when all options are true', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService(
        { clearMocks: true, resetMocks: true, restoreMocks: true },
        { 'wdio:tauriServiceOptions': {} },
      );
      (service as any).browser = mockBrowser;

      await service.beforeTest({}, {});

      expect(clearAllMocks).toHaveBeenCalled();
      expect(resetAllMocks).toHaveBeenCalled();
      expect(restoreAllMocks).toHaveBeenCalled();
    });

    it('should pass clearMocksPrefix to clearAllMocks', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService(
        { clearMocks: true, clearMocksPrefix: 'plugin:' },
        { 'wdio:tauriServiceOptions': {} },
      );
      (service as any).browser = mockBrowser;

      await service.beforeTest({}, {});

      expect(clearAllMocks).toHaveBeenCalledWith('plugin:');
    });
  });

  describe('beforeCommand()', () => {
    it('should call ensureActiveWindowFocus for non-multiremote browser', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.beforeCommand('getTitle', []);

      expect(ensureActiveWindowFocus).toHaveBeenCalledWith(mockBrowser, 'getTitle');
    });

    it('should return early when browser is multiremote', async () => {
      const mockBrowser = createMockBrowser({ isMultiremote: true });
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.beforeCommand('getTitle', []);

      expect(ensureActiveWindowFocus).not.toHaveBeenCalled();
    });

    it('should return early when no browser exists', async () => {
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      await service.beforeCommand('getTitle', []);

      expect(ensureActiveWindowFocus).not.toHaveBeenCalled();
    });

    it('should handle ensureActiveWindowFocus errors gracefully', async () => {
      vi.mocked(ensureActiveWindowFocus).mockRejectedValueOnce(new Error('focus failed'));
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await expect(service.beforeCommand('getTitle', [])).resolves.not.toThrow();
    });
  });

  describe('afterSession()', () => {
    it('should call mockStore.clear()', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.afterSession({}, {} as any, []);

      expect(mockStore.clear).toHaveBeenCalled();
    });

    it('should delete session for standard browser', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.afterSession({}, {} as any, []);

      expect(mockBrowser.deleteSession).toHaveBeenCalled();
    });

    it('should clear window state with session ID for standard browser', async () => {
      const mockBrowser = createMockBrowser({ sessionId: 'sess-abc' });
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.afterSession({}, {} as any, []);

      expect(clearWindowState).toHaveBeenCalledWith('sess-abc');
    });

    it('should handle gracefully when no browser exists', async () => {
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      await expect(service.afterSession({}, {} as any, [])).resolves.not.toThrow();
      expect(clearWindowState).toHaveBeenCalledWith();
    });

    it('should call restoreAllMocks before clearing mock store', async () => {
      const callOrder: string[] = [];
      vi.mocked(restoreAllMocks).mockImplementation(async () => {
        callOrder.push('restoreAllMocks');
      });
      vi.mocked(mockStore.clear).mockImplementation(() => {
        callOrder.push('mockStore.clear');
      });

      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.afterSession({}, {} as any, []);

      expect(callOrder).toEqual(['restoreAllMocks', 'mockStore.clear']);
    });

    it('should handle deleteSession errors gracefully', async () => {
      const mockBrowser = createMockBrowser({
        deleteSession: vi.fn().mockRejectedValue(new Error('session error')),
      });
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await expect(service.afterSession({}, {} as any, [])).resolves.not.toThrow();
    });

    it('should handle restoreAllMocks errors gracefully', async () => {
      vi.mocked(restoreAllMocks).mockRejectedValueOnce(new Error('restore error'));
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await expect(service.afterSession({}, {} as any, [])).resolves.not.toThrow();
      expect(mockBrowser.deleteSession).toHaveBeenCalled();
    });
  });
});

describe('LogParser', () => {
  describe('parseLogLines', () => {
    it('should export parseLogLines function', () => {
      expect(typeof parseLogLines).toBe('function');
    });

    it('should parse simple log lines', () => {
      const lines = '[INFO] Test log message';
      const parsed = parseLogLines(lines);
      expect(parsed.length).toBeGreaterThan(0);
    });
  });
});

describe('LogWriter', () => {
  describe('exports', () => {
    it('should export closeLogWriter function', () => {
      expect(typeof closeLogWriter).toBe('function');
    });

    it('should export getLogWriter function', () => {
      expect(typeof getLogWriter).toBe('function');
    });

    it('should export isLogWriterInitialized function', () => {
      expect(typeof isLogWriterInitialized).toBe('function');
    });

    it('should handle closeLogWriter when not initialized', () => {
      expect(() => closeLogWriter()).not.toThrow();
    });
  });
});
