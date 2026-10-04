import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/providers/embedded.js', () => ({
  getEmbeddedPort: vi.fn().mockReturnValue(4444),
  startEmbeddedDriver: vi.fn().mockResolvedValue({ proc: { pid: 1234, kill: vi.fn() }, logHandlers: [] }),
  stopEmbeddedDriver: vi.fn().mockResolvedValue(undefined),
  DEFAULT_EMBEDDED_PORT: 4444,
  EMBEDDED_PORT_ENV_VAR: 'WDIO_EMBEDDED_PORT',
}));

import { mockPlatform, restorePlatform } from '@repo/test-utils';
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

    it('should not throw on Windows + provider=external', async () => {
      mockPlatform('win32');
      const launcher = new DioxusLaunchService(
        { driverProvider: 'external' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).resolves.toBeUndefined();
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

    it('should assign distinct sequential ports to multiple embedded capabilities', async () => {
      mockPlatform('linux');
      const launcher = new DioxusLaunchService(
        { driverProvider: 'embedded', appBinaryPath: '/app/dioxus-app' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );
      const caps: DioxusCapabilities[] = [
        { 'dioxus:options': { application: '/app/dioxus-app' } } as DioxusCapabilities,
        { 'dioxus:options': { application: '/app/dioxus-app' } } as DioxusCapabilities,
      ];

      await launcher.onPrepare(baseConfig, caps);

      const calls = vi.mocked(startEmbeddedDriver).mock.calls;
      const ports = calls.slice(-2).map((c) => c[1]);
      expect(ports[1]).toBe(ports[0] + 1);
      expect((caps[0] as { port?: number }).port).toBe(ports[0]);
      expect((caps[1] as { port?: number }).port).toBe(ports[1]);
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
