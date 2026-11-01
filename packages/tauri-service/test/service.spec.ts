import { mockPlatform, restorePlatform } from '@repo/test-utils';
import { closeLogWriter, getLogWriter, isLogWriterInitialized } from '@wdio/native-core';
import type { TauriAPIs, TauriEventTarget, TauriMock, TauriServiceAPI } from '@wdio/native-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLogLines } from '../src/logParser.js';

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
    getAllMocks: vi.fn().mockReturnValue([]),
    getMock: vi.fn(),
  },
}));

vi.mock('../src/commands/execute.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/commands/triggerDeeplink.js', () => ({
  triggerDeeplink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/window.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/window.js')>();
  return {
    ...actual,
    clearWindowState: vi.fn(),
    ensureActiveWindowFocus: vi.fn().mockResolvedValue(undefined),
    getDefaultWindowLabel: vi.fn().mockReturnValue('main'),
    listWindowLabels: vi.fn().mockResolvedValue(['main']),
    setCurrentWindowLabel: vi.fn(),
    setSessionProvider: vi.fn(),
    suppressActiveWindowFocus: vi.fn(),
    switchWindowByLabel: vi.fn().mockResolvedValue(undefined),
  };
});

import { waitUntilWindowAvailable } from '@wdio/native-utils';
import { execute as executeCommand } from '../src/commands/execute.js';
import { clearAllMocks, resetAllMocks, restoreAllMocks } from '../src/commands/mock.js';
import { triggerDeeplink } from '../src/commands/triggerDeeplink.js';
import mockStore from '../src/mockStore.js';
import TauriWorkerService from '../src/service.js';
import type { TauriCapabilities } from '../src/types.js';
import {
  clearWindowState,
  ensureActiveWindowFocus,
  setCurrentWindowLabel,
  setSessionProvider,
  suppressActiveWindowFocus,
  withInternalWindowSwitch,
} from '../src/window.js';

function createMockBrowser(overrides: Record<string, unknown> = {}): WebdriverIO.Browser {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    executeAsyncScript: vi.fn().mockResolvedValue(undefined),
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

  describe('option merging', () => {
    it('should keep a global option when the capability sets it to undefined', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService(
        { driverProvider: 'external' },
        { 'wdio:tauriServiceOptions': { driverProvider: undefined } },
      );

      await service.before({} as never, [], mockBrowser);

      expect(setSessionProvider).toHaveBeenCalledWith(mockBrowser, 'external');
    });

    it('should let a defined capability option override the global one', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService(
        { driverProvider: 'external' },
        { 'wdio:tauriServiceOptions': { driverProvider: 'crabnebula' } },
      );

      await service.before({} as never, [], mockBrowser);

      expect(setSessionProvider).toHaveBeenCalledWith(mockBrowser, 'crabnebula');
    });

    it("should use the launcher's first-instance driverProvider for every multiremote instance", async () => {
      const instanceA = createMockBrowser({ sessionId: 'session-a' });
      const instanceB = createMockBrowser({ sessionId: 'session-b' });
      const executeA = instanceA.execute as ReturnType<typeof vi.fn>;
      const executeB = instanceB.execute as ReturnType<typeof vi.fn>;
      const mrBrowser = createMockBrowser({
        isMultiremote: true,
        instances: ['browserA', 'browserB'],
        getInstance: (name: string) => (name === 'browserA' ? instanceA : instanceB),
      });
      const service = new TauriWorkerService({}, {
        browserA: { capabilities: { 'wdio:tauriServiceOptions': { driverProvider: 'external' } } },
        browserB: { capabilities: {} },
      } as unknown as TauriCapabilities);

      await service.before({} as never, [], mrBrowser);

      const clearedStaleMocks = (execute: ReturnType<typeof vi.fn>) =>
        execute.mock.calls.some(([script]) => typeof script === 'function' && script.name === 'clearStaleMocks');
      expect(setSessionProvider).toHaveBeenCalledWith(instanceA, 'external');
      expect(setSessionProvider).toHaveBeenCalledWith(instanceB, 'external');
      expect(clearedStaleMocks(executeA)).toBe(false);
      expect(clearedStaleMocks(executeB)).toBe(false);
    });
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
      const mockExecuteAsyncScript = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute, executeAsyncScript: mockExecuteAsyncScript });
      const service = new TauriWorkerService({ driverProvider: 'external' }, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);
      mockBrowser.execute('return document.title');

      // String scripts should use executeAsyncScript with explicit done callback for WebKit compatibility
      expect(mockExecuteAsyncScript).toHaveBeenCalled();
      const callArgs = mockExecuteAsyncScript.mock.calls[0];
      // The script should contain .then( to handle async results and __wdio_error__ for error handling
      expect(callArgs[0]).toContain('.then(');
      expect(callArgs[0]).toContain('__wdio_error__');
      // execute should NOT be called for string scripts
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should prepend return for expression-style string scripts on non-embedded providers', () => {
      const mockExecuteAsyncScript = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ executeAsyncScript: mockExecuteAsyncScript });
      const service = new TauriWorkerService({ driverProvider: 'external' }, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);
      mockBrowser.execute('1 + 2 + 3');

      expect(mockExecuteAsyncScript).toHaveBeenCalled();
      expect(mockExecuteAsyncScript.mock.calls[0][0]).toContain('return 1 + 2 + 3;');
    });

    it('should not prepend return for statement-style string scripts on non-embedded providers', () => {
      const mockExecuteAsyncScript = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ executeAsyncScript: mockExecuteAsyncScript });
      const service = new TauriWorkerService({ driverProvider: 'external' }, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);
      mockBrowser.execute('const x = 1; return x');

      expect(mockExecuteAsyncScript).toHaveBeenCalled();
      const wrappedScript = mockExecuteAsyncScript.mock.calls[0][0] as string;
      // The body should NOT have an extra "return" prepended
      expect(wrappedScript).toContain('const x = 1; return x');
      expect(wrappedScript).not.toMatch(/return const/);
    });

    it('should pass function scripts as-is for non-embedded providers using executeAsyncScript', () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined);
      const mockExecuteAsyncScript = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute, executeAsyncScript: mockExecuteAsyncScript });
      const service = new TauriWorkerService({ driverProvider: 'external' }, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);
      const testFn = (a: number, b: number) => a + b;
      mockBrowser.execute(testFn as any, 1, 2);

      // Functions should use executeAsyncScript for WebKit compatibility
      expect(mockExecuteAsyncScript).toHaveBeenCalledWith(expect.stringContaining('(a, b) => a + b'), [1, 2]);
      // execute should NOT be called
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should send element arguments as element references on non-embedded providers', async () => {
      const mockExecuteAsyncScript = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ executeAsyncScript: mockExecuteAsyncScript });
      const service = new TauriWorkerService({ driverProvider: 'external' }, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);
      const element = { selector: '#button', elementId: 'el-1', click: vi.fn() };
      await mockBrowser.execute(((el: unknown, label: string) => [el, label]) as any, element, 'label');

      expect(mockExecuteAsyncScript).toHaveBeenCalledWith(expect.any(String), [
        { 'element-6066-11e4-a52e-4f735466cecf': 'el-1' },
        'label',
      ]);
    });

    it('should reject an element argument that was not found on non-embedded providers', async () => {
      const mockExecuteAsyncScript = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ executeAsyncScript: mockExecuteAsyncScript });
      const service = new TauriWorkerService({ driverProvider: 'external' }, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);

      await expect(
        mockBrowser.execute((() => undefined) as any, { selector: '#missing', elementId: undefined }),
      ).rejects.toMatchObject({
        message: `The element with selector "#missing" you are trying to pass into the execute method wasn't found`,
      });
      expect(mockExecuteAsyncScript).not.toHaveBeenCalled();
    });

    it('should route executeWithinTauri through executeAsyncScript on non-embedded providers', () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined);
      const mockExecuteAsyncScript = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute, executeAsyncScript: mockExecuteAsyncScript });
      const service = new TauriWorkerService({ driverProvider: 'external' }, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);

      // Simulate the internal call that commands/execute.ts makes
      const executeWithinTauri = async function executeWithinTauri(
        _script: string,
        _execOptions: object,
        _argsJson: string,
      ) {};
      mockBrowser.execute(executeWithinTauri as any, 'fn string', {}, '[]');

      // Must use executeAsyncScript — the async function returns a Promise that the sync
      // WebDriver endpoint on WebKit (WKWebView/macOS) cannot await.
      expect(mockExecuteAsyncScript).toHaveBeenCalled();
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

    it('should treat an unset driverProvider as embedded', () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute });
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      (service as any).patchBrowserExecute(mockBrowser);
      const testFn = (a: number, b: number) => a + b;
      mockBrowser.execute(testFn as any, 1, 2);

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
      const mockExecuteAsyncScript = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute, executeAsyncScript: mockExecuteAsyncScript });
      const service = new TauriWorkerService({ driverProvider: 'external' }, { 'wdio:tauriServiceOptions': {} });

      await service.before({} as any, [], mockBrowser);

      // For non-embedded providers, executeAsyncScript is used (WebKit compatibility)
      expect(mockExecuteAsyncScript).toHaveBeenCalled();
    });

    it('should skip plugin initialization wait for crabnebula driver provider', async () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined);
      const mockExecuteAsyncScript = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ execute: mockExecute, executeAsyncScript: mockExecuteAsyncScript });
      const service = new TauriWorkerService({ driverProvider: 'crabnebula' }, { 'wdio:tauriServiceOptions': {} });

      await service.before({} as any, [], mockBrowser);

      // CrabNebula skips the plugin initialization wait entirely
      expect(mockExecute).not.toHaveBeenCalled();
      expect(mockExecuteAsyncScript).not.toHaveBeenCalled();
    });

    it('should handle plugin initialization error gracefully', async () => {
      const mockExecuteAsyncScript = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = createMockBrowser({ executeAsyncScript: mockExecuteAsyncScript });
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      await expect(service.before({} as any, [], mockBrowser)).resolves.not.toThrow();
    });

    it('should install command overrides after initialization', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      await service.before({} as any, [], mockBrowser);

      expect(mockBrowser.overwriteCommand).toHaveBeenCalledWith('click', expect.any(Function), {
        attachToElement: true,
      });
      expect(mockBrowser.overwriteCommand).toHaveBeenCalledWith('doubleClick', expect.any(Function), {
        attachToElement: true,
      });
      expect(mockBrowser.overwriteCommand).toHaveBeenCalledWith('setValue', expect.any(Function), {
        attachToElement: true,
      });
      expect(mockBrowser.overwriteCommand).toHaveBeenCalledWith('clearValue', expect.any(Function), {
        attachToElement: true,
      });
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
      if (!clickCall) {
        throw new Error('click command was not overwritten');
      }
      const override = clickCall[1] as unknown as (
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

    it('should chain a user-registered override instead of clobbering it', async () => {
      const order: string[] = [];
      // A user's own overwriteCommand('click', ...), as WDIO stores it.
      const userOverride = vi.fn(async function (
        this: unknown,
        origCommand: (...a: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) {
        order.push('user');
        return origCommand(...args);
      });
      const mockBrowser = createMockBrowser({
        __propertiesObject__: { __elementOverrides__: { value: { click: userOverride } } },
      });
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      vi.mocked(mockStore.getMocks).mockReturnValue([['tauri.cmd', { update: mockUpdate } as any]]);

      const clickCall = vi.mocked(mockBrowser.overwriteCommand).mock.calls.find((c) => c[0] === 'click');
      if (!clickCall) {
        throw new Error('click command was not overwritten');
      }
      const override = clickCall[1] as unknown as (
        this: unknown,
        originalCommand: (...args: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) => Promise<unknown>;

      const originalCommand = vi.fn(async () => {
        order.push('original');
        return 'ok';
      });
      const result = await override.call({}, originalCommand);

      // User's override stays the outer wrapper; its origClick ran the original
      // command AND synced mocks — exactly what the bug report expects.
      expect(userOverride).toHaveBeenCalledOnce();
      expect(originalCommand).toHaveBeenCalledOnce();
      expect(mockUpdate).toHaveBeenCalledOnce();
      expect(order).toEqual(['user', 'original']);
      expect(result).toBe('ok');
    });

    it('should coalesce concurrent overrides into at most two scheduler batches', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      vi.mocked(mockStore.getMocks).mockReturnValue([['tauri.cmd', { update: mockUpdate } as any]]);

      const clickCall = vi.mocked(mockBrowser.overwriteCommand).mock.calls.find((c) => c[0] === 'click');
      if (!clickCall) {
        throw new Error('click command was not overwritten');
      }
      const override = clickCall[1] as unknown as (
        this: unknown,
        originalCommand: (...args: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) => Promise<unknown>;

      const originalCommand = vi.fn().mockResolvedValue('ok');
      // Three interactions fire before the first sync settles. The scheduler runs the
      // first batch immediately; every caller after that shares one queued slot, so
      // update runs exactly twice (current + queued) — not once per interaction. Three
      // callers (rather than two) is what proves the shared slot: a broken queued-slot
      // branch would let the third caller spawn its own batch and update would run 3x.
      const p1 = override.call({}, originalCommand);
      const p2 = override.call({}, originalCommand);
      const p3 = override.call({}, originalCommand);
      await Promise.all([p1, p2, p3]);

      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });

    it('should recover the scheduler after a batch update rejects', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      // First batch: both the initial attempt and its 50ms retry fail; a later
      // interaction must still get a fresh batch (the scheduler must not wedge on
      // the rejected slot).
      const mockUpdate = vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(undefined);
      vi.mocked(mockStore.getMocks).mockReturnValue([['tauri.cmd', { update: mockUpdate } as any]]);

      const clickCall = vi.mocked(mockBrowser.overwriteCommand).mock.calls.find((c) => c[0] === 'click');
      if (!clickCall) {
        throw new Error('click command was not overwritten');
      }
      const override = clickCall[1] as unknown as (
        this: unknown,
        originalCommand: (...args: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) => Promise<unknown>;

      const originalCommand = vi.fn().mockResolvedValue('ok');
      await override.call({}, originalCommand).catch(() => undefined);
      await override.call({}, originalCommand);

      // 2 from the failed batch (initial + retry) + 1 from the recovered batch.
      expect(mockUpdate).toHaveBeenCalledTimes(3);
    });

    it('should not leak an unhandled rejection when a queued batch fails', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);

      // Every attempt (initial + retry) fails, so both the running batch and the
      // promoted queued batch reject. The promoted batch's internal wrapper is held
      // only by the scheduler, so its rejection must be swallowed — otherwise it
      // surfaces as an unhandled rejection that crashes the worker.
      const mockUpdate = vi.fn().mockRejectedValue(new Error('boom'));
      vi.mocked(mockStore.getMocks).mockReturnValue([['tauri.cmd', { update: mockUpdate } as any]]);

      const clickCall = vi.mocked(mockBrowser.overwriteCommand).mock.calls.find((c) => c[0] === 'click');
      if (!clickCall) {
        throw new Error('click command was not overwritten');
      }
      const override = clickCall[1] as unknown as (
        this: unknown,
        originalCommand: (...args: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) => Promise<unknown>;
      const originalCommand = vi.fn().mockResolvedValue('ok');

      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        // Two concurrent interactions: the second is queued then promoted; both reject.
        // Callers observe their own rejections; only the orphaned wrapper would leak.
        const p1 = override.call({}, originalCommand).catch(() => undefined);
        const p2 = override.call({}, originalCommand).catch(() => undefined);
        await Promise.all([p1, p2]);
        // Let the promoted wrapper settle so Node can flag any unhandled rejection.
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }

      expect(unhandled).toEqual([]);
    });

    it.each([
      ['embedded', { driverProvider: 'embedded' as const }],
      ['unset', {}],
    ])('should clear stale mocks at session start when the driver provider is %s', async (_name, options) => {
      const mockBrowser = createMockBrowser();
      const originalExecute = mockBrowser.execute as ReturnType<typeof vi.fn>;
      const service = new TauriWorkerService(options, { 'wdio:tauriServiceOptions': {} });

      await service.before({} as any, [], mockBrowser);

      // For embedded, patchedExecute passes function scripts through untouched, so
      // clearStaleMocks reaches originalExecute as a function with its name preserved.
      const clearCall = originalExecute.mock.calls.find(
        ([script]) => typeof script === 'function' && script.name === 'clearStaleMocks',
      );
      expect(clearCall).toBeDefined();
    });

    it.each(['external', 'crabnebula'] as const)(
      'should not clear stale mocks for the %s provider',
      async (driverProvider) => {
        const mockBrowser = createMockBrowser();
        const browserMocks = Object.values(mockBrowser).filter((value) => vi.isMockFunction(value));
        const service = new TauriWorkerService({ driverProvider }, { 'wdio:tauriServiceOptions': {} });

        await service.before({} as any, [], mockBrowser);

        const scripts = browserMocks.flatMap((fn) => fn.mock.calls.map(([script]) => String(script)));
        expect(scripts.some((script) => script.includes('clearStaleMocks'))).toBe(false);
      },
    );

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
    let mockBrowser: ReturnType<typeof createMockBrowser>;

    beforeEach(async () => {
      mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);
    });

    it('should call updateAllMocks after execute', async () => {
      vi.mocked(executeCommand).mockResolvedValueOnce('result' as any);
      vi.mocked(mockStore.getMocks).mockReturnValue([]);

      await (mockBrowser as any).tauri.execute(() => 'result');

      expect(mockStore.getMocks).toHaveBeenCalled();
    });

    it('should return the result from execute', async () => {
      vi.mocked(executeCommand).mockResolvedValueOnce('my-result' as any);

      const result = await (mockBrowser as any).tauri.execute(() => 'my-result');

      expect(result).toBe('my-result');
    });

    it('should call update() on each mock in the store after execute', async () => {
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      vi.mocked(mockStore.getMocks).mockReturnValue([['tauri.read_clipboard', { update: mockUpdate } as any]]);
      vi.mocked(executeCommand).mockResolvedValueOnce(undefined as any);

      await (mockBrowser as any).tauri.execute(() => undefined);

      expect(mockUpdate).toHaveBeenCalledOnce();
    });

    it('should throw AggregateError when a mock update fails on both initial attempt and retry', async () => {
      const failingUpdate = vi.fn().mockRejectedValue(new Error('connection refused'));
      vi.mocked(mockStore.getMocks).mockReturnValue([['tauri.cmd', { update: failingUpdate } as any]]);
      vi.mocked(executeCommand).mockResolvedValueOnce(undefined as any);

      await expect((mockBrowser as any).tauri.execute(() => undefined)).rejects.toThrow(AggregateError);
      expect(failingUpdate).toHaveBeenCalledTimes(2);
    });

    it('should succeed when a mock update fails on first attempt but succeeds on retry', async () => {
      const updateFn = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce(undefined);
      vi.mocked(mockStore.getMocks).mockReturnValue([['tauri.cmd', { update: updateFn } as any]]);
      vi.mocked(executeCommand).mockResolvedValueOnce(undefined as any);

      await expect((mockBrowser as any).tauri.execute(() => undefined)).resolves.not.toThrow();
      expect(updateFn).toHaveBeenCalledTimes(2);
    });

    it('should include the failing mock ID in the AggregateError message', async () => {
      const failingUpdate = vi.fn().mockRejectedValue(new Error('fail'));
      vi.mocked(mockStore.getMocks).mockReturnValue([['tauri.read_file', { update: failingUpdate } as any]]);
      vi.mocked(executeCommand).mockResolvedValueOnce(undefined as any);

      const err = await (mockBrowser as any).tauri.execute(() => undefined).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AggregateError);
      expect((err as AggregateError).message).toContain('tauri.read_file');
    });

    it('should run mock updates sequentially on win32', async () => {
      mockPlatform('win32');

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
        restorePlatform();
      }
    });

    it("should sync only the instance's own mocks in multiremote, and every instance's on the root", async () => {
      const instanceA = createMockBrowser({ sessionId: 'session-a' });
      const instanceB = createMockBrowser({ sessionId: 'session-b' });
      const mrBrowser = createMockBrowser({
        isMultiremote: true,
        instances: ['browserA', 'browserB'],
        getInstance: (name: string) => (name === 'browserA' ? instanceA : instanceB),
      });
      const service = new TauriWorkerService({}, {
        browserA: { capabilities: { 'wdio:tauriServiceOptions': {} } },
        browserB: { capabilities: { 'wdio:tauriServiceOptions': {} } },
      } as unknown as TauriCapabilities);
      await service.before({} as never, [], mrBrowser);
      vi.mocked(mockStore.getMocks).mockClear();
      vi.mocked(mockStore.getAllMocks).mockClear();

      await (instanceA as any).tauri.execute(() => undefined);

      expect(mockStore.getMocks).toHaveBeenCalledExactlyOnceWith(instanceA);
      expect(mockStore.getAllMocks).not.toHaveBeenCalled();

      await (mrBrowser as any).tauri.execute(() => undefined);

      expect(mockStore.getAllMocks).toHaveBeenCalledOnce();
    });
  });

  describe('tauri.emitEvent()', () => {
    const tauriOf = (b: WebdriverIO.Browser) => (b as unknown as { tauri: TauriServiceAPI }).tauri;

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
      expect(mockBrowser.overwriteCommand).toHaveBeenCalledWith('url', expect.any(Function));
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

    it('should emit on every instance, and sync mocks once, on the multiremote root in browser mode', async () => {
      const instances: Record<string, WebdriverIO.Browser> = {
        browserA: createMockBrowser({ sessionId: 'session-a' }),
        browserB: createMockBrowser({ sessionId: 'session-b' }),
      };
      const mrBrowser = createMockBrowser({
        isMultiremote: true,
        instances: Object.keys(instances),
        getInstance: (name: string) => instances[name],
      });
      const options = { mode: 'browser', devServerUrl: 'http://localhost:1420' } as const;
      const service = new TauriWorkerService(options, {
        browserA: { capabilities: { 'wdio:tauriServiceOptions': options } },
        browserB: { capabilities: { 'wdio:tauriServiceOptions': options } },
      } as unknown as TauriCapabilities);
      await service.before({} as never, [], mrBrowser);
      const executes = [mrBrowser, ...Object.values(instances)].map((b) => vi.mocked(b.execute));
      for (const exec of executes) {
        exec.mockClear();
      }
      vi.mocked(mockStore.getAllMocks).mockClear();

      await tauriOf(mrBrowser).emitEvent('foo', 'payload', 'main');

      const [rootExecute, ...instanceExecutes] = executes;
      expect(rootExecute).not.toHaveBeenCalled();
      for (const exec of instanceExecutes) {
        expect(exec).toHaveBeenCalledTimes(1);
        expect(exec.mock.calls[0].slice(1)).toEqual(['foo', 'payload', 'main']);
      }
      expect(mockStore.getAllMocks).toHaveBeenCalledTimes(1);
    });

    describe('in native mode', () => {
      async function emit(target?: string | TauriEventTarget | null) {
        const mockBrowser = createMockBrowser();
        const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
        await service.before({} as never, [], mockBrowser);
        await tauriOf(mockBrowser).emitEvent('foo', 'payload', target as string | TauriEventTarget | undefined);
      }

      // Runs each script emitEvent handed to execute(), as the app would
      async function runInApp(tauriInternals: unknown) {
        const mockAwareInvoke = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('__TAURI_INTERNALS__', tauriInternals);
        for (const [, script, ...args] of vi.mocked(executeCommand).mock.calls) {
          await (script as (tauri: TauriAPIs, ...a: unknown[]) => unknown)(
            { core: { invoke: mockAwareInvoke } },
            ...args,
          );
        }
        return mockAwareInvoke;
      }

      afterEach(() => {
        vi.unstubAllGlobals();
      });

      it.each([
        ['omitted', undefined, 'plugin:event|emit', { event: 'foo', payload: 'payload' }],
        ['null', null, 'plugin:event|emit', { event: 'foo', payload: 'payload' }],
        [
          'a label',
          'main',
          'plugin:event|emit_to',
          { target: { kind: 'AnyLabel', label: 'main' }, event: 'foo', payload: 'payload' },
        ],
        [
          'a TauriEventTarget',
          { kind: 'Window', label: 'main' } as const,
          'plugin:event|emit_to',
          { target: { kind: 'Window', label: 'main' }, event: 'foo', payload: 'payload' },
        ],
      ])('should invoke the event command once when the target is %s', async (_name, target, command, args) => {
        await emit(target);
        const ipcInvoke = vi.fn().mockResolvedValue(undefined);
        await runInApp({ invoke: ipcInvoke });

        expect(ipcInvoke).toHaveBeenCalledTimes(1);
        expect(ipcInvoke).toHaveBeenCalledWith(command, args);
      });

      it("should bypass the user's mocks of the event commands", async () => {
        await emit('main');
        const mockAwareInvoke = await runInApp({ invoke: vi.fn().mockResolvedValue(undefined) });

        expect(mockAwareInvoke).not.toHaveBeenCalled();
      });

      it('should rethrow a failed emit unchanged, without syncing mocks, outside multiremote', async () => {
        const mockBrowser = createMockBrowser();
        const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
        await service.before({} as never, [], mockBrowser);
        vi.mocked(mockStore.getMocks).mockClear();
        const failure = new Error('emit rejected');
        vi.mocked(executeCommand).mockRejectedValueOnce(failure);

        await expect(tauriOf(mockBrowser).emitEvent('foo')).rejects.toBe(failure);
        expect(mockStore.getMocks).not.toHaveBeenCalled();
      });

      describe('on the multiremote root', () => {
        const instances: Record<string, WebdriverIO.Browser> = {};

        async function setUpRoot() {
          instances.browserA = createMockBrowser({ sessionId: 'session-a' });
          instances.browserB = createMockBrowser({ sessionId: 'session-b' });
          const mrBrowser = createMockBrowser({
            isMultiremote: true,
            instances: Object.keys(instances),
            getInstance: (name: string) => instances[name],
          });
          const service = new TauriWorkerService({}, {
            browserA: { capabilities: { 'wdio:tauriServiceOptions': {} } },
            browserB: { capabilities: { 'wdio:tauriServiceOptions': {} } },
          } as unknown as TauriCapabilities);
          await service.before({} as never, [], mrBrowser);
          vi.mocked(executeCommand).mockClear();
          vi.mocked(mockStore.getAllMocks).mockClear();
          return mrBrowser;
        }

        it('should emit on every instance and sync mocks once', async () => {
          const mrBrowser = await setUpRoot();

          await tauriOf(mrBrowser).emitEvent('foo', 'payload', 'main');

          const emitTo = [
            'plugin:event|emit_to',
            { target: { kind: 'AnyLabel', label: 'main' }, event: 'foo', payload: 'payload' },
          ];
          expect(vi.mocked(executeCommand).mock.calls.map(([b, , ...args]) => [b, ...args])).toEqual([
            [instances.browserA, ...emitTo],
            [instances.browserB, ...emitTo],
          ]);
          expect(mockStore.getAllMocks).toHaveBeenCalledTimes(1);
        });

        it('should finish the other instances and sync mocks before reporting the one that failed', async () => {
          const mrBrowser = await setUpRoot();
          const failure = new Error('emit rejected');
          let finishB: () => void = () => {};
          vi.mocked(executeCommand)
            .mockRejectedValueOnce(failure)
            .mockImplementationOnce(
              () =>
                new Promise((resolve) => {
                  finishB = () => resolve(undefined);
                }),
            );

          const emitting = tauriOf(mrBrowser).emitEvent('foo');
          const settled = vi.fn();
          emitting.then(settled, settled);
          expect(executeCommand).toHaveBeenCalledTimes(2);
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(settled).not.toHaveBeenCalled();
          finishB();

          await expect(emitting).rejects.toMatchObject({
            message: "emitEvent('foo') failed on browserA: emit rejected",
            cause: failure,
          });
          expect(mockStore.getAllMocks).toHaveBeenCalledTimes(1);
        });

        it('should report every instance that failed, without syncing mocks when all did', async () => {
          const mrBrowser = await setUpRoot();
          vi.mocked(executeCommand)
            .mockRejectedValueOnce(new Error('a failed'))
            .mockRejectedValueOnce(new Error('b failed'));

          await expect(tauriOf(mrBrowser).emitEvent('foo')).rejects.toMatchObject({
            message: "emitEvent('foo') failed on browserA: a failed; browserB: b failed",
            errors: [{ message: 'a failed' }, { message: 'b failed' }],
          });
          expect(mockStore.getAllMocks).not.toHaveBeenCalled();
        });

        it('should report the failed emit, not the mock sync, when both fail', async () => {
          const mrBrowser = await setUpRoot();
          const update = vi.fn().mockRejectedValue(new Error('sync failed'));
          vi.mocked(mockStore.getAllMocks).mockReturnValueOnce([['tauri.cmd', { update } as unknown as TauriMock]]);
          vi.mocked(executeCommand).mockRejectedValueOnce(new Error('emit rejected'));

          await expect(tauriOf(mrBrowser).emitEvent('foo')).rejects.toMatchObject({
            message: "emitEvent('foo') failed on browserA: emit rejected",
          });
          expect(update).toHaveBeenCalled();
        });
      });
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

  describe('tauri.triggerDeeplink()', () => {
    it.each([
      [undefined, 'embedded'],
      ['external', 'external'],
      ['crabnebula', 'crabnebula'],
    ] as const)('should pass driverProvider %s to triggerDeeplink as %s', async (driverProvider, expected) => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({ driverProvider }, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as never, [], mockBrowser);

      await (mockBrowser as any).tauri.triggerDeeplink('myapp://test');

      const [context] = vi.mocked(triggerDeeplink).mock.contexts;
      expect(context.browser).toBe(mockBrowser);
      expect(context.provider).toBe(expected);
      expect(triggerDeeplink).toHaveBeenCalledWith('myapp://test');
    });

    it("should pass the worker's provider for the multiremote root", async () => {
      const instance = createMockBrowser({ sessionId: 'session-a' });
      const mrBrowser = createMockBrowser({
        isMultiremote: true,
        instances: ['browserA'],
        getInstance: () => instance,
      });
      const service = new TauriWorkerService({}, {
        browserA: { capabilities: { 'wdio:tauriServiceOptions': { driverProvider: 'external' } } },
      } as unknown as TauriCapabilities);
      await service.before({} as never, [], mrBrowser);

      await (mrBrowser as any).tauri.triggerDeeplink('myapp://root');

      const [context] = vi.mocked(triggerDeeplink).mock.contexts;
      expect(context.browser).toBe(mrBrowser);
      expect(context.provider).toBe('external');
    });
  });

  describe('tauri.isMockFunction()', () => {
    let mockBrowser: ReturnType<typeof createMockBrowser>;

    beforeEach(async () => {
      mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      await service.before({} as any, [], mockBrowser);
    });

    it("should return true when the command name is in the browser's mocks", () => {
      vi.mocked(mockStore.getMocks).mockReturnValueOnce([['tauri.read_clipboard', {} as TauriMock]]);

      expect((mockBrowser as any).tauri.isMockFunction('read_clipboard')).toBe(true);
      expect(mockStore.getMocks).toHaveBeenCalledWith(mockBrowser);
    });

    it("should return false when the command name is not in the browser's mocks", () => {
      vi.mocked(mockStore.getMocks).mockReturnValueOnce([['tauri.read_clipboard', {} as TauriMock]]);

      expect((mockBrowser as any).tauri.isMockFunction('unknown_command')).toBe(false);
    });

    it("should look in the instance's own mocks in multiremote, and in every instance's on the root", async () => {
      const instanceA = createMockBrowser({ sessionId: 'session-a' });
      const instanceB = createMockBrowser({ sessionId: 'session-b' });
      const mrBrowser = createMockBrowser({
        isMultiremote: true,
        instances: ['browserA', 'browserB'],
        getInstance: (name: string) => (name === 'browserA' ? instanceA : instanceB),
      });
      const service = new TauriWorkerService({}, {
        browserA: { capabilities: { 'wdio:tauriServiceOptions': {} } },
        browserB: { capabilities: { 'wdio:tauriServiceOptions': {} } },
      } as unknown as TauriCapabilities);
      await service.before({} as never, [], mrBrowser);
      vi.mocked(mockStore.getMocks).mockImplementation((owner) =>
        owner === instanceA ? [['tauri.read_clipboard', {} as TauriMock]] : [],
      );
      vi.mocked(mockStore.getAllMocks).mockReturnValueOnce([['tauri.read_clipboard', {} as TauriMock]]);

      try {
        expect((instanceA as any).tauri.isMockFunction('read_clipboard')).toBe(true);
        expect((instanceB as any).tauri.isMockFunction('read_clipboard')).toBe(false);
        expect((mrBrowser as any).tauri.isMockFunction('read_clipboard')).toBe(true);
      } finally {
        vi.mocked(mockStore.getMocks).mockReset().mockReturnValue([]);
      }
    });

    it('should delegate to base isMockFunction for non-string values', async () => {
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

    it('should still reset and restore when clearing fails, then report every failure', async () => {
      const service = new TauriWorkerService(
        { clearMocks: true, resetMocks: true, restoreMocks: true },
        { 'wdio:tauriServiceOptions': {} },
      );
      (service as any).browser = createMockBrowser();
      vi.mocked(clearAllMocks).mockRejectedValueOnce(new Error('clear failed'));
      vi.mocked(restoreAllMocks).mockRejectedValueOnce(new Error('restore failed'));

      await expect(service.beforeTest({}, {})).rejects.toMatchObject({ message: 'clear failed; restore failed' });

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

    it('should not run focus recovery in front of a window switch', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.beforeCommand('switchToWindow', ['splash']);

      expect(ensureActiveWindowFocus).not.toHaveBeenCalled();
    });
  });

  describe('afterCommand()', () => {
    it('should suppress focus recovery after a successful switchToWindow', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.afterCommand('switchToWindow', ['splash'], undefined);

      expect(suppressActiveWindowFocus).toHaveBeenCalledWith(mockBrowser);
    });

    it('should not suppress focus recovery when the switch failed', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.afterCommand('switchToWindow', ['missing'], undefined, new Error('no such window'));

      expect(suppressActiveWindowFocus).not.toHaveBeenCalled();
    });

    it('should not suppress focus recovery for the service own recovery switch', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await withInternalWindowSwitch(mockBrowser, async () => {
        await service.afterCommand('switchToWindow', ['main'], undefined);
      });

      expect(suppressActiveWindowFocus).not.toHaveBeenCalled();
    });

    it('should ignore commands other than switchToWindow', async () => {
      const mockBrowser = createMockBrowser();
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.afterCommand('getTitle', [], 'title');

      expect(suppressActiveWindowFocus).not.toHaveBeenCalled();
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

    it('should clear window state with session ID for standard browser without deleting the session', async () => {
      const mockBrowser = createMockBrowser({ sessionId: 'sess-abc' });
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.afterSession({}, {} as any, []);

      expect(clearWindowState).toHaveBeenCalledWith('sess-abc');
      expect(mockBrowser.deleteSession).not.toHaveBeenCalled();
    });

    it('should handle gracefully when no browser exists', async () => {
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });

      await expect(service.afterSession({}, {} as any, [])).resolves.not.toThrow();
      expect(clearWindowState).toHaveBeenCalledWith();
    });

    it('should not talk to the app once the runner has deleted the session', async () => {
      const mockBrowser = createMockBrowser({ sessionId: undefined });
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as any).browser = mockBrowser;

      await service.afterSession({}, {} as any, []);

      expect(restoreAllMocks).not.toHaveBeenCalled();
      expect(mockBrowser.execute).not.toHaveBeenCalled();
      expect(mockBrowser.deleteSession).not.toHaveBeenCalled();
      expect(mockStore.clear).toHaveBeenCalled();
    });

    it('should clear window state for each instance in multiremote without deleting the session', async () => {
      const instanceA = createMockBrowser({ sessionId: 'sess-a' });
      const instanceB = createMockBrowser({ sessionId: 'sess-b' });
      const mrBrowser = {
        isMultiremote: true,
        instances: ['browserA', 'browserB'],
        getInstance: vi.fn((name: string) => (name === 'browserA' ? instanceA : instanceB)),
      } as unknown as WebdriverIO.MultiRemoteBrowser;
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as unknown as { browser: WebdriverIO.MultiRemoteBrowser }).browser = mrBrowser;

      await service.afterSession({}, {} as TauriCapabilities, []);

      expect(instanceA.deleteSession).not.toHaveBeenCalled();
      expect(instanceB.deleteSession).not.toHaveBeenCalled();
      expect(clearWindowState).toHaveBeenCalledWith('sess-a');
      expect(clearWindowState).toHaveBeenCalledWith('sess-b');
    });

    it('should keep cleaning up the remaining instances when getInstance throws for one', async () => {
      const healthy = createMockBrowser({ sessionId: 'sess-b' });
      const mrBrowser = {
        isMultiremote: true,
        instances: ['browserA', 'browserB'],
        getInstance: vi.fn((name: string) => {
          if (name === 'browserA') {
            throw new Error('Multiremote object has no instance named "browserA"');
          }
          return healthy;
        }),
      } as unknown as WebdriverIO.MultiRemoteBrowser;
      const service = new TauriWorkerService({}, { 'wdio:tauriServiceOptions': {} });
      (service as unknown as { browser: WebdriverIO.MultiRemoteBrowser }).browser = mrBrowser;

      await expect(service.afterSession({}, {} as TauriCapabilities, [])).resolves.not.toThrow();

      expect(clearWindowState).toHaveBeenCalledWith('sess-b');
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
      expect(() => closeLogWriter('tauri-service')).not.toThrow();
    });
  });
});
