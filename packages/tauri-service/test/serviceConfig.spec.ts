import { describe, expect, it } from 'vitest';
import { mergeServiceOptions } from '../src/serviceConfig.js';

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

  it("should normalise driverProvider: 'official' to 'external'", () => {
    expect(mergeServiceOptions({ driverProvider: 'official' }, undefined).driverProvider).toBe('external');
    expect(mergeServiceOptions({}, { driverProvider: 'official' }).driverProvider).toBe('external');
  });

  it('should default the log capture options', () => {
    expect(mergeServiceOptions()).toMatchObject({
      captureBackendLogs: false,
      captureFrontendLogs: false,
      backendLogLevel: 'info',
      frontendLogLevel: 'info',
    });
  });
});
