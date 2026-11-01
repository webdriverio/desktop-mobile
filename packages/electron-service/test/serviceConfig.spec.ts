import { describe, expect, it } from 'vitest';

import { ServiceConfig } from '../src/serviceConfig.js';

class MockServiceConfig extends ServiceConfig {
  get clearMocks() {
    return super.clearMocks;
  }
  get resetMocks() {
    return super.resetMocks;
  }
  get restoreMocks() {
    return super.restoreMocks;
  }
  get cdpOptions() {
    return super.cdpOptions;
  }
  get userDataDir() {
    return super.userDataDir;
  }
  set userDataDir(dir: string | undefined) {
    super.userDataDir = dir;
  }
  instanceOptions(instanceCaps?: WebdriverIO.Capabilities) {
    return super.instanceOptions(instanceCaps);
  }
}

describe('ServiceConfig', () => {
  describe('constructor', () => {
    it.each([
      ['clearMocks', false],
      ['resetMocks', false],
      ['restoreMocks', false],
    ] as const)('should set the default value - %s', (option, expected) => {
      const config = new MockServiceConfig({}, {});
      expect(config[option]).toBe(expected);
    });

    it.each([
      ['cdpBridgeTimeout', 'timeout', 10],
      ['cdpBridgeWaitInterval', 'waitInterval', 20],
      ['cdpBridgeRetryCount', 'connectionRetryCount', 30],
    ] as const)('should set the value only when set in the globalOptions - %s', (option, internalOption, expected) => {
      const globalOptions = {
        [option]: expected,
      };
      const config = new MockServiceConfig(globalOptions, {});
      expect(config.cdpOptions).toStrictEqual({ [internalOption]: expected });
    });

    it('should set and return the globalOptions', () => {
      const globalOptions = { rootDir: '/path/to/my-app' };
      const config = new MockServiceConfig(globalOptions, {});
      expect(config.globalOptions).toStrictEqual(globalOptions);
    });
  });

  it('should set and return the browser', () => {
    const browser = { id: '123' } as unknown as WebdriverIO.Browser;
    const config = new MockServiceConfig({}, {});
    config.browser = browser;
    expect(config.browser).toStrictEqual(browser);
  });

  describe('instanceOptions', () => {
    it("should merge an instance's options over the service-level ones field by field", () => {
      const config = new MockServiceConfig(
        { captureRendererLogs: true, rendererLogLevel: 'warn', mode: 'browser' },
        {},
      );

      const options = config.instanceOptions({
        'wdio:electronServiceOptions': { rendererLogLevel: 'debug', mode: 'native', appBinaryPath: '/apps/a' },
      });

      expect(options).toStrictEqual({
        captureRendererLogs: true,
        rendererLogLevel: 'debug',
        mode: 'native',
        appBinaryPath: '/apps/a',
      });
    });

    it('should return the service-level options for an instance without its own', () => {
      const config = new MockServiceConfig({ captureMainProcessLogs: true }, {});

      expect(config.instanceOptions({ browserName: 'chrome' })).toStrictEqual({ captureMainProcessLogs: true });
      expect(config.instanceOptions()).toStrictEqual({ captureMainProcessLogs: true });
    });

    it('should keep the service-level value for an option an instance sets to undefined', () => {
      const config = new MockServiceConfig({ mode: 'browser', restoreMocks: true }, {});

      expect(
        config.instanceOptions({ 'wdio:electronServiceOptions': { mode: undefined, restoreMocks: undefined } }),
      ).toStrictEqual({ mode: 'browser', restoreMocks: true });
    });
  });

  describe('userDataDir extraction', () => {
    it('should extract user data directory from goog:chromeOptions.args', () => {
      const capabilities = {
        'goog:chromeOptions': {
          args: ['--disable-gpu', '--user-data-dir=/tmp/test-user-data', '--enable-logging'],
        },
      };
      const config = new MockServiceConfig({}, capabilities);
      expect(config.userDataDir).toBe('/tmp/test-user-data');
    });

    it('should handle user data directory with spaces', () => {
      const capabilities = {
        'goog:chromeOptions': {
          args: ['--user-data-dir=/path/with spaces/user-data'],
        },
      };
      const config = new MockServiceConfig({}, capabilities);
      expect(config.userDataDir).toBe('/path/with spaces/user-data');
    });

    it('should return undefined when user data directory is not set', () => {
      const capabilities = {
        'goog:chromeOptions': {
          args: ['--disable-gpu', '--enable-logging'],
        },
      };
      const config = new MockServiceConfig({}, capabilities);
      expect(config.userDataDir).toBeUndefined();
    });

    it('should return undefined when goog:chromeOptions is not present', () => {
      const capabilities = {};
      const config = new MockServiceConfig({}, capabilities);
      expect(config.userDataDir).toBeUndefined();
    });

    it('should return undefined when goog:chromeOptions.args is not an array', () => {
      const capabilities = {
        'goog:chromeOptions': {
          args: 'not-an-array',
        },
      } as unknown as WebdriverIO.Capabilities;
      const config = new MockServiceConfig({}, capabilities);
      expect(config.userDataDir).toBeUndefined();
    });

    it('should return undefined when goog:chromeOptions.args is missing', () => {
      const capabilities = {
        'goog:chromeOptions': {},
      };
      const config = new MockServiceConfig({}, capabilities);
      expect(config.userDataDir).toBeUndefined();
    });

    it('should handle non-string arguments in args array', () => {
      const capabilities = {
        'goog:chromeOptions': {
          args: [123, '--user-data-dir=/tmp/test', null, undefined],
        },
      } as unknown as WebdriverIO.Capabilities;
      const config = new MockServiceConfig({}, capabilities);
      expect(config.userDataDir).toBe('/tmp/test');
    });

    it('should use the first --user-data-dir argument when multiple are present', () => {
      const capabilities = {
        'goog:chromeOptions': {
          args: ['--user-data-dir=/first/path', '--user-data-dir=/second/path'],
        },
      };
      const config = new MockServiceConfig({}, capabilities);
      expect(config.userDataDir).toBe('/first/path');
    });
  });

  describe('userDataDir getter and setter', () => {
    it('should allow setting userDataDir manually', () => {
      const config = new MockServiceConfig({}, {});
      expect(config.userDataDir).toBeUndefined();
      config.userDataDir = '/custom/path';
      expect(config.userDataDir).toBe('/custom/path');
    });

    it('should allow overriding extracted userDataDir', () => {
      const capabilities = {
        'goog:chromeOptions': {
          args: ['--user-data-dir=/extracted/path'],
        },
      };
      const config = new MockServiceConfig({}, capabilities);
      expect(config.userDataDir).toBe('/extracted/path');
      config.userDataDir = '/override/path';
      expect(config.userDataDir).toBe('/override/path');
    });

    it('should allow setting userDataDir to undefined', () => {
      const config = new MockServiceConfig({}, {});
      config.userDataDir = '/some/path';
      expect(config.userDataDir).toBe('/some/path');
      config.userDataDir = undefined;
      expect(config.userDataDir).toBeUndefined();
    });
  });
});
