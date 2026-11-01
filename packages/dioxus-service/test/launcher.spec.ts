import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/providers/embedded.js', () => ({
  getEmbeddedPort: vi.fn().mockReturnValue(4444),
  startEmbeddedDriver: vi.fn().mockResolvedValue({ proc: { pid: 1234, kill: vi.fn() }, logHandlers: [] }),
  stopEmbeddedDriver: vi.fn().mockResolvedValue(undefined),
  DEFAULT_EMBEDDED_PORT: 4444,
  EMBEDDED_PORT_ENV_VAR: 'WDIO_EMBEDDED_PORT',
}));

import { mockPlatform, restorePlatform } from '@repo/test-utils';
import type { PortManager } from '@wdio/native-core';
import DioxusLaunchService from '../src/launcher.js';
import { startEmbeddedDriver, stopEmbeddedDriver } from '../src/providers/embedded.js';
import type { DioxusCapabilities, DioxusServiceGlobalOptions } from '../src/types.js';

const baseConfig = {} as Parameters<DioxusLaunchService['onPrepare']>[0];

describe('DioxusLaunchService', () => {
  afterEach(() => {
    restorePlatform();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('onPrepare', () => {
    it('should throw SevereServiceError on Linux + provider=external', async () => {
      mockPlatform('linux');
      const launcher = new DioxusLaunchService(
        { driverProvider: 'external' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).rejects.toThrow(
        /'external' is not supported on Linux/,
      );
    });

    it('should throw SevereServiceError on macOS + provider=external', async () => {
      mockPlatform('darwin');
      const launcher = new DioxusLaunchService(
        { driverProvider: 'external' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).rejects.toThrow(
        /'external' is not supported on macOS/,
      );
    });

    it('should not throw on Linux + provider=embedded', async () => {
      mockPlatform('linux');
      const launcher = new DioxusLaunchService(
        { driverProvider: 'embedded', appBinaryPath: '/app/dioxus-app' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).resolves.toBeUndefined();
    });

    it('should throw SevereServiceError on Windows + provider=external', async () => {
      mockPlatform('win32');
      const launcher = new DioxusLaunchService(
        { driverProvider: 'external' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).rejects.toThrow(
        /'external' is not supported on Windows/,
      );
    });

    it('should not throw on macOS + provider=embedded', async () => {
      mockPlatform('darwin');
      const launcher = new DioxusLaunchService(
        { driverProvider: 'embedded', appBinaryPath: '/app/dioxus-app' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).resolves.toBeUndefined();
    });

    it('should default to embedded provider when none specified', async () => {
      mockPlatform('linux');
      const launcher = new DioxusLaunchService(
        { appBinaryPath: '/app/dioxus-app' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).resolves.toBeUndefined();
    });

    it('should prefer sequential ports for multiple embedded capabilities and use the free ones allocated', async () => {
      mockPlatform('linux');
      const launcher = new DioxusLaunchService(
        { driverProvider: 'embedded', appBinaryPath: '/app/dioxus-app' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );
      const allocatePort = vi
        .spyOn((launcher as unknown as { portManager: PortManager }).portManager, 'allocatePort')
        .mockResolvedValueOnce(4444)
        .mockResolvedValueOnce(51234);
      const caps: DioxusCapabilities[] = [
        { 'dioxus:options': { application: '/app/dioxus-app' } } as DioxusCapabilities,
        { 'dioxus:options': { application: '/app/dioxus-app' } } as DioxusCapabilities,
      ];

      await launcher.onPrepare(baseConfig, caps);

      expect(allocatePort.mock.calls).toEqual([[4444], [4445]]);
      expect(
        vi
          .mocked(startEmbeddedDriver)
          .mock.calls.slice(-2)
          .map((c) => c[1]),
      ).toEqual([4444, 51234]);
      expect((caps[0] as { port?: number }).port).toBe(4444);
      expect((caps[1] as { port?: number }).port).toBe(51234);
    });

    it("should prefer a multiremote instance's own embeddedPort and connect each instance to its allocated port", async () => {
      mockPlatform('linux');
      const launcher = new DioxusLaunchService(
        { driverProvider: 'embedded', appBinaryPath: '/app/dioxus-app' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );
      const allocatePort = vi
        .spyOn((launcher as unknown as { portManager: PortManager }).portManager, 'allocatePort')
        .mockResolvedValueOnce(5000)
        .mockResolvedValueOnce(51234);
      const caps = {
        appA: { capabilities: { 'wdio:dioxusServiceOptions': { embeddedPort: 5000 } } as DioxusCapabilities },
        appB: { capabilities: {} as DioxusCapabilities },
      };

      await launcher.onPrepare(baseConfig, caps);

      expect(allocatePort.mock.calls).toEqual([[5000], [4445]]);
      expect((caps.appA as { port?: number }).port).toBe(5000);
      expect((caps.appB as { port?: number }).port).toBe(51234);
    });

    it('should stop already-started instances when a later one fails', async () => {
      mockPlatform('linux');
      const fakeInfo = { proc: { pid: 1234, kill: vi.fn() }, logHandlers: [] };
      vi.mocked(startEmbeddedDriver).mockResolvedValueOnce(fakeInfo).mockRejectedValueOnce(new Error('port in use'));

      const launcher = new DioxusLaunchService(
        { driverProvider: 'embedded', appBinaryPath: '/app/dioxus-app' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );
      const caps: DioxusCapabilities[] = [
        { 'dioxus:options': { application: '/app/dioxus-app' } } as DioxusCapabilities,
        { 'dioxus:options': { application: '/app/dioxus-app' } } as DioxusCapabilities,
      ];

      await expect(launcher.onPrepare(baseConfig, caps)).rejects.toThrow(/port in use/);
      expect(vi.mocked(stopEmbeddedDriver)).toHaveBeenCalledWith(fakeInfo);
    });

    it('should stop already-started instances when a later one is missing appBinaryPath', async () => {
      mockPlatform('linux');
      const fakeInfo = { proc: { pid: 1234, kill: vi.fn() }, logHandlers: [] };
      vi.mocked(startEmbeddedDriver).mockResolvedValueOnce(fakeInfo);

      const launcher = new DioxusLaunchService(
        { driverProvider: 'embedded' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );
      const caps: DioxusCapabilities[] = [
        { 'dioxus:options': { application: '/app/dioxus-app' } } as DioxusCapabilities,
        {} as DioxusCapabilities, // no appBinaryPath — validation throws after the first spawned
      ];

      await expect(launcher.onPrepare(baseConfig, caps)).rejects.toThrow(/application path not specified/);
      expect(vi.mocked(stopEmbeddedDriver)).toHaveBeenCalledWith(fakeInfo);
    });

    it('should stop already-started multiremote instances when a later one is missing appBinaryPath', async () => {
      mockPlatform('linux');
      const fakeInfo = { proc: { pid: 5678, kill: vi.fn() }, logHandlers: [] };
      vi.mocked(startEmbeddedDriver).mockResolvedValueOnce(fakeInfo);

      const launcher = new DioxusLaunchService(
        { driverProvider: 'embedded' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );
      const caps = {
        appA: { capabilities: { 'dioxus:options': { application: '/app/dioxus-app' } } as DioxusCapabilities },
        appB: { capabilities: {} as DioxusCapabilities },
      };

      await expect(launcher.onPrepare(baseConfig, caps)).rejects.toThrow(
        /application path not specified for multiremote instance "appB"/,
      );
      expect(vi.mocked(stopEmbeddedDriver)).toHaveBeenCalledWith(fakeInfo);
    });

    it('should read driverProvider from capability-level options when present', async () => {
      mockPlatform('linux');
      const launcher = new DioxusLaunchService(
        { driverProvider: 'embedded' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      const caps: DioxusCapabilities[] = [
        { 'wdio:dioxusServiceOptions': { driverProvider: 'external' } } as DioxusCapabilities,
      ];

      await expect(launcher.onPrepare(baseConfig, caps)).rejects.toThrow(/'external' is not supported on Linux/);
    });
  });

  describe('windowLabel', () => {
    beforeEach(() => {
      mockPlatform('linux');
    });

    function makeLauncher(options: DioxusServiceGlobalOptions) {
      return new DioxusLaunchService(
        { appBinaryPath: '/app/dioxus-app', ...options },
        {} as DioxusCapabilities,
        baseConfig,
      );
    }

    it('should copy the service-level windowLabel into each capability', async () => {
      const caps: DioxusCapabilities[] = [
        { 'wdio:dioxusServiceOptions': { startTimeout: 30_000 } } as DioxusCapabilities,
        {} as DioxusCapabilities,
      ];

      await makeLauncher({ windowLabel: 'window-1' }).onPrepare(baseConfig, caps);

      expect(caps[0]['wdio:dioxusServiceOptions']).toEqual({ startTimeout: 30_000, windowLabel: 'window-1' });
      expect(caps[1]['wdio:dioxusServiceOptions']).toEqual({ windowLabel: 'window-1' });
    });

    it("should keep a capability's own windowLabel over the service-level one", async () => {
      const caps: DioxusCapabilities[] = [
        { 'wdio:dioxusServiceOptions': { windowLabel: 'settings' } } as DioxusCapabilities,
      ];

      await makeLauncher({ windowLabel: 'window-1' }).onPrepare(baseConfig, caps);

      expect(caps[0]['wdio:dioxusServiceOptions']).toEqual({ windowLabel: 'settings' });
    });

    it("should copy the service-level windowLabel into each multiremote instance's capabilities", async () => {
      const caps = {
        appA: { capabilities: {} as DioxusCapabilities },
        appB: { capabilities: { 'wdio:dioxusServiceOptions': { windowLabel: 'settings' } } as DioxusCapabilities },
      };

      await makeLauncher({ windowLabel: 'window-1' }).onPrepare(baseConfig, caps);

      expect(caps.appA.capabilities['wdio:dioxusServiceOptions']).toEqual({ windowLabel: 'window-1' });
      expect(caps.appB.capabilities['wdio:dioxusServiceOptions']).toEqual({ windowLabel: 'settings' });
    });

    it('should leave the capability options unset when no windowLabel is configured', async () => {
      const caps: DioxusCapabilities[] = [{} as DioxusCapabilities];

      await makeLauncher({}).onPrepare(baseConfig, caps);

      expect(caps[0]['wdio:dioxusServiceOptions']).toBeUndefined();
    });
  });

  describe('browser mode', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    });

    it('should set browserName=chrome and return early when mode=browser', async () => {
      const launcher = new DioxusLaunchService(
        { mode: 'browser', devServerUrl: 'http://localhost:3000' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );
      const caps: DioxusCapabilities[] = [{ browserName: 'dioxus' } as DioxusCapabilities];

      await launcher.onPrepare(baseConfig, caps);

      expect((caps[0] as { browserName?: string }).browserName).toBe('chrome');
    });

    it('should throw SevereServiceError when devServerUrl is missing in browser mode', async () => {
      const launcher = new DioxusLaunchService(
        { mode: 'browser' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).rejects.toThrow(
        /devServerUrl is required/,
      );
    });

    it('should throw SevereServiceError when devServerUrl is not a valid URL', async () => {
      const launcher = new DioxusLaunchService(
        { mode: 'browser', devServerUrl: 'not-a-url' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).rejects.toThrow(/not a valid URL/);
    });

    it('should remove dioxus:options from capabilities in browser mode', async () => {
      const launcher = new DioxusLaunchService(
        { mode: 'browser', devServerUrl: 'http://localhost:3000' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );
      const caps: DioxusCapabilities[] = [{ 'dioxus:options': { application: '/app/dioxus' } } as DioxusCapabilities];

      await launcher.onPrepare(baseConfig, caps);

      expect((caps[0] as { 'dioxus:options'?: unknown })['dioxus:options']).toBeUndefined();
    });
  });

  describe('onComplete', () => {
    it('should resolve without error when no drivers were started', async () => {
      const launcher = new DioxusLaunchService({} as DioxusServiceGlobalOptions, {} as DioxusCapabilities, baseConfig);

      await expect(launcher.onComplete()).resolves.toBeUndefined();
    });
  });
});
