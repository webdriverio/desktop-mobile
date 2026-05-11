import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/providers/embedded.js', () => ({
  getEmbeddedPort: vi.fn().mockReturnValue(4444),
  startEmbeddedDriver: vi.fn().mockResolvedValue({ proc: { pid: 1234, kill: vi.fn() }, logHandlers: [] }),
  stopEmbeddedDriver: vi.fn().mockResolvedValue(undefined),
  DEFAULT_EMBEDDED_PORT: 4444,
  EMBEDDED_PORT_ENV_VAR: 'WDIO_EMBEDDED_PORT',
}));

import DioxusLaunchService from '../src/launcher.js';
import type { DioxusCapabilities, DioxusServiceGlobalOptions } from '../src/types.js';

const baseConfig = {} as Parameters<DioxusLaunchService['onPrepare']>[0];

describe('DioxusLaunchService', () => {
  const originalPlatform = process.platform;

  function setPlatform(value: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value, writable: true });
  }

  afterEach(() => {
    setPlatform(originalPlatform);
    vi.restoreAllMocks();
  });

  describe('onPrepare', () => {
    it('should throw SevereServiceError on Linux + provider=external', async () => {
      setPlatform('linux');
      const launcher = new DioxusLaunchService(
        { driverProvider: 'external' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).rejects.toThrow(
        /'external' is not supported on Linux/,
      );
    });

    it('should not throw on Linux + provider=embedded', async () => {
      setPlatform('linux');
      const launcher = new DioxusLaunchService(
        { driverProvider: 'embedded', appBinaryPath: '/app/dioxus-app' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).resolves.toBeUndefined();
    });

    it('should not throw on Windows + provider=external', async () => {
      setPlatform('win32');
      const launcher = new DioxusLaunchService(
        { driverProvider: 'external' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).resolves.toBeUndefined();
    });

    it('should not throw on macOS + provider=embedded', async () => {
      setPlatform('darwin');
      const launcher = new DioxusLaunchService(
        { driverProvider: 'embedded', appBinaryPath: '/app/dioxus-app' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).resolves.toBeUndefined();
    });

    it('should default to embedded provider when none specified', async () => {
      setPlatform('linux');
      const launcher = new DioxusLaunchService(
        { appBinaryPath: '/app/dioxus-app' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).resolves.toBeUndefined();
    });

    it('should read driverProvider from capability-level options when present', async () => {
      setPlatform('linux');
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
