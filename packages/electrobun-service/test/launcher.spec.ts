import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SevereServiceError } from 'webdriverio';

import { cefRendererRequired } from '../src/errors.js';

// Mock the IO-bound config helpers so the launcher matrix can be driven without
// a real bundle on disk. resolveElectrobunApp returns a fixed resolved app;
// verifyCefRenderer / writeRemoteDebuggingPort are spied so throws + port pinning
// can be asserted. (Their real behaviour is covered in electrobunConfig.spec.ts.)
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

// Mock the native-mode spawn so no real process is launched.
vi.mock('../src/nativeMode.js', () => ({
  spawnElectrobunApp: vi.fn(() => ({
    proc: { pid: 4321, exitCode: null, signalCode: null, kill: vi.fn() },
    userHomeDir: '/tmp/wdio-electrobun-home-test',
    port: 9333,
    logHandlers: [],
  })),
  stopElectrobunApp: vi.fn().mockResolvedValue(undefined),
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
    it('should allocate a port, pin it into build.json, spawn, and set debuggerAddress', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      await launcher.onPrepare(baseConfig, [{}]);

      const cap: ElectrobunCapabilities = {};
      await launcher.onWorkerStart('0-0', [cap]);

      expect(vi.mocked(writeRemoteDebuggingPort)).toHaveBeenCalledTimes(1);
      const [buildJsonPath, port] = vi.mocked(writeRemoteDebuggingPort).mock.calls[0];
      expect(buildJsonPath).toBe('/apps/Demo.app/Contents/Resources/build.json');
      expect(typeof port).toBe('number');

      expect(vi.mocked(spawnElectrobunApp)).toHaveBeenCalledTimes(1);
      const spawnArg = vi.mocked(spawnElectrobunApp).mock.calls[0][0];
      expect(spawnArg.binaryPath).toBe('/apps/Demo.app/Contents/MacOS/Demo');
      expect(spawnArg.port).toBe(port);

      expect(cap['goog:chromeOptions']).toEqual({ debuggerAddress: `localhost:${port}` });
    });

    it('should preserve existing goog:chromeOptions when setting debuggerAddress', async () => {
      const launcher = makeLauncher({ appBinaryPath: '/apps/Demo.app' });
      await launcher.onPrepare(baseConfig, [{}]);

      const cap: ElectrobunCapabilities = { 'goog:chromeOptions': { args: ['--headless'] } };
      await launcher.onWorkerStart('0-0', [cap]);

      const chromeOptions = cap['goog:chromeOptions'] as Record<string, unknown>;
      expect(chromeOptions.args).toEqual(['--headless']);
      expect(chromeOptions.debuggerAddress).toMatch(/^localhost:\d+$/);
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
});
