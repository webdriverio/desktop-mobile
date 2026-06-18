import type { Options } from '@wdio/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SevereServiceError } from 'webdriverio';

// BaseLauncher carries @wdio/native-core's port/driver infra the launcher doesn't
// use yet — stub it so onPrepare is exercised in isolation.
vi.mock('@wdio/native-core', () => ({ BaseLauncher: class {} }));

// Controllable Metro so the manageMetro lifecycle can be exercised without a real process.
const metroStart = vi.hoisted(() => vi.fn(async () => {}));
const metroStop = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../src/metroProcess.js', () => ({
  MetroProcess: class {
    start = metroStart;
    stop = metroStop;
  },
}));

// Don't shell out to adb in unit tests — assert the pre-launch reverse is requested.
const adbReverseMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../src/adb.js', () => ({ adbReverse: adbReverseMock }));

import ReactNativeLaunchService from '../src/launcher.js';
import type { ReactNativeCapabilities, ReactNativeServiceGlobalOptions } from '../src/types.js';

const config = {} as Options.Testrunner;

// doctor: false keeps onPrepare hermetic — the iOS doctor path shells out to xcrun.
const make = (options: ReactNativeServiceGlobalOptions = {}) =>
  new ReactNativeLaunchService({ doctor: false, ...options }, {} as ReactNativeCapabilities, config);

const cap = (over: Record<string, unknown> = {}): ReactNativeCapabilities =>
  ({ platformName: 'Android', ...over }) as ReactNativeCapabilities;

describe('ReactNativeLaunchService.onPrepare', () => {
  it('should set UiAutomator2 on an Android capability', async () => {
    const caps = [cap({ platformName: 'Android' })];
    await make().onPrepare(config, caps);
    expect(caps[0]['appium:automationName']).toBe('UiAutomator2');
  });

  it('should set XCUITest on an iOS capability', async () => {
    const caps = [cap({ platformName: 'iOS' })];
    await make().onPrepare(config, caps);
    expect(caps[0]['appium:automationName']).toBe('XCUITest');
  });

  it('should prepare every capability in an array', async () => {
    const caps = [cap({ platformName: 'Android' }), cap({ platformName: 'iOS' })];
    await make().onPrepare(config, caps);
    expect(caps.map((c) => c['appium:automationName'])).toEqual(['UiAutomator2', 'XCUITest']);
  });

  it('should prepare capabilities in a multiremote object', async () => {
    const caps = { phone: { capabilities: cap({ platformName: 'Android' }) } };
    await make().onPrepare(config, caps);
    expect(caps.phone.capabilities['appium:automationName']).toBe('UiAutomator2');
  });

  it('should apply the service appBinaryPath to appium:app', async () => {
    const caps = [cap({ platformName: 'Android' })];
    await make({ appBinaryPath: '/tmp/app.apk' }).onPrepare(config, caps);
    expect(caps[0]['appium:app']).toBe('/tmp/app.apk');
  });

  it('should derive the platform from the service option when platformName is unset', async () => {
    const caps = [cap({ platformName: undefined })];
    await make({ platform: 'iOS' }).onPrepare(config, caps);
    expect(caps[0]['appium:automationName']).toBe('XCUITest');
  });

  it('should throw a SevereServiceError for an unsupported platform', async () => {
    const caps = [cap({ platformName: 'Windows' })];
    await expect(make().onPrepare(config, caps)).rejects.toThrow(SevereServiceError);
  });
});

describe('ReactNativeLaunchService Metro lifecycle', () => {
  afterEach(() => vi.clearAllMocks());

  it('should start Metro before onPrepare when manageMetro is set', async () => {
    await make({ manageMetro: true }).onPrepare(config, [cap({ platformName: 'Android' })]);
    expect(metroStart).toHaveBeenCalledOnce();
  });

  it('should stop Metro if onPrepare fails after Metro started (no orphaned port 8081)', async () => {
    const launcher = make({ manageMetro: true });
    await expect(launcher.onPrepare(config, [cap({ platformName: 'Windows' })])).rejects.toThrow();
    expect(metroStart).toHaveBeenCalledOnce();
    expect(metroStop).toHaveBeenCalledOnce();
  });

  it('should stop Metro if start() itself fails (e.g. readiness timeout)', async () => {
    metroStart.mockRejectedValueOnce(new Error('did not become ready'));
    const launcher = make({ manageMetro: true });
    await expect(launcher.onPrepare(config, [cap({ platformName: 'Android' })])).rejects.toThrow(SevereServiceError);
    expect(metroStop).toHaveBeenCalledOnce();
  });

  it('should not touch Metro when manageMetro is off', async () => {
    await make().onPrepare(config, [cap({ platformName: 'Android' })]);
    expect(metroStart).not.toHaveBeenCalled();
  });
});

describe('ReactNativeLaunchService.onWorkerStart', () => {
  const withDevices = () => make({ devices: [{ udid: 'emulator-5554' }, { udid: 'emulator-5556' }] });
  afterEach(() => vi.clearAllMocks());

  it('should stamp appium:udid onto a single bare capability', async () => {
    const c = cap({ platformName: 'Android' });
    await withDevices().onWorkerStart('0-0', c);
    expect(c['appium:udid']).toBe('emulator-5554');
  });

  it('should stamp appium:udid onto a multiremote capability object', async () => {
    // Regression: a multiremote run passes { instance: { capabilities } }, not an array,
    // so the device must be stamped on the nested capability — not silently dropped.
    const caps = { phone: { capabilities: cap({ platformName: 'Android' }) } };
    await withDevices().onWorkerStart('0-0', caps as unknown as ReactNativeCapabilities);
    expect(caps.phone.capabilities['appium:udid']).toBe('emulator-5554');
  });

  it('should advance the device cursor per worker', async () => {
    const launcher = withDevices();
    const a = cap({ platformName: 'Android' });
    const b = cap({ platformName: 'Android' });
    await launcher.onWorkerStart('0-0', a);
    await launcher.onWorkerStart('0-1', b);
    expect(a['appium:udid']).toBe('emulator-5554');
    expect(b['appium:udid']).toBe('emulator-5556');
  });

  it('should be a no-op when no device pool is configured', async () => {
    const c = cap({ platformName: 'Android' });
    await make().onWorkerStart('0-0', c);
    expect(c['appium:udid']).toBeUndefined();
  });

  it('should not throw on undefined capabilities', async () => {
    await expect(withDevices().onWorkerStart('0-0', undefined)).resolves.toBeUndefined();
  });

  it('should adb-reverse the Metro port for an Android worker (pre-launch)', async () => {
    await make({ metroPort: 8099 }).onWorkerStart('0-0', cap({ platformName: 'Android' }));
    expect(adbReverseMock).toHaveBeenCalledWith(8099, undefined);
  });

  it('should target the stamped device udid when a pool is configured', async () => {
    await withDevices().onWorkerStart('0-0', cap({ platformName: 'Android' }));
    expect(adbReverseMock).toHaveBeenCalledWith(8081, 'emulator-5554');
  });

  it('should not adb-reverse for an iOS worker', async () => {
    await make().onWorkerStart('0-0', cap({ platformName: 'iOS' }));
    expect(adbReverseMock).not.toHaveBeenCalled();
  });
});
