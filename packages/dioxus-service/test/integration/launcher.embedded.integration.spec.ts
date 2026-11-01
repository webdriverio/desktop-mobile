import { mockPlatform, restorePlatform } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeMultiremoteBrowser, type FakeBrowser } from './helpers.js';

vi.mock('../../src/providers/embedded.js', () => ({
  getEmbeddedPort: vi.fn().mockReturnValue(4444),
  startEmbeddedDriver: vi.fn().mockResolvedValue({ proc: { pid: 1234, kill: vi.fn() }, logHandlers: [] }),
  stopEmbeddedDriver: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@wdio/native-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-utils')>()),
  createLogger: vi.fn(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() })),
}));

import type { DioxusServiceAPI } from '@wdio/native-types';
import { linuxExternalProviderUnsupported } from '../../src/errors.js';
import DioxusLaunchService from '../../src/launcher.js';
import { startEmbeddedDriver } from '../../src/providers/embedded.js';
import DioxusWorkerService from '../../src/service.js';
import type { DioxusCapabilities, DioxusServiceOptions } from '../../src/types.js';

const baseConfig = {} as Parameters<DioxusLaunchService['onPrepare']>[0];

function multiremoteCapabilities(
  instanceOptions: Record<'browserA' | 'browserB', DioxusCapabilities['wdio:dioxusServiceOptions']>,
) {
  return {
    browserA: { capabilities: { 'wdio:dioxusServiceOptions': instanceOptions.browserA } as DioxusCapabilities },
    browserB: { capabilities: { 'wdio:dioxusServiceOptions': instanceOptions.browserB } as DioxusCapabilities },
  };
}

const ranStaleMockReset = (browser: FakeBrowser) =>
  browser.execute.mock.calls.some(([script]) => typeof script === 'function' && script.name === 'clearStaleMocks');

describe('launcher → worker handshake (embedded driver, multiremote)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform('linux');
  });

  afterEach(() => {
    restorePlatform();
  });

  it("should reject 'external' on a later instance before starting a driver", async () => {
    const options: DioxusServiceOptions = { appBinaryPath: '/app/dioxus-app' };
    const launcher = new DioxusLaunchService(options, {}, baseConfig);

    await expect(
      launcher.onPrepare(
        baseConfig,
        multiremoteCapabilities({ browserA: {}, browserB: { driverProvider: 'external' } }),
      ),
    ).rejects.toMatchObject({ message: linuxExternalProviderUnsupported().message });
    expect(startEmbeddedDriver).not.toHaveBeenCalled();
  });

  it("should run every instance that overrides a service-level 'external' on the embedded driver", async () => {
    const options: DioxusServiceOptions = { appBinaryPath: '/app/dioxus-app', driverProvider: 'external' };
    const capabilities = multiremoteCapabilities({
      browserA: { driverProvider: 'embedded' },
      browserB: { driverProvider: 'embedded' },
    });
    await new DioxusLaunchService(options, {}, baseConfig).onPrepare(baseConfig, capabilities);
    expect(startEmbeddedDriver).toHaveBeenCalledTimes(2);

    const { root, instances } = createFakeMultiremoteBrowser(['browserA', 'browserB']);
    await new DioxusWorkerService(options, capabilities).before({}, [], root as unknown as WebdriverIO.Browser);

    for (const instance of instances.values()) {
      expect(ranStaleMockReset(instance)).toBe(true);
      await (instance.dioxus as unknown as DioxusServiceAPI).execute(() => 1);
      expect(String(instance.execute.mock.lastCall?.[0])).toContain('__wdio_value__');
    }
  });
});
