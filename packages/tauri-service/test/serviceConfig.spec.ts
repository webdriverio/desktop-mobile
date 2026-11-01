import { afterEach, describe, expect, it, vi } from 'vitest';
import { appEnv, hideEnvValues, mergeServiceOptions, resolveStartTimeout } from '../src/serviceConfig.js';

describe('mergeServiceOptions', () => {
  it('should let capability options override global options', () => {
    const merged = mergeServiceOptions({ mode: 'native', windowLabel: 'main' }, { mode: 'browser' });

    expect(merged).toMatchObject({ mode: 'browser', windowLabel: 'main' });
  });

  it('should keep a global option when the capability sets it to undefined', () => {
    const merged = mergeServiceOptions(
      { mode: 'browser', devServerUrl: 'http://localhost:1420', driverProvider: 'external' },
      { mode: undefined, devServerUrl: undefined, driverProvider: undefined },
    );

    expect(merged).toMatchObject({
      mode: 'browser',
      devServerUrl: 'http://localhost:1420',
      driverProvider: 'external',
    });
  });

  it('should leave driverProvider unset when no options set it', () => {
    expect(mergeServiceOptions({}, undefined).driverProvider).toBeUndefined();
  });

  it('should default the log capture options', () => {
    expect(mergeServiceOptions()).toMatchObject({
      captureBackendLogs: false,
      captureFrontendLogs: false,
      backendLogLevel: 'info',
      frontendLogLevel: 'info',
    });
  });

  it('should default logLevel when neither side sets it', () => {
    expect(mergeServiceOptions({}, {}).logLevel).toBe('info');
  });

  it('should keep a global logLevel when the capability leaves it unset', () => {
    expect(mergeServiceOptions({ logLevel: 'debug' }, { logLevel: undefined }).logLevel).toBe('debug');
  });

  it('should let the capability override a global logLevel', () => {
    expect(mergeServiceOptions({ logLevel: 'debug' }, { logLevel: 'error' }).logLevel).toBe('error');
  });
});

describe('resolveStartTimeout', () => {
  it('should default to 60000', () => {
    expect(resolveStartTimeout({})).toBe(60000);
  });

  it('should prefer an explicit startTimeout', () => {
    expect(resolveStartTimeout({ startTimeout: 45000 })).toBe(45000);
  });
});

describe('appEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should set the app's env over process.env, and the service's own vars over both", () => {
    vi.stubEnv('WDIO_APP_ENV_KEPT', 'process');
    vi.stubEnv('WDIO_APP_ENV_FLAG', 'process');
    vi.stubEnv('WDIO_APP_ENV_DIR', 'process');

    const env = appEnv({ env: { WDIO_APP_ENV_FLAG: 'app', WDIO_APP_ENV_DIR: 'app' } }, { WDIO_APP_ENV_DIR: 'service' });

    expect(env).toMatchObject({ WDIO_APP_ENV_KEPT: 'process', WDIO_APP_ENV_FLAG: 'app', WDIO_APP_ENV_DIR: 'service' });
  });

  it("should replace a variable whatever its case on Windows, so the app's PATH isn't dropped", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
      const appKey = pathKey === 'PATH' ? 'Path' : 'PATH';

      const env = appEnv({ env: { [appKey]: 'C:\\tools' } });

      expect(env[appKey]).toBe('C:\\tools');
      expect(env).not.toHaveProperty(pathKey);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('should return process.env as is without an app env or service vars', () => {
    expect(appEnv(undefined)).toEqual({ ...process.env });
  });
});

describe('hideEnvValues', () => {
  it('should show only the names of an env, at any depth', () => {
    const logged = JSON.stringify(
      { env: { CN_API_KEY: 'secret-value' }, services: [['tauri', { env: { TOKEN: 'other-secret' } }]] },
      hideEnvValues,
    );

    expect(logged).toBe('{"env":["CN_API_KEY"],"services":[["tauri",{"env":["TOKEN"]}]]}');
  });
});
