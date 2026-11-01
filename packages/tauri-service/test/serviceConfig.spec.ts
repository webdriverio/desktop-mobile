import { describe, expect, it } from 'vitest';
import { mergeServiceOptions, resolveStartTimeout } from '../src/serviceConfig.js';

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
