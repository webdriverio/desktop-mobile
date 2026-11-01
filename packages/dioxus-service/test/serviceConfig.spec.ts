import { describe, expect, it } from 'vitest';
import { mergeOptions } from '../src/serviceConfig.js';

describe('mergeOptions', () => {
  it('should let capability options override global options', () => {
    const merged = mergeOptions({ mode: 'native', windowLabel: 'main' }, { mode: 'browser' });

    expect(merged).toMatchObject({ mode: 'browser', windowLabel: 'main' });
  });

  it('should keep a global option when the capability sets it to undefined', () => {
    const merged = mergeOptions(
      {
        mode: 'browser',
        devServerUrl: 'http://localhost:8080',
        driverProvider: 'external',
        captureBackendLogs: true,
        captureFrontendLogs: true,
        startTimeout: 15_000,
      },
      {
        mode: undefined,
        devServerUrl: undefined,
        driverProvider: undefined,
        captureBackendLogs: undefined,
        captureFrontendLogs: undefined,
        startTimeout: undefined,
      },
    );

    expect(merged).toMatchObject({
      mode: 'browser',
      devServerUrl: 'http://localhost:8080',
      driverProvider: 'external',
      captureBackendLogs: true,
      captureFrontendLogs: true,
      startTimeout: 15_000,
    });
  });

  it('should default the log capture options when neither global nor capability options set them', () => {
    expect(mergeOptions({})).toMatchObject({
      captureBackendLogs: false,
      captureFrontendLogs: false,
      backendLogLevel: 'info',
      frontendLogLevel: 'info',
    });
  });
});
