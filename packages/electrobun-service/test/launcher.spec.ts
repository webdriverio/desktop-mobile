import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SevereServiceError } from 'webdriverio';

import { cefRendererRequired } from '../src/errors.js';

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

import { resolveElectrobunApp, verifyCefRenderer, writeRemoteDebuggingPort } from '../src/electrobunConfig.js';
import ElectrobunLaunchService from '../src/launcher.js';
import { spawnElectrobunApp, stopElectrobunApp } from '../src/nativeMode.js';
import type { ElectrobunCapabilities, ElectrobunServiceGlobalOptions } from '../src/types.js';

const baseConfig = {} as Parameters<ElectrobunLaunchService['onPrepare']>[0];

function makeLauncher(options: ElectrobunServiceGlobalOptions): ElectrobunLaunchService {
  return new ElectrobunLaunchService(options, {} as ElectrobunCapabilities, baseConfig);
}

describe('ElectrobunLaunchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
      // Note: onPrepare intentionally NOT called.
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
