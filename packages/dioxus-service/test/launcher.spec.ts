import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
        { driverProvider: 'embedded' } as DioxusServiceGlobalOptions,
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
        { driverProvider: 'embedded' } as DioxusServiceGlobalOptions,
        {} as DioxusCapabilities,
        baseConfig,
      );

      await expect(launcher.onPrepare(baseConfig, [{} as DioxusCapabilities])).resolves.toBeUndefined();
    });

    it('should default to embedded provider when none specified', async () => {
      setPlatform('linux');
      const launcher = new DioxusLaunchService({} as DioxusServiceGlobalOptions, {} as DioxusCapabilities, baseConfig);

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

  describe('onComplete', () => {
    it('should resolve without error when no drivers were started', async () => {
      const launcher = new DioxusLaunchService({} as DioxusServiceGlobalOptions, {} as DioxusCapabilities, baseConfig);

      await expect(launcher.onComplete()).resolves.toBeUndefined();
    });
  });
});
