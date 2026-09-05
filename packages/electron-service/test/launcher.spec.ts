import { access } from 'node:fs/promises';
import path from 'node:path';
import type { AppBuildInfo, BinaryPathResult, ElectronServiceOptions } from '@wdio/native-types';
import type { Capabilities, Options } from '@wdio/types';
import getPort from 'get-port';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import ElectronLaunchService from '../src/launcher.js';
import { mockProcessProperty, revertProcessProperty } from './helpers.js';

let LaunchService: typeof ElectronLaunchService;
let instance: ElectronLaunchService | undefined;
let options: ElectronServiceOptions;

// Mocked functions
let getBinaryPath: Mock<() => Promise<BinaryPathResult>>;
let getAppBuildInfo: Mock<() => Promise<AppBuildInfo>>;
let getElectronVersion: Mock<() => Promise<string>>;
let probeChromiumVersion: Mock<() => Promise<string | undefined>>;
let readPackageUp: Mock<
  (options?: {
    cwd?: string;
  }) => Promise<
    | { packageJson: { dependencies: Record<string, string>; devDependencies: Record<string, string> }; path: string }
    | undefined
  >
>;
let readPackageUpSync: Mock<
  (options?: {
    cwd?: string;
  }) =>
    | { packageJson: { dependencies: Record<string, string>; devDependencies: Record<string, string> }; path: string }
    | undefined
>;

function getFixtureDir(fixtureType: string, fixtureName: string) {
  return path.join(process.cwd(), '..', '..', 'fixtures', fixtureType, fixtureName);
}

vi.mock('node:fs/promises', () => {
  const mockAccessFn = vi.fn().mockResolvedValue(undefined);
  return {
    access: mockAccessFn,
    default: {
      access: mockAccessFn,
    },
  };
});
// Mock @wdio/native-utils with specific implementations to avoid interfering with vitest internals
vi.mock('@wdio/native-utils', async () => {
  const actual = await vi.importActual('@wdio/native-utils');
  return {
    ...actual,
    readPackageUp: vi.fn(),
    readPackageUpSync: vi.fn(),
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    })),
  };
});

vi.mock('../src/appBuildInfo.js', () => ({ getAppBuildInfo: vi.fn() }));
vi.mock('../src/binaryPath.js', () => ({ getBinaryPath: vi.fn() }));
vi.mock('../src/electronVersion.js', () => ({ getElectronVersion: vi.fn() }));
vi.mock('../src/binaryProbe.js', () => ({ probeChromiumVersion: vi.fn() }));

vi.mock('get-port', async () => {
  return {
    default: vi.fn(),
  };
});

beforeEach(async () => {
  mockProcessProperty('platform', 'darwin');

  // Get references to the mocked functions
  const nativeUtils = await import('@wdio/native-utils');
  const appBuildInfoMod = await import('../src/appBuildInfo.js');
  const binaryPathMod = await import('../src/binaryPath.js');
  const electronVersionMod = await import('../src/electronVersion.js');
  getBinaryPath = binaryPathMod.getBinaryPath as Mock<() => Promise<BinaryPathResult>>;
  getAppBuildInfo = appBuildInfoMod.getAppBuildInfo as Mock<() => Promise<AppBuildInfo>>;
  getElectronVersion = electronVersionMod.getElectronVersion as Mock<() => Promise<string>>;
  const binaryProbeMod = await import('../src/binaryProbe.js');
  probeChromiumVersion = binaryProbeMod.probeChromiumVersion as Mock<() => Promise<string | undefined>>;
  // Default: the probe finds nothing, so the map remains the sole resolver unless a test overrides it.
  probeChromiumVersion.mockResolvedValue(undefined);
  readPackageUp = nativeUtils.readPackageUp as Mock<
    (
      ...args: unknown[]
    ) => Promise<
      | { packageJson: { dependencies: Record<string, string>; devDependencies: Record<string, string> }; path: string }
      | undefined
    >
  >;
  readPackageUpSync = nativeUtils.readPackageUpSync as Mock<
    (
      ...args: unknown[]
    ) =>
      | { packageJson: { dependencies: Record<string, string>; devDependencies: Record<string, string> }; path: string }
      | undefined
  >;
  getBinaryPath.mockResolvedValue({
    ok: true,
    value: {
      binaryPath: 'workspace/my-test-app/dist/my-test-app',
      pathGeneration: {
        ok: true,
        value: {
          paths: ['workspace/my-test-app/dist/my-test-app'],
        },
      },
      pathValidation: {
        ok: true,
        value: {
          validPath: 'workspace/my-test-app/dist/my-test-app',
          attempts: [
            {
              path: 'workspace/my-test-app/dist/my-test-app',
              valid: true,
            },
          ],
        },
      },
    },
  } as unknown as BinaryPathResult);

  getAppBuildInfo.mockResolvedValue({
    appName: 'my-test-app',
    isBuilder: false,
    isForge: true,
    config: {},
  });

  // Default getElectronVersion mock - returns a version >= 26 by default
  getElectronVersion.mockResolvedValue('30.0.0');

  // Default readPackageUp mock - returns a valid result based on the cwd option
  readPackageUp.mockImplementation(async (options?: { cwd?: string }) => {
    const cwdPath = options?.cwd || getFixtureDir('package-scenarios', 'no-build-tool');
    return {
      packageJson: { dependencies: { electron: '^26.0.0' }, devDependencies: {} },
      path: path.join(cwdPath, 'package.json'),
    };
  });
  readPackageUpSync.mockImplementation((options?: { cwd?: string }) => {
    const cwdPath = options?.cwd || getFixtureDir('package-scenarios', 'no-build-tool');
    return {
      packageJson: { dependencies: { electron: '^26.0.0' }, devDependencies: {} },
      path: path.join(cwdPath, 'package.json'),
    };
  });

  LaunchService = (await import('../src/launcher.js')).default;
  options = {
    appBinaryPath: 'workspace/my-test-app/dist/my-test-app',
    appArgs: [],
  };
  nock('https://electronjs.org')
    .get('/headers/index.json')
    .reply(200, [
      {
        version: '25.0.0',
        chrome: '114.0.5735.45',
      },
      {
        version: '26.0.0',
        chrome: '116.0.5845.82',
      },
      {
        version: '26.2.2',
        chrome: '116.0.5845.190',
      },
      {
        version: '32.0.1',
        chrome: '128.0.6613.36',
      },
    ]);
});

afterEach(() => {
  instance = undefined;
  revertProcessProperty('platform');
  vi.mocked(access).mockReset().mockResolvedValue(undefined);
  // Note: Not using vi.resetModules() here due to Windows path issues in Vitest 4
  // See: https://github.com/vitest-dev/vitest/issues/693
  vi.clearAllMocks();
});

describe('Electron Launch Service', () => {
  describe('onPrepare()', () => {
    beforeEach(() => {
      instance = new LaunchService(
        options,
        [] as never,
        {
          services: [['electron', options]],
        } as Options.Testrunner,
      );
    });

    it('should throw an error when there is no electron browser in capabilities', async () => {
      const capabilities: WebdriverIO.Capabilities[] = [
        {
          browserName: 'chrome',
          browserVersion: '26.2.2',
        },
      ];
      await expect(() => instance?.onPrepare({} as never, capabilities)).rejects.toThrow(
        'No Electron browser found in capabilities',
      );
    });

    describe('package scenarios', () => {
      it('should throw an error when the local Electron version is older than v26 and Chromedriver is not configured manually', async () => {
        // Mock old electron version for this test
        (getElectronVersion as Mock).mockResolvedValueOnce('25.0.0');

        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('package-scenarios', 'old-electron'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
          },
        ];
        await expect(() => instance?.onPrepare({} as never, capabilities)).rejects.toThrow(
          'Electron version must be 26 or higher for auto-configuration of Chromedriver.  If you want to use an older version of Electron, you must configure Chromedriver manually using the wdio:chromedriverOptions capability',
        );
      });

      it('should not throw an error when the local Electron version is older than v26 and Chromedriver is configured manually', async () => {
        // Mock old electron version for this test
        (getElectronVersion as Mock).mockResolvedValueOnce('25.0.0');

        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('package-scenarios', 'old-electron'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            'wdio:chromedriverOptions': {
              binary: '/path/to/chromedriver',
            },
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities[0]).toEqual({
          browserName: 'chrome',
          browserVersion: '114.0.5735.45',
          'goog:chromeOptions': {
            args: [],
            binary: 'workspace/my-test-app/dist/my-test-app',
            windowTypes: ['app', 'webview'],
          },
          'wdio:chromedriverOptions': {
            binary: '/path/to/chromedriver',
          },
          'wdio:electronServiceOptions': {},
          'wdio:chromiumVersion': '114.0.5735.45',
          'wdio:electronVersion': '25.0.0',
          'wdio:enforceWebDriverClassic': true,
        });
      });

      it('should throw an error when appBinaryPath is not specified and no build tool is found', async () => {
        delete options.appBinaryPath;
        (getAppBuildInfo as Mock).mockRejectedValueOnce(new Error('b0rk - no build tool found'));
        instance = new LaunchService(
          options,
          [] as never,
          {
            rootDir: getFixtureDir('package-scenarios', 'no-build-tool'),
            services: [['electron', options]],
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
            'wdio:electronServiceOptions': {
              appArgs: ['some', 'args'],
            },
          },
        ];
        await expect(() => instance?.onPrepare({} as never, capabilities)).rejects.toThrow(
          'b0rk - no build tool found',
        );
      });

      it('should use appEntryPoint when both appEntryPoint and appBinaryPath are set', async () => {
        options.appEntryPoint = './path/to/bundled/electron/main.bundle.js';
        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('package-scenarios', 'no-build-tool'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
            'wdio:electronServiceOptions': {
              appArgs: ['some', 'args'],
            },
          },
        ];
        await instance?.onPrepare({} as never, capabilities);

        // Verify appEntryPoint is used (in args) and appBinaryPath is ignored
        expect(capabilities[0]['goog:chromeOptions']?.args).toContain(
          '--app=./path/to/bundled/electron/main.bundle.js',
        );
        expect(capabilities[0]['goog:chromeOptions']?.binary).toBe(
          path.join(getFixtureDir('package-scenarios', 'no-build-tool'), 'node_modules', '.bin', 'electron'),
        );
      });

      it('should throw an error when the detected app path does not exist for a Forge dependency', async () => {
        delete options.appBinaryPath;
        (getBinaryPath as Mock).mockResolvedValueOnce({
          ok: false,
          error: {
            pathGeneration: {
              ok: true,
              value: {
                paths: [
                  '/Users/sam/Workspace/wdio-electron-service/fixtures/config-formats/forge-dependency-inline-config/out/my-test-app-darwin-x64/my-test-app.app/Contents/MacOS/my-test-app',
                  '/Users/sam/Workspace/wdio-electron-service/fixtures/config-formats/forge-dependency-inline-config/out/my-test-app-darwin-arm64/my-test-app.app/Contents/MacOS/my-test-app',
                  '/Users/sam/Workspace/wdio-electron-service/fixtures/config-formats/forge-dependency-inline-config/out/my-test-app-darwin-universal/my-test-app.app/Contents/MacOS/my-test-app',
                ],
              },
            },
            pathValidation: {
              ok: false,
              error: {
                attempts: [
                  {
                    path: '/Users/sam/Workspace/wdio-electron-service/fixtures/config-formats/forge-dependency-inline-config/out/my-test-app-darwin-x64/my-test-app.app/Contents/MacOS/my-test-app',
                    valid: false,
                    error: {
                      type: 'FILE_NOT_FOUND',
                      message: 'ENOENT: no such file or directory',
                      code: 'ENOENT',
                    },
                  },
                  {
                    path: '/Users/sam/Workspace/wdio-electron-service/fixtures/config-formats/forge-dependency-inline-config/out/my-test-app-darwin-arm64/my-test-app.app/Contents/MacOS/my-test-app',
                    valid: false,
                    error: {
                      type: 'FILE_NOT_FOUND',
                      message: 'ENOENT: no such file or directory',
                      code: 'ENOENT',
                    },
                  },
                  {
                    path: '/Users/sam/Workspace/wdio-electron-service/fixtures/config-formats/forge-dependency-inline-config/out/my-test-app-darwin-universal/my-test-app.app/Contents/MacOS/my-test-app',
                    valid: false,
                    error: {
                      type: 'FILE_NOT_FOUND',
                      message: 'ENOENT: no such file or directory',
                      code: 'ENOENT',
                    },
                  },
                ],
              },
            },
          },
        } as unknown as BinaryPathResult);
        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('config-formats', 'forge-dependency-inline-config'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
            'wdio:electronServiceOptions': {
              appArgs: ['some', 'args'],
            },
          },
        ];
        await expect(() => instance?.onPrepare({} as never, capabilities)).rejects.toThrow(
          /Failed setting up Electron session:.*Could not find Electron app built with Electron Forge!/s,
        );
      });

      it('should throw an error when the detected app path does not exist for an electron-builder dependency', async () => {
        delete options.appBinaryPath;
        (getBinaryPath as Mock).mockResolvedValueOnce({
          ok: false,
          error: {
            pathGeneration: {
              ok: true,
              value: {
                paths: ['<expected binary path>'],
              },
            },
            pathValidation: {
              ok: false,
              error: {
                attempts: [
                  {
                    path: '<expected binary path>',
                    valid: false,
                    error: {
                      type: 'FILE_NOT_FOUND',
                      message: 'ENOENT: no such file or directory',
                      code: 'ENOENT',
                    },
                  },
                ],
              },
            },
          },
        } as unknown as BinaryPathResult);
        (getAppBuildInfo as Mock).mockResolvedValueOnce({
          appName: 'my-test-app',
          isForge: false,
          config: {},
        });
        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('config-formats', 'builder-dependency-inline-config'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
            'wdio:electronServiceOptions': {
              appArgs: ['some', 'args'],
            },
          },
        ];
        await expect(() => instance?.onPrepare({} as never, capabilities)).rejects.toThrow(
          /Failed setting up Electron session:.*Could not find Electron app built with electron-builder!/s,
        );
      });

      it('should use appEntryPoint when only appEntryPoint is provided', async () => {
        delete options.appBinaryPath;
        options.appEntryPoint = './main.js';
        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('package-scenarios', 'no-build-tool'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
          },
        ];
        await instance?.onPrepare({} as never, capabilities);

        expect(capabilities[0]['goog:chromeOptions']?.args).toContain('--app=./main.js');
      });

      it('should wrap unexpected getBinaryPath errors with build tool suggestion', async () => {
        delete options.appBinaryPath;
        (getBinaryPath as Mock).mockRejectedValueOnce(new Error('Unexpected filesystem error'));

        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('package-scenarios', 'no-build-tool'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
          },
        ];
        await expect(() => instance?.onPrepare({} as never, capabilities)).rejects.toThrow(
          /Could not find Electron app built with Electron Forge/,
        );
      });

      it('should suggest electron-builder when build tool is not forge', async () => {
        delete options.appBinaryPath;
        (getBinaryPath as Mock).mockRejectedValueOnce(new Error('Unexpected error'));
        (getAppBuildInfo as Mock).mockResolvedValueOnce({
          appName: 'my-test-app',
          isForge: false,
          isBuilder: true,
          config: {},
        });

        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('package-scenarios', 'no-build-tool'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
          },
        ];
        await expect(() => instance?.onPrepare({} as never, capabilities)).rejects.toThrow(
          /Could not find Electron app built with electron-builder/,
        );
      });

      it('should override global options with capabilities', async () => {
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
            'wdio:electronServiceOptions': {
              appBinaryPath: 'workspace/my-other-test-app/dist/my-other-test-app',
            },
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities[0]).toEqual({
          browserName: 'chrome',
          browserVersion: '116.0.5845.190',
          'goog:chromeOptions': {
            args: [],
            binary: 'workspace/my-other-test-app/dist/my-other-test-app',
            windowTypes: ['app', 'webview'],
          },
          'wdio:chromedriverOptions': {},
          'wdio:electronServiceOptions': {
            appBinaryPath: 'workspace/my-other-test-app/dist/my-other-test-app',
          },
          'wdio:chromiumVersion': '116.0.5845.190',
          'wdio:electronVersion': '26.2.2',
          'wdio:enforceWebDriverClassic': true,
        });
      });

      it('should pass through browserVersion', async () => {
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: 'some-version',
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities[0]).toEqual({
          browserName: 'chrome',
          browserVersion: 'some-version',
          'goog:chromeOptions': {
            args: [],
            binary: 'workspace/my-test-app/dist/my-test-app',
            windowTypes: ['app', 'webview'],
          },
          'wdio:electronServiceOptions': {},
          'wdio:chromiumVersion': undefined,
          'wdio:electronVersion': 'some-version',
          'wdio:enforceWebDriverClassic': true,
        });
      });

      it('should resolve the Chromium version by probing the binary when the map has no entry', async () => {
        // 'some-version' is not in the headers map, so onPrepare falls back to probing the binary.
        probeChromiumVersion.mockResolvedValueOnce('150.0.7871.129');
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: 'some-version',
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(probeChromiumVersion).toHaveBeenCalledWith('workspace/my-test-app/dist/my-test-app');
        expect(capabilities[0]).toEqual({
          browserName: 'chrome',
          browserVersion: '150.0.7871.129',
          'goog:chromeOptions': {
            args: [],
            binary: 'workspace/my-test-app/dist/my-test-app',
            windowTypes: ['app', 'webview'],
          },
          'wdio:chromedriverOptions': {},
          'wdio:electronServiceOptions': {},
          'wdio:chromiumVersion': '150.0.7871.129',
          'wdio:electronVersion': 'some-version',
          'wdio:enforceWebDriverClassic': true,
        });
      });

      it('should not probe the binary when the map resolves the Chromium version', async () => {
        (getElectronVersion as Mock).mockResolvedValueOnce('26.0.0');
        const capabilities: WebdriverIO.Capabilities[] = [{ browserName: 'electron' }];
        await instance?.onPrepare({} as never, capabilities);
        expect((capabilities[0] as Record<string, unknown>)['wdio:chromiumVersion']).toBe('116.0.5845.82');
        expect(probeChromiumVersion).not.toHaveBeenCalled();
      });

      it('should use the Electron version from the local package dependencies when browserVersion is not provided', async () => {
        // Mock electron version that matches the expected chrome version
        (getElectronVersion as Mock).mockResolvedValueOnce('26.0.0');

        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('package-scenarios', 'electron-in-dependencies'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities[0]).toEqual({
          browserName: 'chrome',
          browserVersion: '116.0.5845.82',
          'goog:chromeOptions': {
            args: [],
            binary: 'workspace/my-test-app/dist/my-test-app',
            windowTypes: ['app', 'webview'],
          },
          'wdio:chromedriverOptions': {},
          'wdio:electronServiceOptions': {},
          'wdio:chromiumVersion': '116.0.5845.82',
          'wdio:electronVersion': '26.0.0',
          'wdio:enforceWebDriverClassic': true,
        });
      });

      it('should use the Electron version from the nearest package dependencies when browserVersion is not provided', async () => {
        // Mock electron version that matches the expected chrome version
        (getElectronVersion as Mock).mockResolvedValueOnce('26.0.0');

        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: path.join(getFixtureDir('package-scenarios', 'electron-in-dependencies'), 'subpackage', 'subdir'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities[0]).toEqual({
          browserName: 'chrome',
          browserVersion: '116.0.5845.82',
          'goog:chromeOptions': {
            args: [],
            binary: 'workspace/my-test-app/dist/my-test-app',
            windowTypes: ['app', 'webview'],
          },
          'wdio:chromedriverOptions': {},
          'wdio:electronServiceOptions': {},
          'wdio:chromiumVersion': '116.0.5845.82',
          'wdio:electronVersion': '26.0.0',
          'wdio:enforceWebDriverClassic': true,
        });
      });

      it('should use the Electron version from the local package devDependencies when browserVersion is not provided', async () => {
        // Mock electron version that matches the expected chrome version
        (getElectronVersion as Mock).mockResolvedValueOnce('26.0.0');

        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('package-scenarios', 'electron-in-dev-dependencies'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities[0]).toEqual({
          browserName: 'chrome',
          browserVersion: '116.0.5845.82',
          'goog:chromeOptions': {
            args: [],
            binary: 'workspace/my-test-app/dist/my-test-app',
            windowTypes: ['app', 'webview'],
          },
          'wdio:chromedriverOptions': {},
          'wdio:electronServiceOptions': {},
          'wdio:chromiumVersion': '116.0.5845.82',
          'wdio:electronVersion': '26.0.0',
          'wdio:enforceWebDriverClassic': true,
        });
      });

      it('should use the Electron version from the nearest package devDependencies when browserVersion is not provided', async () => {
        // Mock electron version that matches the expected chrome version
        (getElectronVersion as Mock).mockResolvedValueOnce('26.0.0');

        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: path.join(
              getFixtureDir('package-scenarios', 'electron-in-dev-dependencies'),
              'subpackage',
              'subdir',
            ),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities[0]).toEqual({
          browserName: 'chrome',
          browserVersion: '116.0.5845.82',
          'goog:chromeOptions': {
            args: [],
            binary: 'workspace/my-test-app/dist/my-test-app',
            windowTypes: ['app', 'webview'],
          },
          'wdio:chromedriverOptions': {},
          'wdio:electronServiceOptions': {},
          'wdio:chromiumVersion': '116.0.5845.82',
          'wdio:electronVersion': '26.0.0',
          'wdio:enforceWebDriverClassic': true,
        });
      });

      it('should throw an error when browserVersion is not provided and there is no local Electron version', async () => {
        (getElectronVersion as Mock).mockResolvedValueOnce(undefined as unknown as string);

        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('package-scenarios', 'no-electron'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
          },
        ];
        await expect(() => instance?.onPrepare({} as never, capabilities)).rejects.toThrow(
          'Could not determine the Electron version under test',
        );
      });

      it('should name the Electron version when it has no known Chromium version', async () => {
        // A forked build resolves as an Electron version but is absent from the Electron -> Chromium
        // map, so the remedy is not "install Electron locally".
        (getElectronVersion as Mock).mockResolvedValueOnce('99.0.0-myfork');

        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('package-scenarios', 'no-electron'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
          },
        ];
        await expect(() => instance?.onPrepare({} as never, capabilities)).rejects.toThrow(
          'Could not determine the Chromium version for Electron v99.0.0-myfork',
        );
      });

      it('should not throw for an unmappable Electron version when a Chromedriver binary is supplied', async () => {
        (getElectronVersion as Mock).mockResolvedValueOnce('99.0.0-myfork');

        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('package-scenarios', 'no-electron'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            'wdio:chromedriverOptions': { binary: '/path/to/chromedriver' },
          },
        ];
        await expect(instance?.onPrepare({} as never, capabilities)).resolves.not.toThrow();
      });

      it('should set the expected capabilities', async () => {
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities[0]).toEqual({
          browserName: 'chrome',
          browserVersion: '116.0.5845.190',
          'goog:chromeOptions': {
            args: [],
            binary: 'workspace/my-test-app/dist/my-test-app',
            windowTypes: ['app', 'webview'],
          },
          'wdio:chromedriverOptions': {},
          'wdio:electronServiceOptions': {},
          'wdio:chromiumVersion': '116.0.5845.190',
          'wdio:electronVersion': '26.2.2',
          'wdio:enforceWebDriverClassic': true,
        });
      });

      it('should apply `--no-sandbox` to the app when appArgs is not set', async () => {
        delete options.appArgs;
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities[0]).toEqual({
          browserName: 'chrome',
          browserVersion: '116.0.5845.190',
          'goog:chromeOptions': {
            args: ['--no-sandbox'],
            binary: 'workspace/my-test-app/dist/my-test-app',
            windowTypes: ['app', 'webview'],
          },
          'wdio:chromedriverOptions': {},
          'wdio:electronServiceOptions': {},
          'wdio:chromiumVersion': '116.0.5845.190',
          'wdio:electronVersion': '26.2.2',
          'wdio:enforceWebDriverClassic': true,
        });
      });

      it('should set the expected capabilities when the detected app path exists for a Forge dependency', async () => {
        delete options.appBinaryPath;
        (getBinaryPath as Mock).mockResolvedValueOnce({
          ok: true,
          value: {
            binaryPath: 'workspace/my-test-app/out/my-test-app',
            pathGeneration: {
              ok: true,
              value: {
                paths: ['workspace/my-test-app/out/my-test-app'],
              },
            },
            pathValidation: {
              ok: true,
              value: {
                validPath: 'workspace/my-test-app/out/my-test-app',
                attempts: [
                  {
                    path: 'workspace/my-test-app/out/my-test-app',
                    valid: true,
                  },
                ],
              },
            },
          },
        } as unknown as BinaryPathResult);
        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('config-formats', 'forge-dependency-inline-config'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities[0]).toEqual({
          browserName: 'chrome',
          browserVersion: '116.0.5845.190',
          'goog:chromeOptions': {
            args: [],
            binary: 'workspace/my-test-app/out/my-test-app',
            windowTypes: ['app', 'webview'],
          },
          'wdio:chromedriverOptions': {},
          'wdio:electronServiceOptions': {},
          'wdio:chromiumVersion': '116.0.5845.190',
          'wdio:electronVersion': '26.2.2',
          'wdio:enforceWebDriverClassic': true,
        });
      });

      it('should set the expected capabilities when the detected app path exists for an electron-builder dependency', async () => {
        delete options.appBinaryPath;
        (getBinaryPath as Mock).mockResolvedValueOnce({
          ok: true,
          value: {
            binaryPath: 'workspace/my-test-app/dist/my-test-app',
            pathGeneration: {
              ok: true,
              value: {
                paths: ['workspace/my-test-app/dist/my-test-app'],
              },
            },
            pathValidation: {
              ok: true,
              value: {
                validPath: 'workspace/my-test-app/dist/my-test-app',
                attempts: [
                  {
                    path: 'workspace/my-test-app/dist/my-test-app',
                    valid: true,
                  },
                ],
              },
            },
          },
        } as unknown as BinaryPathResult);
        (getAppBuildInfo as Mock).mockResolvedValueOnce({
          appName: 'my-test-app',
          isForge: false,
          config: {},
        });
        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('config-formats', 'builder-dependency-inline-config'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities[0]).toEqual({
          browserName: 'chrome',
          browserVersion: '116.0.5845.190',
          'goog:chromeOptions': {
            args: [],
            binary: 'workspace/my-test-app/dist/my-test-app',
            windowTypes: ['app', 'webview'],
          },
          'wdio:chromedriverOptions': {},
          'wdio:electronServiceOptions': {},
          'wdio:chromiumVersion': '116.0.5845.190',
          'wdio:electronVersion': '26.2.2',
          'wdio:enforceWebDriverClassic': true,
        });
      });

      it('should set the expected capabilities when setting appEntryPoint', async () => {
        delete options.appBinaryPath;
        options.appEntryPoint = 'path/to/main.bundle.js';
        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: getFixtureDir('package-scenarios', 'no-build-tool'),
          } as Options.Testrunner,
        );
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities[0]).toEqual({
          browserName: 'chrome',
          browserVersion: '116.0.5845.190',
          'goog:chromeOptions': {
            args: ['--app=path/to/main.bundle.js'],
            binary: path.join(getFixtureDir('package-scenarios', 'no-build-tool'), 'node_modules', '.bin', 'electron'),
            windowTypes: ['app', 'webview'],
          },
          'wdio:chromedriverOptions': {},
          'wdio:electronServiceOptions': {},
          'wdio:chromiumVersion': '116.0.5845.190',
          'wdio:electronVersion': '26.2.2',
          'wdio:enforceWebDriverClassic': true,
        });
      });

      it('should use readPackageUp result for electron binary path with appEntryPoint instead of rootDir', async () => {
        const mockPackage = {
          packageJson: {
            dependencies: { electron: '^26.0.0' },
            devDependencies: {},
            name: 'test-package',
            version: '1.0.0',
          },
          path: '/different/path/to/package.json',
        };

        readPackageUp.mockResolvedValue(mockPackage);

        delete options.appBinaryPath;
        options.appEntryPoint = 'path/to/main.bundle.js';

        instance = new LaunchService(
          options,
          [] as never,
          {
            services: [['electron', options]],
            rootDir: '/completely/different/root/dir',
          } as Options.Testrunner,
        );

        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
          },
        ];

        await instance?.onPrepare({} as never, capabilities);

        expect(capabilities[0]['goog:chromeOptions']?.binary).toBe(
          path.join(
            '/different/path/to',
            'node_modules',
            '.bin',
            process.platform === 'win32' ? 'electron.CMD' : 'electron',
          ),
        );
      });

      it('should set the expected capabilities when setting custom chromedriverOptions', async () => {
        const capabilities: WebdriverIO.Capabilities[] = [
          {
            browserName: 'electron',
            browserVersion: '26.2.2',
            'wdio:chromedriverOptions': {
              binary: '/path/to/chromedriver',
            },
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities[0]).toEqual({
          browserName: 'chrome',
          browserVersion: '116.0.5845.190',
          'wdio:chromedriverOptions': {
            binary: '/path/to/chromedriver',
          },
          'goog:chromeOptions': {
            binary: 'workspace/my-test-app/dist/my-test-app',
            windowTypes: ['app', 'webview'],
            args: [],
          },
          'wdio:chromiumVersion': '116.0.5845.190',
          'wdio:electronVersion': '26.2.2',
          'wdio:enforceWebDriverClassic': true,
          'wdio:electronServiceOptions': {},
        });
      });

      it('should set the expected capabilities when W3C-specific', async () => {
        const capabilities: Capabilities.W3CCapabilities[] = [
          {
            firstMatch: [],
            alwaysMatch: {
              browserName: 'electron',
              browserVersion: '26.2.2',
            },
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities[0]).toEqual({
          firstMatch: [],
          alwaysMatch: {
            browserName: 'chrome',
            browserVersion: '116.0.5845.190',
            'goog:chromeOptions': {
              binary: 'workspace/my-test-app/dist/my-test-app',
              windowTypes: ['app', 'webview'],
              args: [],
            },
            'wdio:chromedriverOptions': {},
            'wdio:chromiumVersion': '116.0.5845.190',
            'wdio:electronVersion': '26.2.2',
            'wdio:enforceWebDriverClassic': true,
            'wdio:electronServiceOptions': {},
          },
        });
      });

      it('should set the expected capabilities when multiremote', async () => {
        const capabilities = {
          firefox: {
            capabilities: {
              browserName: 'firefox',
            },
          },
          myElectronProject: {
            capabilities: {
              browserName: 'electron',
              browserVersion: '32.0.1',
            },
          },
          chrome: {
            capabilities: {
              browserName: 'chrome',
            },
          },
          myOtherElectronProject: {
            capabilities: {
              firstMatch: [],
              alwaysMatch: {
                browserName: 'electron',
                browserVersion: '26.2.2',
              },
            },
          },
        };
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities).toEqual({
          firefox: {
            capabilities: {
              browserName: 'firefox',
            },
          },
          myElectronProject: {
            capabilities: {
              browserName: 'chrome',
              browserVersion: '128.0.6613.36',
              'goog:chromeOptions': {
                binary: 'workspace/my-test-app/dist/my-test-app',
                windowTypes: ['app', 'webview'],
                args: [],
              },
              'wdio:chromedriverOptions': {},
              'wdio:chromiumVersion': '128.0.6613.36',
              'wdio:electronVersion': '32.0.1',
              'wdio:enforceWebDriverClassic': true,
              'wdio:electronServiceOptions': {},
            },
          },
          chrome: {
            capabilities: {
              browserName: 'chrome',
            },
          },
          myOtherElectronProject: {
            capabilities: {
              firstMatch: [],
              alwaysMatch: {
                browserName: 'chrome',
                browserVersion: '116.0.5845.190',
                'goog:chromeOptions': {
                  binary: 'workspace/my-test-app/dist/my-test-app',
                  windowTypes: ['app', 'webview'],
                  args: [],
                },
                'wdio:chromedriverOptions': {},
                'wdio:chromiumVersion': '116.0.5845.190',
                'wdio:electronVersion': '26.2.2',
                'wdio:enforceWebDriverClassic': true,
                'wdio:electronServiceOptions': {},
              },
            },
          },
        });
      });

      it('should set the expected capabilities when parallel multiremote', async () => {
        const capabilities: Capabilities.RequestedMultiremoteCapabilities[] = [
          {
            firefox: {
              capabilities: {
                browserName: 'firefox',
              },
            },
            myElectronProject: {
              capabilities: {
                browserName: 'electron',
                browserVersion: '32.0.1',
              },
            },
          },
          {
            chrome: {
              capabilities: {
                browserName: 'chrome',
              },
            },
            myOtherElectronProject: {
              capabilities: {
                firstMatch: [],
                alwaysMatch: {
                  browserName: 'electron',
                  browserVersion: '26.2.2',
                },
              },
            },
          },
        ];
        await instance?.onPrepare({} as never, capabilities);
        expect(capabilities).toEqual([
          {
            firefox: {
              capabilities: {
                browserName: 'firefox',
              },
            },
            myElectronProject: {
              capabilities: {
                browserName: 'chrome',
                browserVersion: '128.0.6613.36',
                'goog:chromeOptions': {
                  binary: 'workspace/my-test-app/dist/my-test-app',
                  windowTypes: ['app', 'webview'],
                  args: [],
                },
                'wdio:chromedriverOptions': {},
                'wdio:chromiumVersion': '128.0.6613.36',
                'wdio:electronVersion': '32.0.1',
                'wdio:enforceWebDriverClassic': true,
                'wdio:electronServiceOptions': {},
              },
            },
          },
          {
            chrome: {
              capabilities: {
                browserName: 'chrome',
              },
            },
            myOtherElectronProject: {
              capabilities: {
                firstMatch: [],
                alwaysMatch: {
                  browserName: 'chrome',
                  browserVersion: '116.0.5845.190',
                  'goog:chromeOptions': {
                    binary: 'workspace/my-test-app/dist/my-test-app',
                    windowTypes: ['app', 'webview'],
                    args: [],
                  },
                  'wdio:chromedriverOptions': {},
                  'wdio:chromiumVersion': '116.0.5845.190',
                  'wdio:electronVersion': '26.2.2',
                  'wdio:enforceWebDriverClassic': true,
                  'wdio:electronServiceOptions': {},
                },
              },
            },
          },
        ]);
      });
    });
  });
  describe('onWorkerStart', () => {
    let counter = 0;

    beforeEach(() => {
      counter = 0;
      (getPort as Mock).mockImplementation(() => {
        return 50000 + counter++;
      });
    });

    const baseCapability = {
      browserName: 'chrome',
      browserVersion: '116.0.5845.190',
      'goog:chromeOptions': {
        args: ['foo=bar'],
        binary: 'workspace/my-test-app/out/my-test-app',
        windowTypes: ['app', 'webview'],
      },
      'wdio:electronServiceOptions': {},
      'wdio:chromiumVersion': '116.0.5845.190',
      'wdio:enforceWebDriverClassic': true,
    };

    describe('Standard', () => {
      it('should apply `--inspect` to the args of `goog:chromeOptions`', async () => {
        instance = new ElectronLaunchService({}, {}, {});
        const capabilities = baseCapability;
        const expectedCaps = structuredClone(capabilities);
        expectedCaps['goog:chromeOptions'].args.push('--inspect=localhost:50000');

        await instance?.onWorkerStart('0', capabilities);
        expect(capabilities).toStrictEqual(expectedCaps);
      });

      it('should apply `--inspect` if `goog:chromeOptions` is not set to capability', async () => {
        instance = new ElectronLaunchService({}, {}, {});
        const capabilities = {
          browserName: 'chrome',
          browserVersion: '116.0.5845.190',
          'wdio:electronServiceOptions': {},
          'wdio:chromiumVersion': '116.0.5845.190',
          'wdio:enforceWebDriverClassic': true,
        };
        const expectedCaps = Object.assign({}, capabilities, {
          'goog:chromeOptions': {
            args: ['--inspect=localhost:50000'],
          },
        });
        await instance?.onWorkerStart('0', capabilities);
        expect(capabilities).toStrictEqual(expectedCaps);
      });

      it('should apply `--inspect` if `args` is not set to `goog:chromeOptions`', async () => {
        instance = new ElectronLaunchService({}, {}, {});
        const capabilities = {
          browserName: 'chrome',
          browserVersion: '116.0.5845.190',
          'goog:chromeOptions': {
            binary: 'workspace/my-test-app/out/my-test-app',
            windowTypes: ['app', 'webview'],
          },
          'wdio:electronServiceOptions': {},
          'wdio:chromiumVersion': '116.0.5845.190',
          'wdio:enforceWebDriverClassic': true,
        };
        const expectedCaps = Object.assign({}, capabilities, {
          'goog:chromeOptions': {
            args: ['--inspect=localhost:50000'],
            binary: 'workspace/my-test-app/out/my-test-app',
            windowTypes: ['app', 'webview'],
          },
        });
        await instance?.onWorkerStart('0', capabilities);
        expect(capabilities).toStrictEqual(expectedCaps);
      });

      it('should throw error when error occurred', async () => {
        instance = new ElectronLaunchService({}, {}, {});
        (getPort as Mock).mockRejectedValue('Some error');
        await expect(() => instance?.onWorkerStart('0', baseCapability)).rejects.toThrowError();
      });
    });

    describe('W3C-specific', () => {
      it('should apply `--inspect` to the args of `goog:chromeOptions`', async () => {
        instance = new ElectronLaunchService({}, {}, {});
        const capabilities = [
          {
            firstMatch: [],
            alwaysMatch: {
              browserName: 'chrome',
              browserVersion: '116.0.5845.190',
              'goog:chromeOptions': {
                args: ['foo=bar'],
                binary: 'workspace/my-test-app/dist/my-test-app',
                windowTypes: ['app', 'webview'],
              },
              'wdio:electronServiceOptions': {},
              'wdio:enforceWebDriverClassic': true,
            },
          },
        ];
        const expectedCaps = structuredClone(capabilities);
        expectedCaps[0].alwaysMatch['goog:chromeOptions'].args.push('--inspect=localhost:50000');

        await instance?.onWorkerStart('0', capabilities as WebdriverIO.Capabilities);
        expect(capabilities).toStrictEqual(expectedCaps);
      });
    });

    describe('Multiremote', () => {
      it('should apply `--inspect` to the args of `goog:chromeOptions` for the electron', async () => {
        instance = new ElectronLaunchService({}, {}, {});
        const capabilities = {
          firefox: {
            capabilities: {
              browserName: 'firefox',
            },
          },
          myElectronProject: {
            capabilities: baseCapability,
          },
          chrome: {
            capabilities: {
              browserName: 'chrome',
            },
          },
          myOtherElectronProject: {
            capabilities: {
              firstMatch: [],
              alwaysMatch: baseCapability,
            },
          },
        };

        const expectedCaps = structuredClone(capabilities);
        expectedCaps.myElectronProject.capabilities['goog:chromeOptions'].args.push('--inspect=localhost:50000');
        expectedCaps.myOtherElectronProject.capabilities.alwaysMatch['goog:chromeOptions'].args.push(
          '--inspect=localhost:50001',
        );

        await instance?.onWorkerStart('0', capabilities as WebdriverIO.Capabilities);
        expect(capabilities).toStrictEqual(expectedCaps);
      });
    });
  });
});
