import { describe, expect, it } from 'vitest';
import {
  applyCommandTimeout,
  DEFAULT_COMMAND_TIMEOUT,
  DEFAULT_LOG_LEVEL,
  mergeServiceOptions,
} from '../src/serviceConfig.js';

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

  it('should default logLevel and commandTimeout when neither side sets them', () => {
    const merged = mergeServiceOptions({}, {});
    expect(merged.logLevel).toBe(DEFAULT_LOG_LEVEL);
    expect(merged.commandTimeout).toBe(DEFAULT_COMMAND_TIMEOUT);
  });

  it('should keep a global logLevel and commandTimeout when the capability leaves them unset', () => {
    const merged = mergeServiceOptions({ logLevel: 'debug', commandTimeout: 45_000 }, { logLevel: undefined });
    expect(merged.logLevel).toBe('debug');
    expect(merged.commandTimeout).toBe(45_000);
  });

  it('should let the capability override a global logLevel and commandTimeout', () => {
    const merged = mergeServiceOptions(
      { logLevel: 'debug', commandTimeout: 45_000 },
      { logLevel: 'error', commandTimeout: 10_000 },
    );
    expect(merged.logLevel).toBe('error');
    expect(merged.commandTimeout).toBe(10_000);
  });
});

describe('applyCommandTimeout', () => {
  it('should set the client request timeout', () => {
    const browser = { options: { connectionRetryTimeout: 120_000 } };
    applyCommandTimeout(browser, 10_000);
    expect(browser.options.connectionRetryTimeout).toBe(10_000);
  });

  it('should skip a browser that has no options object', () => {
    const browser: { options?: { connectionRetryTimeout?: number } } = {};
    applyCommandTimeout(browser, 10_000);
    expect(browser.options).toBeUndefined();
  });
});
