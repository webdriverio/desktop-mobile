import type { Options } from '@wdio/types';
import { describe, expect, it, vi } from 'vitest';
import { SevereServiceError } from 'webdriverio';

// BaseLauncher (via native-mobile-core's MobileBaseLauncher) carries the PortManager the
// Flutter launcher uses to allocate a dartVmServicePort — stub it with a minimal allocator.
vi.mock('@wdio/native-core', () => ({
  BaseLauncher: class {
    private _next = 9000;
    portManager = { allocatePort: async () => this._next++, releasePort: () => {} };
  },
}));

import FlutterLaunchService from '../src/launcher.js';
import type { FlutterCapabilities, FlutterServiceGlobalOptions } from '../src/types.js';

const config = {} as Options.Testrunner;
// doctor: 'off' keeps onPrepare hermetic — the iOS doctor path shells out to xcrun.
const make = (options: FlutterServiceGlobalOptions = {}) =>
  new FlutterLaunchService({ doctor: 'off', ...options }, {} as FlutterCapabilities, config);
const cap = (over: Record<string, unknown> = {}): FlutterCapabilities =>
  ({ platformName: 'Android', ...over }) as FlutterCapabilities;

describe('FlutterLaunchService.onPrepare', () => {
  it('should set automationName Flutter on an Android capability', async () => {
    const caps = [cap({ platformName: 'Android' })];
    await make().onPrepare(config, caps);
    expect(caps[0]['appium:automationName']).toBe('Flutter');
  });

  it('should set automationName Flutter on an iOS capability', async () => {
    const caps = [cap({ platformName: 'iOS' })];
    await make().onPrepare(config, caps);
    expect(caps[0]['appium:automationName']).toBe('Flutter');
  });

  it('should throw a SevereServiceError for an unsupported platform', async () => {
    await expect(make().onPrepare(config, [cap({ platformName: 'Windows' })])).rejects.toThrow(SevereServiceError);
  });
});

describe('FlutterLaunchService.onWorkerStart', () => {
  it('should stamp the claimed device udid onto the capability', async () => {
    const c = cap({ platformName: 'Android' });
    await make({ devices: [{ udid: 'emulator-5554' }] }).onWorkerStart('0-0', c);
    expect(c['appium:udid']).toBe('emulator-5554');
  });
});
