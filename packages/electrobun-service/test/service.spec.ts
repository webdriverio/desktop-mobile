import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn().mockResolvedValue(undefined);
const sendMock = vi.fn();
const switchTargetMock = vi.fn().mockResolvedValue(undefined);
const listWindowsMock = vi.fn().mockReturnValue(['main', 'second']);
const targetsMock = vi.fn().mockReturnValue([
  { id: 't-main', label: 'main', url: 'views://mainview/index.html', webSocketDebuggerUrl: 'ws://x/main' },
  { id: 't-2', label: 'window-1', url: 'views://secondview/index.html', webSocketDebuggerUrl: 'ws://x/2' },
]);
const closeMock = vi.fn().mockResolvedValue(undefined);
const cdpBridgeCtor = vi.fn();

vi.mock('@wdio/native-cdp-bridge', () => ({
  MultiTargetCdpBridge: class {
    constructor(opts: unknown) {
      cdpBridgeCtor(opts);
    }
    connect = connectMock;
    send = sendMock;
    switchTarget = switchTargetMock;
    listWindows = listWindowsMock;
    listTargets = targetsMock;
    activeLabel = 'main';
    close = closeMock;
  },
}));

// Mock execFileSync so the Linux app-reap (pkill) can be asserted without spawning anything.
const execFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync: execFileSyncMock }));

// Keep the real WebDriverEvalBridge + installConsoleShim; stub the factory so tests inject a
// poster instead of doing raw /execute/async HTTP.
vi.mock('../src/webdriverEval.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/webdriverEval.js')>();
  return { ...actual, createWebDriverEvalBridge: vi.fn() };
});

import type { ElectrobunServiceAPI } from '@wdio/native-types';
import ElectrobunWorkerService from '../src/service.js';
import { createWebDriverEvalBridge, WebDriverEvalBridge } from '../src/webdriverEval.js';

type Installed = { electrobun: ElectrobunServiceAPI };

function nativeCap(port = 9333): Record<string, unknown> {
  return { 'goog:chromeOptions': { debuggerAddress: `localhost:${port}` } };
}

function makeBrowser(
  windows: { handle: string; url: string }[] = [
    { handle: 'win-blank', url: 'about:blank' },
    { handle: 'win-main', url: 'views://mainview/index.html' },
  ],
): WebdriverIO.Browser {
  let current = windows[0]?.handle;
  return {
    isMultiremote: false,
    sessionId: 'abc',
    getWindowHandles: vi.fn().mockResolvedValue(windows.map((w) => w.handle)),
    getWindowHandle: vi.fn(async () => current),
    switchToWindow: vi.fn(async (handle: string) => {
      current = handle;
    }),
    getUrl: vi.fn(async () => windows.find((w) => w.handle === current)?.url ?? ''),
  } as unknown as WebdriverIO.Browser;
}

describe('ElectrobunWorkerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectMock.mockResolvedValue(undefined);
    sendMock.mockResolvedValue({ result: { value: undefined } });
    listWindowsMock.mockReturnValue(['main', 'second']);
    targetsMock.mockReturnValue([
      { id: 't-main', label: 'main', url: 'views://mainview/index.html', webSocketDebuggerUrl: 'ws://x/main' },
      { id: 't-2', label: 'window-1', url: 'views://secondview/index.html', webSocketDebuggerUrl: 'ws://x/2' },
    ]);
    closeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('before() — native mode', () => {
    it('should attach the CDP bridge using the capability debuggerAddress', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});

      await service.before(nativeCap(9350), [], browser);

      expect(cdpBridgeCtor).toHaveBeenCalledTimes(1);
      expect(cdpBridgeCtor.mock.calls[0][0]).toMatchObject({ host: 'localhost', port: 9350 });
      expect(connectMock).toHaveBeenCalledTimes(1);
    });

    it('should attach the CDP bridge from ms:edgeOptions.debuggerAddress (WebView2/Edge)', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});

      // WebView2 path: the launcher sets debuggerAddress under ms:edgeOptions (Edge), not goog:chromeOptions.
      await service.before({ 'ms:edgeOptions': { debuggerAddress: 'localhost:9360' } }, [], browser);

      expect(cdpBridgeCtor).toHaveBeenCalledTimes(1);
      expect(cdpBridgeCtor.mock.calls[0][0]).toMatchObject({ host: 'localhost', port: 9360 });
      expect(connectMock).toHaveBeenCalledTimes(1);
    });

    it('should focus the WebDriver session on the content window, not a blank shell', async () => {
      const browser = makeBrowser([
        { handle: 'win-blank', url: 'about:blank' },
        { handle: 'win-main', url: 'views://mainview/index.html' },
      ]);
      const service = new ElectrobunWorkerService({}, {});

      await service.before(nativeCap(), [], browser);

      // Ends on the content window so $/click target the app, not about:blank.
      expect(vi.mocked(browser.switchToWindow).mock.calls.at(-1)?.[0]).toBe('win-main');
    });

    it('should install browser.electrobun with the full API surface', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});

      await service.before(nativeCap(), [], browser);

      const { electrobun } = browser as unknown as Installed;
      expect(electrobun).toBeDefined();
      for (const name of [
        'execute',
        'switchWindow',
        'listWindows',
        'mock',
        'isMockFunction',
        'clearAllMocks',
        'resetAllMocks',
        'restoreAllMocks',
        'triggerDeeplink',
      ]) {
        expect(typeof (electrobun as unknown as Record<string, unknown>)[name]).toBe('function');
      }
    });

    it('should not attach a bridge when no debuggerAddress is present', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});

      await service.before({}, [], browser);

      expect(cdpBridgeCtor).not.toHaveBeenCalled();
      expect((browser as unknown as Partial<Installed>).electrobun).toBeUndefined();
    });
  });

  describe('before() — browser mode', () => {
    it('should skip CDP attach in browser mode', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:3000' }, {});

      await service.before(nativeCap(), [], browser);

      expect(cdpBridgeCtor).not.toHaveBeenCalled();
      expect((browser as unknown as Partial<Installed>).electrobun).toBeUndefined();
    });

    it('should read browser mode from capability-level options', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService(
        {},
        { 'wdio:electrobunServiceOptions': { mode: 'browser', devServerUrl: 'http://localhost:4000' } },
      );

      await service.before(nativeCap(), [], browser);

      expect(cdpBridgeCtor).not.toHaveBeenCalled();
    });

    it('should NOT skip the attach for a stray devServerUrl without mode: browser', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({ devServerUrl: 'http://localhost:3000' }, {});

      await service.before(nativeCap(), [], browser);

      // The launcher would have spawned natively (its criterion is mode only) —
      // the worker must attach rather than silently leave the surface uninstalled.
      expect(cdpBridgeCtor).toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    it('should evaluate a function in the active target via Runtime.evaluate and return its value', async () => {
      sendMock.mockResolvedValueOnce({ result: { value: 42 } });
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);

      const result = await (browser as unknown as Installed).electrobun.execute(() => 42);

      expect(result).toBe(42);
      const [method, params] = sendMock.mock.calls[0];
      expect(method).toBe('Runtime.evaluate');
      expect(params).toMatchObject({ returnByValue: true, awaitPromise: true });
      expect(params.expression).toContain('__WDIO_ELECTROBUN__');
    });

    it('should wrap a raw string expression so its value is returned', async () => {
      sendMock.mockResolvedValueOnce({ result: { value: 'ok' } });
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);

      const result = await (browser as unknown as Installed).electrobun.execute('1 + 1');

      expect(result).toBe('ok');
      expect(sendMock.mock.calls[0][1].expression).toBe('(async function () { return (1 + 1); })()');
    });

    it('should throw when Runtime.evaluate reports exceptionDetails', async () => {
      sendMock.mockResolvedValueOnce({ exceptionDetails: { exception: { description: 'boom' } } });
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);

      await expect((browser as unknown as Installed).electrobun.execute(() => 1)).rejects.toThrow(/boom/);
    });
  });

  describe('switchWindow / listWindows', () => {
    it('should delegate switchWindow to bridge.switchTarget', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);

      await (browser as unknown as Installed).electrobun.switchWindow('second');

      expect(switchTargetMock).toHaveBeenCalledWith('second');
    });

    it('should also sync the WebDriver session window on switchWindow', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);
      vi.mocked(browser.getWindowHandles).mockClear();
      vi.mocked(browser.switchToWindow).mockClear();

      await (browser as unknown as Installed).electrobun.switchWindow('window-1');

      // Not just the bridge target — $/click must follow, so the session re-syncs.
      expect(switchTargetMock).toHaveBeenCalledWith('window-1');
      expect(browser.getWindowHandles).toHaveBeenCalled();
      expect(browser.switchToWindow).toHaveBeenCalled();
    });

    it('should delegate listWindows to bridge.listWindows', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);

      const windows = await (browser as unknown as Installed).electrobun.listWindows();

      expect(windows).toEqual(['main', 'second']);
    });
  });

  describe('mock surface (wired over the bridge)', () => {
    // Detailed inner-recorder semantics live in test/mock.spec.ts / allMocks.spec.ts;
    // here we assert installApi wires the family onto the bridge-backed store.
    it('should install a recorder via Runtime.evaluate and return an electrobun mock', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);
      const { electrobun } = browser as unknown as Installed;

      const mock = await electrobun.mock('api.fetchData');

      expect((mock as unknown as { __isElectrobunMock: boolean }).__isElectrobunMock).toBe(true);
      expect(mock.getMockName()).toBe('electrobun.api.fetchData');
      const [method, params] = sendMock.mock.calls[0];
      expect(method).toBe('Runtime.evaluate');
      expect(params.expression).toContain('__WDIO_ELECTROBUN_MOCKS__');
      expect(params.expression).toContain('api.fetchData');
    });

    it('should report mocks via isMockFunction and resolve clear/reset/restore-all', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);
      const { electrobun } = browser as unknown as Installed;

      const mock = await electrobun.mock('api.fetchData');
      expect(electrobun.isMockFunction(mock)).toBe(true);
      expect(electrobun.isMockFunction('api.fetchData')).toBe(true);
      expect(electrobun.isMockFunction(() => undefined)).toBe(false);

      await expect(electrobun.clearAllMocks()).resolves.toBeUndefined();
      await expect(electrobun.resetAllMocks()).resolves.toBeUndefined();
      await expect(electrobun.restoreAllMocks()).resolves.toBeUndefined();
    });

    it('should keep a separate mock store per multiremote instance', async () => {
      const instanceA = {} as WebdriverIO.Browser;
      const instanceB = {} as WebdriverIO.Browser;
      const mrBrowser = {
        isMultiremote: true,
        instances: ['browserA', 'browserB'],
        getInstance: (name: string) => (name === 'browserA' ? instanceA : instanceB),
      } as unknown as WebdriverIO.MultiRemoteBrowser;
      const caps = { browserA: { capabilities: nativeCap(9361) }, browserB: { capabilities: nativeCap(9362) } };

      const service = new ElectrobunWorkerService({}, {});
      await service.before(caps, [], mrBrowser);

      const electrobunA = (instanceA as unknown as Installed).electrobun;
      const electrobunB = (instanceB as unknown as Installed).electrobun;
      await electrobunA.mock('api.only');
      expect(electrobunA.isMockFunction('api.only')).toBe(true);
      expect(electrobunB.isMockFunction('api.only')).toBe(false);
    });
    // triggerDeeplink is now real (macOS) — covered in test/triggerDeeplink.spec.ts.
  });

  describe('teardown', () => {
    it('should close the bridge on after() and afterSession()', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);

      await service.after();
      expect(closeMock).toHaveBeenCalledTimes(1);

      // after() emptied the bridge list, so afterSession() has nothing more to close.
      await service.afterSession();
      expect(closeMock).toHaveBeenCalledTimes(1);
    });

    it('should tolerate a bridge.close() rejection', async () => {
      closeMock.mockRejectedValueOnce(new Error('socket gone'));
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);

      await expect(service.after()).resolves.toBeUndefined();
    });
  });

  describe('multiremote', () => {
    it('should attach a bridge per instance', async () => {
      const instanceA = {} as WebdriverIO.Browser;
      const instanceB = {} as WebdriverIO.Browser;
      const mrBrowser = {
        isMultiremote: true,
        instances: ['browserA', 'browserB'],
        getInstance: (name: string) => (name === 'browserA' ? instanceA : instanceB),
      } as unknown as WebdriverIO.MultiRemoteBrowser;

      const caps = {
        browserA: { capabilities: nativeCap(9341) },
        browserB: { capabilities: nativeCap(9342) },
      };

      const service = new ElectrobunWorkerService({}, {});
      await service.before(caps, [], mrBrowser);

      expect(cdpBridgeCtor).toHaveBeenCalledTimes(2);
      expect((instanceA as unknown as Partial<Installed>).electrobun).toBeDefined();
      expect((instanceB as unknown as Partial<Installed>).electrobun).toBeDefined();
    });
  });

  describe('W3C (WebKitGTK) mode', () => {
    const w3cCap = { 'webkitgtk:browserOptions': { binary: '/app/bin/launcher', args: ['--automation'] } };

    // The raw /execute/async poster the WebDriverEvalBridge calls; returns a W3C `{ value }`.
    let poster: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      poster = vi.fn().mockResolvedValue({ value: { ok: true, value: undefined } });
      vi.mocked(createWebDriverEvalBridge).mockImplementation(() => new WebDriverEvalBridge(poster));
    });

    function makeW3CBrowser(): WebdriverIO.Browser & { execute: ReturnType<typeof vi.fn> } {
      return {
        isMultiremote: false,
        sessionId: 'w3c',
        options: { protocol: 'http', hostname: '127.0.0.1', port: 9333 },
        // execute (sync) backs the console shim install + drain; return [] so drain is a no-op.
        execute: vi.fn().mockResolvedValue([]),
        getWindowHandles: vi.fn().mockResolvedValue(['h0', 'h1']),
        switchToWindow: vi.fn().mockResolvedValue(undefined),
      } as unknown as WebdriverIO.Browser & { execute: ReturnType<typeof vi.fn> };
    }

    it('should install browser.electrobun over W3C without a CDP bridge', async () => {
      const browser = makeW3CBrowser();
      const service = new ElectrobunWorkerService({}, {});

      await service.before(w3cCap, [], browser);

      expect(cdpBridgeCtor).not.toHaveBeenCalled();
      const { electrobun } = browser as unknown as Installed;
      expect(electrobun).toBeDefined();
      for (const name of ['execute', 'mock', 'switchWindow', 'listWindows', 'clearAllMocks']) {
        expect(typeof (electrobun as unknown as Record<string, unknown>)[name]).toBe('function');
      }
    });

    it('should run execute over the raw /execute/async poster (W3C eval channel)', async () => {
      const browser = makeW3CBrowser();
      poster.mockResolvedValue({ value: { ok: true, value: 7 } });
      const service = new ElectrobunWorkerService({}, {});
      await service.before(w3cCap, [], browser);

      const result = await (browser as unknown as Installed).electrobun.execute(() => 7);

      expect(result).toBe(7);
      expect(poster).toHaveBeenCalled();
    });

    it('should surface a page-level error message from execute', async () => {
      const browser = makeW3CBrowser();
      poster.mockResolvedValue({ value: { ok: false, error: 'Test error from execute' } });
      const service = new ElectrobunWorkerService({}, {});
      await service.before(w3cCap, [], browser);

      await expect((browser as unknown as Installed).electrobun.execute(() => 1)).rejects.toThrow(
        /Test error from execute/,
      );
    });

    it('should list and switch windows via W3C handles', async () => {
      const browser = makeW3CBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(w3cCap, [], browser);

      const windows = await (browser as unknown as Installed).electrobun.listWindows();
      expect(windows).toEqual(['main', 'window-1']);

      await (browser as unknown as Installed).electrobun.switchWindow('window-1');
      expect(browser.switchToWindow).toHaveBeenCalledWith('h1');
    });

    it('should reject switchWindow for an unrecognised label (not silently target main)', async () => {
      const browser = makeW3CBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(w3cCap, [], browser);

      await expect((browser as unknown as Installed).electrobun.switchWindow('typo')).rejects.toThrow(
        /unrecognised window label/,
      );
      expect(browser.switchToWindow).not.toHaveBeenCalled();
    });

    it('should preserve undefined from execute (WebDriver would surface it as null)', async () => {
      const browser = makeW3CBrowser();
      poster.mockResolvedValue({ value: { ok: true, undef: true } });
      const service = new ElectrobunWorkerService({}, {});
      await service.before(w3cCap, [], browser);

      const result = await (browser as unknown as Installed).electrobun.execute(() => undefined);
      expect(result).toBeUndefined();
    });

    it('should install the console shim and drain it on teardown', async () => {
      const browser = makeW3CBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(w3cCap, [], browser);

      // The shim install script runs during before().
      const installed = browser.execute.mock.calls.some((c) => String(c[0]).includes('__WDIO_ELECTROBUN_LOGS__'));
      expect(installed).toBe(true);

      const callsBefore = browser.execute.mock.calls.length;
      await service.after();
      // Drain evaluates once more to read + clear the buffer.
      expect(browser.execute.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('should reap the WebKitGTK app tree on Linux teardown (unblocks deleteSession)', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      try {
        const browser = makeW3CBrowser();
        // A realistic, specific bundle path (the reap guards against too-generic paths like /app).
        const cap = {
          'webkitgtk:browserOptions': {
            binary: '/home/runner/build/WDIOElectrobunE2E-dev/bin/launcher',
            args: ['--automation'],
          },
        };
        const service = new ElectrobunWorkerService({}, {});
        await service.before(cap, [], browser);
        execFileSyncMock.mockClear();

        await service.after();

        // pkill matches the app bundle root so WDIO's subsequent deleteSession returns fast.
        expect(execFileSyncMock).toHaveBeenCalledWith(
          'pkill',
          ['-9', '-f', '/home/runner/build/WDIOElectrobunE2E-dev'],
          expect.anything(),
        );
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }
    });

    it('should NOT reap for a too-generic bundle path (safety guard)', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      try {
        const browser = makeW3CBrowser();
        // binary '/app/bin/launcher' -> bundle root '/app' (too short) -> skipped.
        const service = new ElectrobunWorkerService({}, {});
        await service.before(w3cCap, [], browser);
        execFileSyncMock.mockClear();

        await service.after();

        expect(execFileSyncMock).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }
    });

    it('should create a mock over the W3C eval channel', async () => {
      const browser = makeW3CBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(w3cCap, [], browser);

      const mock = await (browser as unknown as Installed).electrobun.mock('api.fetchData');

      expect(mock).toBeDefined();
      // The inner-recorder install script ran over the raw /execute/async poster, not a CDP bridge.
      expect(poster).toHaveBeenCalled();
      expect(cdpBridgeCtor).not.toHaveBeenCalled();
    });
  });
});
