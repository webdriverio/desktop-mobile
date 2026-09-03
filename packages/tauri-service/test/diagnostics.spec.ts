import { Err, Ok } from '@wdio/native-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagnoseTauriEnvironment } from '../src/diagnostics.js';
import { ensureTauriDriver, ensureWebKitWebDriver } from '../src/driverManager.js';
import type { TauriServiceOptions } from '../src/types.js';

// Stub only the noisy, platform-dependent environment probes.
vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return {
    ...actual,
    diagnosePlatform: () => [],
    diagnoseDisplay: () => [],
    diagnoseBinary: () => [],
    diagnoseLinuxDependencies: () => [],
    diagnoseDiskSpace: () => [],
  };
});

vi.mock('../src/driverManager.js', () => ({
  ensureTauriDriver: vi.fn(),
  ensureWebKitWebDriver: vi.fn(),
}));

const BINARY = '/fake/app';

function tauriDriverResult(results: Awaited<ReturnType<typeof diagnoseTauriEnvironment>>) {
  return results.find((r) => r.category === 'Tauri Driver');
}

describe('diagnoseTauriEnvironment - driver check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ensureWebKitWebDriver).mockResolvedValue(Ok({}));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should report the embedded server as OK without probing for the external driver', async () => {
    const options: TauriServiceOptions = { driverProvider: 'embedded' };

    const result = tauriDriverResult(await diagnoseTauriEnvironment(BINARY, options));

    expect(result?.status).toBe('ok');
    expect(result?.message).toContain('Embedded WebDriver server');
    expect(ensureTauriDriver).not.toHaveBeenCalled();
  });

  it('should treat an omitted driverProvider as embedded (the default) and not probe', async () => {
    const options: TauriServiceOptions = {};

    const result = tauriDriverResult(await diagnoseTauriEnvironment(BINARY, options));

    expect(result?.status).toBe('ok');
    expect(result?.message).toContain('Embedded WebDriver server');
    expect(ensureTauriDriver).not.toHaveBeenCalled();
  });

  it('should report OK for the external provider when the driver is found', async () => {
    vi.mocked(ensureTauriDriver).mockResolvedValue(Ok({ path: '/usr/local/bin/tauri-driver', method: 'found' }));
    const options: TauriServiceOptions = { driverProvider: 'external', autoInstallTauriDriver: true };

    const result = tauriDriverResult(await diagnoseTauriEnvironment(BINARY, options));

    expect(result?.status).toBe('ok');
    expect(result?.message).toBe('/usr/local/bin/tauri-driver (found)');
  });

  it('should report an error for the external provider when the driver is missing', async () => {
    vi.mocked(ensureTauriDriver).mockResolvedValue(
      Err(new Error('tauri-driver not found. Install it with: cargo install tauri-driver')),
    );
    const options: TauriServiceOptions = { driverProvider: 'external' };

    const result = tauriDriverResult(await diagnoseTauriEnvironment(BINARY, options));

    expect(result?.status).toBe('error');
    expect(result?.message).toContain('tauri-driver not found');
  });

  it('should forward the configured provider and driver paths to ensureTauriDriver', async () => {
    vi.mocked(ensureTauriDriver).mockResolvedValue(Ok({ path: '/cn/tauri-driver', method: 'found' }));
    const options: TauriServiceOptions = {
      driverProvider: 'crabnebula',
      crabnebulaDriverPath: '/cn/tauri-driver',
      autoInstallTauriDriver: false,
    };

    await diagnoseTauriEnvironment(BINARY, options);

    expect(ensureTauriDriver).toHaveBeenCalledWith(expect.objectContaining(options));
  });
});
