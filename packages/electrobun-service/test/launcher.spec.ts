import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SevereServiceError } from 'webdriverio';

import { cefRendererRequired } from '../src/errors.js';

const logMocks = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return {
    ...actual,
    createLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: logMocks.warn, error: vi.fn() }),
  };
});

// Mock the IO-bound config helpers so the launcher matrix can be driven without
// a real bundle on disk. resolveElectrobunApp returns a fixed resolved app;
// verifyCefRenderer is spied so throws can be asserted. The launcher no longer
// pins the port itself — that now happens inside the (mocked) spawn path — but
// writeRemoteDebuggingPort is still mocked so we can assert the launcher never
// calls it directly. (Real behaviour is covered in electrobunConfig.spec.ts.)
vi.mock('../src/electrobunConfig.js', () => ({
  resolveElectrobunApp: vi.fn(() => ({
    binaryPath: '/apps/Demo.app/Contents/MacOS/Demo',
    bundlePath: '/apps/Demo.app',
    resourcesDir: '/apps/Demo.app/Contents/Resources',
    buildJsonPath: '/apps/Demo.app/Contents/Resources/build.json',
    identifier: 'com.example.demo',
  })),
  verifyCefRenderer: vi.fn(),
  writeRemoteDebuggingPort: vi.fn(),
}));

// Mock the native-mode spawn so no real process is launched (and no real bundle
// is cloned). The clone + port-pin now live inside spawnElectrobunApp.
vi.mock('../src/nativeMode.js', () => ({
  spawnElectrobunApp: vi.fn(() => ({
    proc: { pid: 4321, exitCode: null, signalCode: null, kill: vi.fn() },
    cleanupDirs: ['/tmp/wdio-electrobun-home-test', '/tmp/wdio-electrobun-bundle-test'],
    port: 9333,
    logHandlers: [],
  })),
  stopElectrobunApp: vi.fn().mockResolvedValue(undefined),
  waitForCdpReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/webview2Version.js', () => ({
  detectWebView2RuntimeVersion: vi.fn(() => '148.0.3967.83'),
}));

vi.mock('../src/webkitDriver.js', () => ({
  getWebKitWebDriverPath: vi.fn(() => '/usr/bin/WebKitWebDriver'),
  spawnWebKitWebDriver: vi.fn(async () => ({
    process: { pid: 5555, exitCode: null, signalCode: null, kill: vi.fn() },
    host: '127.0.0.1',
    port: 9333,
    detached: true,
  })),
  stopWebKitWebDriver: vi.fn().mockResolvedValue(undefined),
}));

const linuxNativeApp = {
  binaryPath: '/apps/Demo/bin/launcher',
  bundlePath: '/apps/Demo',
  resourcesDir: '/apps/Demo/Resources',
  buildJsonPath: '/apps/Demo/Resources/build.json',
  identifier: 'com.example.demo',
  renderer: 'native',
};

vi.mock('@wdio/native-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-core')>()),
  startManagedDevServer: vi.fn(),
}));

import { startManagedDevServer } from '@wdio/native-core';
import { resolveElectrobunApp, verifyCefRenderer, writeRemoteDebuggingPort } from '../src/electrobunConfig.js';
import ElectrobunLaunchService from '../src/launcher.js';
import { spawnElectrobunApp, stopElectrobunApp } from '../src/nativeMode.js';
import type { ElectrobunCapabilities, ElectrobunServiceGlobalOptions } from '../src/types.js';
import { getWebKitWebDriverPath, spawnWebKitWebDriver, stopWebKitWebDriver } from '../src/webkitDriver.js';
import { detectWebView2RuntimeVersion } from '../src/webview2Version.js';

const baseConfig = {} as Parameters<ElectrobunLaunchService['onPrepare']>[0];

function makeLauncher(options: ElectrobunServiceGlobalOptions): ElectrobunLaunchService {
  return new ElectrobunLaunchService(options, {} as ElectrobunCapabilities, baseConfig);
}

// Tests default to darwin (the CEF path); the platform-guard and Windows/WebView2 tests
// override to linux/win32. Restored after each test.
const originalPlatform = process.platform;
function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, writable: true, configurable: true });
}

describe('ElectrobunLaunchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform('darwin');
    // Browser mode now preflights the dev server with a fetch HEAD probe; stub it reachable so the
    // happy-path browser tests don't hit a real (absent) server. (Native-mode tests never probe.)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setPlatform(originalPlatform);
  });

  describe('onPrepare — browser mode', () => {
    it('should set browserName=chrome and return early when mode=browser', async () => {
      const launcher = makeLauncher({ mode: 'browser', devServerUrl: 'http://localhost:3000' });
      const caps: ElectrobunCapabilities[] = [{ browserName: 'electrobun' }];

      await launcher.onPrepare(baseConfig, caps);

      expect(caps[0].browserName).toBe('chrome');
      expect(vi.mocked(resolveElectrobunApp)).not.toHaveBeenCalled();
    });

    it('should throw SevereServiceError when devServerUrl is missing in browser mode', async () => {
      const launcher = makeLauncher({ mode: 'browser' });
      await expect(launcher.onPrepare(baseConfig, [{}])).rejects.toThrow(SevereServiceError);
    });

    it('should explain that devServerUrl is required in browser mode', async () => {
      const launcher = makeLauncher({ mode: 'browser' });
      await expect(launcher.onPrepare(baseConfig, [{}])).rejects.toThrow(/devServerUrl is required/);
    });

    it('should throw SevereServiceError when devServerUrl is not a valid URL', async () => {
      const launcher = makeLauncher({ mode: 'browser', devServerUrl: 'not-a-url' });
      await expect(launcher.onPrepare(baseConfig, [{}])).rejects.toThrow(/not a valid URL/);
    });

    it('should skip app spawn in onWorkerStart when in browser mode', async () => {
      const launcher = makeLauncher({ mode: 'browser', devServerUrl: 'http://localhost:3000' });
      await launcher.onPrepare(baseConfig, [{ browserName: 'electrobun' }]);

      await launcher.onWorkerStart('0-0', [{ browserName: 'chrome' }]);

      expect(vi.mocked(spawnElectrobunApp)).not.toHaveBeenCalled();
    });

    it('should reject a mixed browser-mode + native-mode capability set', async () => {
      const launcher = makeLauncher({});
      const caps: ElectrobunCapabilities[] = [
        { 'wdio:electrobunServiceOptions': { mode: 'browser', devServerUrl: 'http://localhost:3000' } },
        { 'wdio:electrobunServiceOptions': { mode: 'native' } },
      ];

      await expect(launcher.onPrepare(baseConfig, caps)).rejects.toThrow(/Mixed browser-mode and native-mode/);
    });

    it('should NOT apply the native-mode macOS guard in browser mode on Linux', async () => {
      setPlatform('linux');
      const launcher = makeLauncher({ mode: 'browser', devServerUrl: 'http://localhost:3000' });
      const caps: ElectrobunCapabilities[] = [{ browserName: 'electrobun' }];

      await launcher.onPrepare(baseConfig, caps);

      expect(caps[0].browserName).toBe('chrome');
      expect(vi.mocked(resolveElectrobunApp)).not.toHaveBeenCalled();
    });
  });

  describe('onPrepare — native mode', () => {
    it('should resolve, CEF-verify, and force browserName=chrome on each capability', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      const caps: ElectrobunCapabilities[] = [{ browserName: 'electrobun' }];

      await launcher.onPrepare(baseConfig, caps);

      expect(vi.mocked(resolveElectrobunApp)).toHaveBeenCalledWith('/apps/Demo.app');
      expect(vi.mocked(verifyCefRenderer)).toHaveBeenCalledTimes(1);
      expect(caps[0].browserName).toBe('chrome');
    });

    it('should warn (not throw) when maxInstances > 1 — CEF is single-instance', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      const caps: ElectrobunCapabilities[] = [{ browserName: 'electrobun' }];

      await launcher.onPrepare({ maxInstances: 2 } as Parameters<typeof launcher.onPrepare>[0], caps);

      expect(logMocks.warn).toHaveBeenCalledWith(expect.stringContaining('maxInstances'));
    });

    it('should not warn about maxInstances when it is 1', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      const caps: ElectrobunCapabilities[] = [{ browserName: 'electrobun' }];

      await launcher.onPrepare({ maxInstances: 1 } as Parameters<typeof launcher.onPrepare>[0], caps);

      expect(logMocks.warn).not.toHaveBeenCalledWith(expect.stringContaining('maxInstances'));
    });

    it('should NOT warn about maxInstances > 1 on Windows — WebView2 isolates per-instance', async () => {
      setPlatform('win32');
      const launcher = makeLauncher({ appBinaryPath: 'C:/apps/Demo/bin/launcher.exe' });
      const caps: ElectrobunCapabilities[] = [{ browserName: 'electrobun' }];

      await launcher.onPrepare({ maxInstances: 2 } as Parameters<typeof launcher.onPrepare>[0], caps);

      expect(logMocks.warn).not.toHaveBeenCalledWith(expect.stringContaining('maxInstances'));
    });

    it('should pin browserVersion to the WebView2 runtime version on the Windows WebView2 path', async () => {
      setPlatform('win32');
      vi.mocked(resolveElectrobunApp).mockReturnValueOnce({
        binaryPath: 'C:/apps/Demo/bin/launcher.exe',
        bundlePath: 'C:/apps/Demo',
        resourcesDir: 'C:/apps/Demo/Resources',
        buildJsonPath: 'C:/apps/Demo/Resources/build.json',
        renderer: 'native',
      });
      const launcher = makeLauncher({ appBinaryPath: 'C:/apps/Demo/bin/launcher.exe' });
      const cap: ElectrobunCapabilities = {};

      await launcher.onPrepare(baseConfig, [cap]);

      expect((cap as { browserName?: string }).browserName).toBe('MicrosoftEdge');
      // Pinned to the detected runtime version (mocked), not WDIO's Edge-browser auto-match.
      expect((cap as { browserVersion?: string }).browserVersion).toBe('148.0.3967.83');
    });

    it('should NOT override a user-set browserVersion on the WebView2 path (??= preserves it)', async () => {
      setPlatform('win32');
      vi.mocked(resolveElectrobunApp).mockReturnValueOnce({
        binaryPath: 'C:/apps/Demo/bin/launcher.exe',
        bundlePath: 'C:/apps/Demo',
        resourcesDir: 'C:/apps/Demo/Resources',
        buildJsonPath: 'C:/apps/Demo/Resources/build.json',
        renderer: 'native',
      });
      const launcher = makeLauncher({ appBinaryPath: 'C:/apps/Demo/bin/launcher.exe' });
      const cap: ElectrobunCapabilities = {};
      (cap as { browserVersion?: string }).browserVersion = '150.0.1';

      await launcher.onPrepare(baseConfig, [cap]);

      // The user's pin wins over the detected runtime version (mocked 148.0.3967.83).
      expect((cap as { browserVersion?: string }).browserVersion).toBe('150.0.1');
    });

    it('should warn and fall back to auto-match when the WebView2 runtime version is undetectable', async () => {
      setPlatform('win32');
      vi.mocked(detectWebView2RuntimeVersion).mockReturnValueOnce(undefined);
      vi.mocked(resolveElectrobunApp).mockReturnValueOnce({
        binaryPath: 'C:/apps/Demo/bin/launcher.exe',
        bundlePath: 'C:/apps/Demo',
        resourcesDir: 'C:/apps/Demo/Resources',
        buildJsonPath: 'C:/apps/Demo/Resources/build.json',
        renderer: 'native',
      });
      const launcher = makeLauncher({ appBinaryPath: 'C:/apps/Demo/bin/launcher.exe' });
      const cap: ElectrobunCapabilities = {};

      await launcher.onPrepare(baseConfig, [cap]);

      // No version pinned → WDIO auto-matches; the warn makes that traceable in CI logs.
      expect((cap as { browserVersion?: string }).browserVersion).toBeUndefined();
      expect(logMocks.warn).toHaveBeenCalledWith(expect.stringContaining('WebView2 runtime version'));
    });

    it('should NOT warn when runtime detection fails but the user pinned browserVersion', async () => {
      setPlatform('win32');
      vi.mocked(detectWebView2RuntimeVersion).mockReturnValueOnce(undefined);
      vi.mocked(resolveElectrobunApp).mockReturnValueOnce({
        binaryPath: 'C:/apps/Demo/bin/launcher.exe',
        bundlePath: 'C:/apps/Demo',
        resourcesDir: 'C:/apps/Demo/Resources',
        buildJsonPath: 'C:/apps/Demo/Resources/build.json',
        renderer: 'native',
      });
      const launcher = makeLauncher({ appBinaryPath: 'C:/apps/Demo/bin/launcher.exe' });
      const cap: ElectrobunCapabilities = {};
      (cap as { browserVersion?: string }).browserVersion = '150.0.1';

      await launcher.onPrepare(baseConfig, [cap]);

      // User pinned the version → no auto-match fallback, so no (spurious) warning.
      expect((cap as { browserVersion?: string }).browserVersion).toBe('150.0.1');
      expect(logMocks.warn).not.toHaveBeenCalledWith(expect.stringContaining('WebView2 runtime version'));
    });

    it('should propagate a missing-appBinaryPath SevereServiceError from resolution', async () => {
      vi.mocked(resolveElectrobunApp).mockImplementationOnce(() => {
        throw new SevereServiceError('@wdio/electrobun-service requires an explicit appBinaryPath in native mode.');
      });
      const launcher = makeLauncher({});

      await expect(launcher.onPrepare(baseConfig, [{}])).rejects.toThrow(/explicit appBinaryPath/);
    });

    it('should propagate cefRendererRequired when the app lacks the CEF renderer', async () => {
      vi.mocked(verifyCefRenderer).mockImplementationOnce(() => {
        throw cefRendererRequired('darwin');
      });
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });

      await expect(launcher.onPrepare(baseConfig, [{}])).rejects.toThrow(/CEF renderer/);
    });

    it('should resolve a capability-level appBinaryPath override', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Global.app' });
      const caps: ElectrobunCapabilities[] = [
        { 'wdio:electrobunServiceOptions': { appBinaryPath: '/apps/PerCap.app' } },
      ];

      await launcher.onPrepare(baseConfig, caps);

      expect(vi.mocked(resolveElectrobunApp)).toHaveBeenCalledWith('/apps/PerCap.app');
    });

    it('should drive Linux via WebKitGTK/W3C for the native renderer (no browserName, classic)', async () => {
      setPlatform('linux');
      vi.mocked(resolveElectrobunApp).mockReturnValueOnce(linuxNativeApp);
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo/bin/launcher', appArgs: ['--flag'] });
      const caps: ElectrobunCapabilities[] = [{ browserName: 'electrobun' }];

      await launcher.onPrepare(baseConfig, caps);

      expect(vi.mocked(verifyCefRenderer)).not.toHaveBeenCalled();
      expect(vi.mocked(getWebKitWebDriverPath)).toHaveBeenCalledTimes(1);
      const cap = caps[0] as Record<string, unknown>;
      expect(cap.browserName).toBeUndefined();
      expect(cap['wdio:enforceWebDriverClassic']).toBe(true);
      expect(cap['webkitgtk:browserOptions']).toEqual({
        binary: '/apps/Demo/bin/launcher',
        args: ['--automation', '--flag'],
      });
    });

    it('should reject a CEF-built bundle on Linux (CEF serves no /json there)', async () => {
      setPlatform('linux');
      vi.mocked(resolveElectrobunApp).mockReturnValueOnce({ ...linuxNativeApp, renderer: 'cef' });
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo/bin/launcher' });

      const error = await launcher.onPrepare(baseConfig, [{}]).catch((e: Error) => e);
      expect(error).toBeInstanceOf(SevereServiceError);
      expect((error as Error).message).toContain('linux');
      expect((error as Error).message).toContain('defaultRenderer: "native"');
    });

    it('should fail fast with an install hint when WebKitWebDriver is missing on Linux', async () => {
      setPlatform('linux');
      vi.mocked(resolveElectrobunApp).mockReturnValueOnce(linuxNativeApp);
      vi.mocked(getWebKitWebDriverPath).mockReturnValueOnce(undefined);
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo/bin/launcher' });

      const error = await launcher.onPrepare(baseConfig, [{}]).catch((e: Error) => e);
      expect(error).toBeInstanceOf(SevereServiceError);
      expect((error as Error).message).toContain('webkit2gtk-driver');
    });

    it('should fail fast with a SevereServiceError in native mode on an unsupported platform', async () => {
      setPlatform('freebsd' as NodeJS.Platform);
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });

      await expect(launcher.onPrepare(baseConfig, [{}])).rejects.toThrow(SevereServiceError);
      // Fails fast — before touching the bundle.
      expect(vi.mocked(resolveElectrobunApp)).not.toHaveBeenCalled();
    });

    it('should drive Windows via WebView2/Edge (browserName=MicrosoftEdge, no CEF verify)', async () => {
      setPlatform('win32');
      const launcher = makeLauncher({ appBinaryPath: 'C:/apps/Demo/bin/launcher.exe' });
      const caps: ElectrobunCapabilities[] = [{ browserName: 'electrobun' }];

      await launcher.onPrepare(baseConfig, caps);

      expect(vi.mocked(resolveElectrobunApp)).toHaveBeenCalledTimes(1);
      // WebView2 (Chromium) always serves /json once the launcher injects the port — nothing to verify.
      expect(vi.mocked(verifyCefRenderer)).not.toHaveBeenCalled();
      // WebView2 is Edge → msedgedriver (chromedriver rejects the `Edg/` version string).
      expect(caps[0].browserName).toBe('MicrosoftEdge');
    });

    it('should reject a CEF-built bundle on Windows (CEF serves no /json there)', async () => {
      setPlatform('win32');
      vi.mocked(resolveElectrobunApp).mockReturnValueOnce({
        binaryPath: 'C:/apps/Demo/bin/launcher.exe',
        bundlePath: 'C:/apps/Demo',
        resourcesDir: 'C:/apps/Demo/Resources',
        buildJsonPath: 'C:/apps/Demo/Resources/build.json',
        renderer: 'cef',
      });
      const launcher = makeLauncher({ appBinaryPath: 'C:/apps/Demo/bin/launcher.exe' });

      const error = await launcher.onPrepare(baseConfig, [{}]).catch((e: Error) => e);
      expect(error).toBeInstanceOf(SevereServiceError);
      expect((error as Error).message).toContain('win32');
      expect((error as Error).message).toContain('defaultRenderer: "native"');
    });
  });

  describe('onWorkerStart — native mode', () => {
    it('should allocate a port, spawn with the resolved app, and set debuggerAddress', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      await launcher.onPrepare(baseConfig, [{}]);

      const cap: ElectrobunCapabilities = {};
      await launcher.onWorkerStart('0-0', [cap]);

      expect(vi.mocked(spawnElectrobunApp)).toHaveBeenCalledTimes(1);
      const spawnArg = vi.mocked(spawnElectrobunApp).mock.calls[0][0];
      expect(spawnArg.app.bundlePath).toBe('/apps/Demo.app');
      expect(spawnArg.app.buildJsonPath).toBe('/apps/Demo.app/Contents/Resources/build.json');
      expect(typeof spawnArg.port).toBe('number');

      expect(cap['goog:chromeOptions']).toEqual({ debuggerAddress: `127.0.0.1:${spawnArg.port}` });
    });

    it('should set debuggerAddress under ms:edgeOptions on the WebView2 (Windows) path', async () => {
      setPlatform('win32');
      const launcher = makeLauncher({ appBinaryPath: 'C:/apps/Demo/bin/launcher.exe' });
      await launcher.onPrepare(baseConfig, [{}]);

      const cap: ElectrobunCapabilities = {};
      await launcher.onWorkerStart('0-0', [cap]);

      const spawnArg = vi.mocked(spawnElectrobunApp).mock.calls[0][0];
      // Edge reads debuggerAddress from ms:edgeOptions, not goog:chromeOptions.
      expect(cap['ms:edgeOptions']).toEqual({ debuggerAddress: `127.0.0.1:${spawnArg.port}` });
      expect(cap['goog:chromeOptions']).toBeUndefined();
    });

    it('should spawn WebKitWebDriver and set connection host/port on the Linux/W3C path', async () => {
      setPlatform('linux');
      vi.mocked(resolveElectrobunApp).mockReturnValueOnce(linuxNativeApp);
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo/bin/launcher' });
      await launcher.onPrepare(baseConfig, [{}]);

      const cap: ElectrobunCapabilities = {};
      await launcher.onWorkerStart('0-0', [cap]);

      expect(vi.mocked(spawnElectrobunApp)).not.toHaveBeenCalled();
      expect(vi.mocked(spawnWebKitWebDriver)).toHaveBeenCalledTimes(1);
      const w3cCap = cap as Record<string, unknown>;
      expect(w3cCap.hostname).toBe('127.0.0.1');
      expect(w3cCap.port).toBe(9333);
      expect(w3cCap['goog:chromeOptions']).toBeUndefined();
    });

    it('should stop WebKitWebDriver on worker end (Linux/W3C)', async () => {
      setPlatform('linux');
      vi.mocked(resolveElectrobunApp).mockReturnValueOnce(linuxNativeApp);
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo/bin/launcher' });
      await launcher.onPrepare(baseConfig, [{}]);
      await launcher.onWorkerStart('0-0', [{}]);

      await launcher.onWorkerEnd('0-0');

      expect(vi.mocked(stopWebKitWebDriver)).toHaveBeenCalledTimes(1);
    });

    it('should spawn one app per instance for a multiremote capability record', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      const record = {
        instanceA: { capabilities: {} as ElectrobunCapabilities },
        instanceB: { capabilities: {} as ElectrobunCapabilities },
      };
      await launcher.onPrepare(baseConfig, record as Parameters<typeof launcher.onPrepare>[1]);

      await launcher.onWorkerStart('0-0', record as Parameters<typeof launcher.onWorkerStart>[1]);

      // The record must be unwrapped to its per-instance caps — two instances → two spawns,
      // each with debuggerAddress set on its own caps (by reference).
      expect(vi.mocked(spawnElectrobunApp)).toHaveBeenCalledTimes(2);
      expect(record.instanceA.capabilities['goog:chromeOptions']).toBeDefined();
      expect(record.instanceB.capabilities['goog:chromeOptions']).toBeDefined();
    });

    it('should NOT pin the port directly — clone + port-write happen inside the spawn path', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      await launcher.onPrepare(baseConfig, [{}]);

      await launcher.onWorkerStart('0-0', [{}]);

      expect(vi.mocked(writeRemoteDebuggingPort)).not.toHaveBeenCalled();
    });

    it('should allocate a distinct port + spawn per capability for multiremote', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      await launcher.onPrepare(baseConfig, [{}, {}]);

      const caps: ElectrobunCapabilities[] = [{}, {}];
      await launcher.onWorkerStart('0-0', caps);

      expect(vi.mocked(spawnElectrobunApp)).toHaveBeenCalledTimes(2);
      const portA = vi.mocked(spawnElectrobunApp).mock.calls[0][0].port;
      const portB = vi.mocked(spawnElectrobunApp).mock.calls[1][0].port;
      expect(portA).not.toBe(portB);
      expect((caps[0]['goog:chromeOptions'] as Record<string, unknown>).debuggerAddress).toBe(`127.0.0.1:${portA}`);
      expect((caps[1]['goog:chromeOptions'] as Record<string, unknown>).debuggerAddress).toBe(`127.0.0.1:${portB}`);
    });

    it('should preserve existing goog:chromeOptions when setting debuggerAddress', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      await launcher.onPrepare(baseConfig, [{}]);

      const cap: ElectrobunCapabilities = { 'goog:chromeOptions': { args: ['--headless'] } };
      await launcher.onWorkerStart('0-0', [cap]);

      const chromeOptions = cap['goog:chromeOptions'] as Record<string, unknown>;
      expect(chromeOptions.args).toEqual(['--headless']);
      expect(chromeOptions.debuggerAddress).toMatch(/^127\.0\.0\.1:\d+$/);
    });

    it('should accept a single (non-array) capability', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      await launcher.onPrepare(baseConfig, [{}]);

      const cap: ElectrobunCapabilities = {};
      await launcher.onWorkerStart('0-0', cap);

      expect(vi.mocked(spawnElectrobunApp)).toHaveBeenCalledTimes(1);
      expect(cap['goog:chromeOptions']).toBeDefined();
    });

    it('should throw SevereServiceError when no app was resolved (onPrepare skipped)', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      await expect(launcher.onWorkerStart('0-0', [{}])).rejects.toThrow(/no resolved Electrobun app/);
    });

    it('should skip and warn when no capabilities are provided', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      await launcher.onPrepare(baseConfig, [{}]);

      await expect(launcher.onWorkerStart('0-0', undefined)).resolves.toBeUndefined();
      expect(vi.mocked(spawnElectrobunApp)).not.toHaveBeenCalled();
    });
  });

  describe('onComplete', () => {
    it('should stop every spawned app and resolve cleanly', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      await launcher.onPrepare(baseConfig, [{}]);
      await launcher.onWorkerStart('0-0', [{}]);

      await expect(launcher.onComplete()).resolves.toBeUndefined();
      expect(vi.mocked(stopElectrobunApp)).toHaveBeenCalledTimes(1);
    });

    it('should resolve without error when no apps were spawned', async () => {
      const launcher = makeLauncher({ mode: 'browser', devServerUrl: 'http://localhost:3000' });
      await launcher.onPrepare(baseConfig, [{}]);

      await expect(launcher.onComplete()).resolves.toBeUndefined();
      expect(vi.mocked(stopElectrobunApp)).not.toHaveBeenCalled();
    });

    it('should swallow a stopElectrobunApp rejection and still resolve', async () => {
      vi.mocked(stopElectrobunApp).mockRejectedValueOnce(new Error('kill failed'));
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      await launcher.onPrepare(baseConfig, [{}]);
      await launcher.onWorkerStart('0-0', [{}]);

      await expect(launcher.onComplete()).resolves.toBeUndefined();
    });
  });

  describe('onWorkerEnd', () => {
    it('should stop the worker app per-spec so apps do not accumulate', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      await launcher.onPrepare(baseConfig, [{}]);
      await launcher.onWorkerStart('0-0', [{}]);

      await expect(launcher.onWorkerEnd('0-0')).resolves.toBeUndefined();
      expect(vi.mocked(stopElectrobunApp)).toHaveBeenCalledTimes(1);

      // Already torn down — onComplete must not stop it again.
      await launcher.onComplete();
      expect(vi.mocked(stopElectrobunApp)).toHaveBeenCalledTimes(1);
    });

    it('should resolve when the worker never spawned an app', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      await launcher.onPrepare(baseConfig, [{}]);

      await expect(launcher.onWorkerEnd('0-9')).resolves.toBeUndefined();
      expect(vi.mocked(stopElectrobunApp)).not.toHaveBeenCalled();
    });
  });
});

describe('ElectrobunLaunchService — devServer management', () => {
  const DEV_SERVER = 'http://localhost:3000';
  const managedStop = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform('darwin');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    vi.mocked(startManagedDevServer).mockResolvedValue({ url: DEV_SERVER, stop: managedStop });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setPlatform(originalPlatform);
  });

  it('should start the managed dev server and tear it down in onComplete', async () => {
    const launcher = makeLauncher({ mode: 'browser', devServerUrl: DEV_SERVER, devServer: 'pnpm dev' } as never);
    await launcher.onPrepare(baseConfig, [{ browserName: 'electrobun' }] as never);
    expect(startManagedDevServer).toHaveBeenCalledWith('pnpm dev', DEV_SERVER);
    await launcher.onComplete();
    expect(managedStop).toHaveBeenCalledOnce();
  });

  it('should throw SevereServiceError when the managed dev server fails to start', async () => {
    vi.mocked(startManagedDevServer).mockRejectedValue(new Error('boom'));
    const launcher = makeLauncher({ mode: 'browser', devServerUrl: DEV_SERVER, devServer: 'pnpm dev' } as never);
    await expect(launcher.onPrepare(baseConfig, [{ browserName: 'electrobun' }] as never)).rejects.toThrow(
      /Failed to start dev server/,
    );
  });

  it('should propagate a function-provided url override to the capability', async () => {
    vi.mocked(startManagedDevServer).mockResolvedValue({ url: 'http://localhost:5173', stop: managedStop });
    const launcher = makeLauncher({
      mode: 'browser',
      devServer: async () => ({ url: 'http://localhost:5173', close: managedStop }),
    } as never);
    const caps: ElectrobunCapabilities[] = [{ browserName: 'electrobun' }];
    await launcher.onPrepare(baseConfig, caps as never);
    expect((caps[0] as Record<string, any>)['wdio:electrobunServiceOptions'].devServerUrl).toBe(
      'http://localhost:5173',
    );
  });

  it('should stop the managed dev server when a later step fails (e.g. an invalid resolved url)', async () => {
    vi.mocked(startManagedDevServer).mockResolvedValue({ url: 'not-a-url', stop: managedStop });
    const launcher = makeLauncher({
      mode: 'browser',
      devServer: async () => ({ url: 'not-a-url', close: managedStop }),
    } as never);
    await expect(launcher.onPrepare(baseConfig, [{ browserName: 'electrobun' }] as never)).rejects.toThrow(
      /not a valid URL/,
    );
    expect(managedStop).toHaveBeenCalledOnce();
  });

  it('should not manage a dev server when devServer is unset', async () => {
    const launcher = makeLauncher({ mode: 'browser', devServerUrl: DEV_SERVER } as never);
    await launcher.onPrepare(baseConfig, [{ browserName: 'electrobun' }] as never);
    expect(startManagedDevServer).not.toHaveBeenCalled();
  });

  it('should fail fast (no spawn) when devServer is a command but devServerUrl is unset', async () => {
    const launcher = makeLauncher({ mode: 'browser', devServer: 'pnpm dev' } as never);
    await expect(launcher.onPrepare(baseConfig, [{ browserName: 'electrobun' }] as never)).rejects.toThrow(
      /devServerUrl is required/,
    );
    expect(startManagedDevServer).not.toHaveBeenCalled();
  });
});
