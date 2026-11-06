import fs from 'node:fs/promises';
import { normalize } from 'node:path';
import type { AppBuildInfo, BuilderConfig } from '@wdio/native-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBinaryPath } from '../src/binaryPath.js';

vi.mock('node:fs/promises', async (importActual) => {
  const actual = await importActual<typeof import('node:fs/promises')>();
  return {
    default: {
      ...actual,
      access: vi.fn(),
    },
  };
});

vi.mock('@wdio/native-utils', async (importActual) => {
  const actual = await importActual<typeof import('@wdio/native-utils')>();
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    })),
  };
});

const pkgJSONPath = '/path/to/package.json';
const winProcess = { platform: 'win32', arch: 'x64' } as NodeJS.Process;

// Mock the current process for testing different platforms and architectures
let currentProcess = { ...winProcess };

/**
 * Updates the mocked process with specified platform and architecture
 * @param platform - The operating system platform (e.g., 'win32', 'darwin', 'linux')
 * @param arch - The CPU architecture (e.g., 'x64', 'arm64')
 */
function mockProcess(platform: string, arch: string) {
  currentProcess = { platform, arch } as NodeJS.Process;
}

/**
 * Mocks the file system access to simulate executable binary paths
 * @param expectedPath - The expected binary path(s) that should be accessible
 */
function mockBinaryPath(expectedPath: string | string[]) {
  const target = Array.isArray(expectedPath) ? expectedPath.map((p) => normalize(p)) : [normalize(expectedPath)];
  vi.mocked(fs.access).mockImplementation(async (path, _mode?) => {
    if (target.includes(normalize(path.toString()))) {
      return Promise.resolve();
    } else {
      return Promise.reject('Not executable');
    }
  });
}

/**
 * Generates a mock AppBuildInfo object for testing
 * @param isForge - Whether the app is built with Electron Forge
 * @param isBuilder - Whether the app is built with electron-builder
 */
function generateAppBuildInfo(isForge: boolean, isBuilder: boolean) {
  return {
    appName: 'my-app',
    isForge,
    isBuilder,
    config: { productName: 'my-app' },
  } as AppBuildInfo;
}

type TestBinaryPathOptions = {
  platform: string;
  arch: string;
  binaryPath: string;
  isForge: boolean;
  configObj: {
    packagerConfig?: { name: string };
    outDir?: string;
    productName?: string;
    directories?: { output?: string };
  };
  testName?: string;
  skip?: boolean;
};

/**
 * Helper function to create parameterized tests for binary path resolution
 */
function testBinaryPath(options: TestBinaryPathOptions) {
  const { platform, arch, binaryPath, isForge, configObj, testName, skip } = options;
  const buildType = isForge ? 'Forge' : 'Builder';
  const hasCustomOutDir = configObj.outDir || configObj.directories?.output;
  const pkgJSONPath = '/path/to/package.json';

  // Create descriptive test title based on configuration
  const title =
    testName ||
    (hasCustomOutDir
      ? `should resolve binary path for ${buildType} build with custom output directory on ${platform}-${arch}`
      : `should resolve binary path for ${buildType} build on ${platform}-${arch}`);

  const testFn = skip ? it.skip : it;

  testFn(`${title}`, async () => {
    const currentProcess = { platform, arch } as NodeJS.Process;
    // Mock all possible paths for the current platform
    const allPossiblePaths = [] as string[];

    // For Forge builds, we need to mock all possible architecture paths
    if (isForge) {
      const appName = configObj.packagerConfig?.name || configObj.productName || 'my-app';

      // Builds exist for several archs, so the host arch decides which one resolves
      const archs = ['x64', 'armv7l', 'arm64'];
      const possibleNames = [appName];
      if (platform === 'linux') {
        possibleNames.push(appName.toLowerCase().replace(/ /g, '-'));
      }

      for (const arch of archs) {
        for (const name of possibleNames) {
          // Generate the correct path structure for each architecture
          const archPath = binaryPath.replace(`-${platform}-x64`, `-${platform}-${arch}`).replace(appName, name);
          if (!allPossiblePaths.includes(archPath)) {
            allPossiblePaths.push(archPath);
          }
        }
      }
    } else {
      // For non-Forge builds, just use the original path
      allPossiblePaths.push(binaryPath);
      if (platform === 'linux') {
        // For Linux, also mock the kebab-case version of the path
        const appName = configObj.packagerConfig?.name || configObj.productName || 'my-app';
        const kebabCaseName = appName.toLowerCase().replace(/ /g, '-');
        const kebabCasePath = binaryPath.replace(appName, kebabCaseName);
        allPossiblePaths.push(kebabCasePath);
      }
    }

    mockBinaryPath(allPossiblePaths);

    const result = await getBinaryPath(
      pkgJSONPath,
      {
        appName: configObj.packagerConfig?.name || configObj.productName || 'my-app',
        isForge: isForge,
        isBuilder: !isForge,
        config: configObj,
      } as AppBuildInfo,
      currentProcess,
    );

    // Verify the result is successful
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.binaryPath).toBeDefined();

    // Normalize path separators for cross-platform compatibility
    const normalizedActual = result.value.binaryPath.replace(/\\/g, '/');
    const normalizedExpected = binaryPath.replace(/\\/g, '/');

    expect(normalizedActual).toBe(normalizedExpected);
  });
}

/**
 * Helper function to create tests specifically for Electron Forge builds
 */
function testForgeBinaryPath(options: Omit<TestBinaryPathOptions, 'isForge'>) {
  testBinaryPath(Object.assign(options, { isForge: true }));
}

/**
 * Helper function to create tests specifically for electron-builder builds
 */
function testBuilderBinaryPath(options: Omit<TestBinaryPathOptions, 'isForge'>) {
  testBinaryPath(Object.assign(options, { isForge: false }));
}

const appPath = (platform: string, dir: string) =>
  platform === 'darwin'
    ? `/path/to/${dir}/my-app.app/Contents/MacOS/my-app`
    : `/path/to/${dir}/my-app${platform === 'win32' ? '.exe' : ''}`;
const inDist = (dir: string) => `dist/${dir}`;
const builderInfo = (config: BuilderConfig = {}) =>
  ({
    appName: 'my-app',
    isForge: false,
    isBuilder: true,
    config: { productName: 'my-app', ...config },
  }) as AppBuildInfo;
const forgeInfo = {
  appName: 'my-app',
  isForge: true,
  isBuilder: false,
  config: { packagerConfig: { name: 'my-app' } },
} as AppBuildInfo;

async function resolveFrom(platform: string, arch: string | undefined, appBuildInfo: AppBuildInfo, dirs: string[]) {
  mockBinaryPath(dirs.map((dir) => appPath(platform, dir)));
  const result = await getBinaryPath(pkgJSONPath, appBuildInfo, { platform, arch } as NodeJS.Process);
  return result.ok ? result.value.binaryPath.replace(/\\/g, '/') : undefined;
}

// The warning the service gives when it found no build the host can run
async function hostWarningFrom(platform: string, arch: string, appBuildInfo: AppBuildInfo, dirs: string[]) {
  mockBinaryPath(dirs.map((dir) => appPath(platform, dir)));
  const result = await getBinaryPath(pkgJSONPath, appBuildInfo, { platform, arch } as NodeJS.Process);
  const warnings =
    result.ok && result.value.pathGeneration.ok ? (result.value.pathGeneration.value.warnings ?? []) : [];
  return warnings.find(({ message }) => message.startsWith('No '))?.message;
}

describe('getBinaryPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return error result for unsupported platform', async () => {
    mockProcess('not-supported', 'x86');
    mockBinaryPath('/path/to');

    const result = await getBinaryPath(pkgJSONPath, generateAppBuildInfo(false, true), currentProcess);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.pathGeneration.ok).toBe(false);
    if (result.error.pathGeneration.ok) {
      return;
    }
    expect(result.error.pathGeneration.error?.errors).toContainEqual({
      type: 'UNSUPPORTED_PLATFORM',
      message: 'Unsupported platform: not-supported',
    });
  });

  it('should return error result for unsupported build tool configuration', async () => {
    mockProcess('linux', 'arm64');
    mockBinaryPath('/path/to');

    const result = await getBinaryPath(pkgJSONPath, generateAppBuildInfo(false, false), currentProcess);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.pathGeneration.ok).toBe(false);
    if (result.error.pathGeneration.ok) {
      return;
    }
    expect(result.error.pathGeneration.error?.errors).toContainEqual({
      type: 'NO_BUILD_TOOL',
      message: 'Configurations that are neither Forge nor Builder are not supported.',
    });
  });

  describe('Electron Forge builds', () => {
    testForgeBinaryPath({
      platform: 'win32',
      arch: 'x64',
      binaryPath: '/path/to/out/my-app-win32-x64/my-app.exe',
      configObj: { packagerConfig: { name: 'my-app' } },
    });

    testForgeBinaryPath({
      platform: 'win32',
      arch: 'x64',
      binaryPath: '/path/to/custom-outdir/my-app-win32-x64/my-app.exe',
      configObj: { packagerConfig: { name: 'my-app' }, outDir: 'custom-outdir' },
    });

    testForgeBinaryPath({
      platform: 'darwin',
      arch: 'arm64',
      binaryPath: '/path/to/out/my-app-darwin-arm64/my-app.app/Contents/MacOS/my-app',
      configObj: { packagerConfig: { name: 'my-app' } },
    });

    testForgeBinaryPath({
      platform: 'darwin',
      arch: 'x64',
      binaryPath: '/path/to/out/my-app-darwin-x64/my-app.app/Contents/MacOS/my-app',
      configObj: { packagerConfig: { name: 'my-app' } },
    });

    testForgeBinaryPath({
      platform: 'linux',
      arch: 'x64',
      binaryPath: '/path/to/out/my-app-linux-x64/my-app',
      configObj: { packagerConfig: { name: 'my-app' } },
    });

    testForgeBinaryPath({
      platform: 'linux',
      arch: 'x64',
      testName: 'should resolve binary path for Forge build with spaces in the name on linux-x64',
      binaryPath: '/path/to/out/builder-app-example-linux-x64/builder-app-example',
      configObj: { packagerConfig: { name: 'Builder App Example' } },
    });

    it.each<[string, string, string[], string]>([
      ['darwin', 'arm64', ['x64', 'arm64'], 'arm64'],
      ['darwin', 'x64', ['arm64', 'universal', 'x64'], 'x64'],
      ['linux', 'arm64', ['x64', 'arm64'], 'arm64'],
      ['win32', 'x64', ['ia32', 'x64'], 'x64'],
      ['win32', 'x64', ['arm64', 'ia32'], 'ia32'],
      ['win32', 'arm64', ['ia32', 'x64', 'arm64'], 'arm64'],
    ])('should resolve %s on a %s host with %j builds to %s', async (platform, arch, archs, expected) => {
      const inOut = (buildArch: string) => `out/my-app-${platform}-${buildArch}`;

      const binaryPath = await resolveFrom(platform, arch, forgeInfo, archs.map(inOut));

      expect(binaryPath).toBe(appPath(platform, inOut(expected)));
    });
  });

  describe('electron-builder builds', () => {
    // Test all supported macOS architectures
    testBuilderBinaryPath({
      platform: 'darwin',
      arch: 'arm64',
      binaryPath: '/path/to/dist/mac-arm64/my-app.app/Contents/MacOS/my-app',
      configObj: { productName: 'my-app' },
    });

    testBuilderBinaryPath({
      platform: 'darwin',
      arch: 'x64',
      binaryPath: '/path/to/dist/mac/my-app.app/Contents/MacOS/my-app',
      configObj: { productName: 'my-app' },
    });

    testBuilderBinaryPath({
      platform: 'darwin',
      arch: 'arm64',
      testName: 'should resolve a universal Builder build with custom output directory on darwin-arm64',
      binaryPath: '/path/to/dist-electron/mac-universal/my-app.app/Contents/MacOS/my-app',
      configObj: {
        productName: 'my-app',
        directories: { output: 'dist-electron' },
      },
    });

    // Test custom output directory configuration
    testBuilderBinaryPath({
      platform: 'darwin',
      arch: 'arm64',
      binaryPath: '/path/to/dist/custom/mac/my-app.app/Contents/MacOS/my-app',
      configObj: { productName: 'my-app', directories: { output: 'dist/custom' } },
    });

    testBuilderBinaryPath({
      platform: 'linux',
      arch: 'x64',
      binaryPath: '/path/to/dist/linux-unpacked/my-app',
      configObj: { productName: 'my-app' },
    });

    testBuilderBinaryPath({
      platform: 'linux',
      arch: 'x64',
      testName: 'should resolve binary path for Builder build with spaces in the name on linux-x64',
      binaryPath: '/path/to/dist/linux-unpacked/builder-app-example',
      configObj: { productName: 'Builder App Example' },
    });

    testBuilderBinaryPath({
      platform: 'linux',
      arch: 'arm64',
      binaryPath: '/path/to/dist/linux-arm64-unpacked/my-app',
      configObj: { productName: 'my-app' },
    });

    testBuilderBinaryPath({
      platform: 'darwin',
      arch: 'arm64',
      testName: 'should resolve binary path for Builder build with executableName on darwin-arm64',
      binaryPath: '/path/to/dist/mac-arm64/builder-app-example.app/Contents/MacOS/builder-app-example',
      configObj: {
        productName: 'Builder App Example',
        executableName: 'builder-app-example',
      } as any,
    });

    testBuilderBinaryPath({
      platform: 'win32',
      arch: 'x64',
      testName: 'should resolve binary path for Builder build with executableName on win32-x64',
      binaryPath: '/path/to/dist/win-unpacked/builder-app-example.exe',
      configObj: {
        productName: 'Builder App Example',
        executableName: 'builder-app-example',
      } as any,
    });

    testBuilderBinaryPath({
      platform: 'win32',
      arch: 'arm64',
      binaryPath: '/path/to/dist/win-arm64-unpacked/my-app.exe',
      configObj: { productName: 'my-app' },
    });

    testBuilderBinaryPath({
      platform: 'win32',
      arch: 'ia32',
      binaryPath: '/path/to/dist/win-ia32-unpacked/my-app.exe',
      configObj: { productName: 'my-app' },
    });

    it.each<[string, string | undefined, string[], string]>([
      ['win32', undefined, ['win-arm64-unpacked', 'win-unpacked'], 'win-unpacked'],
      ['win32', 'x64', ['win-arm64-unpacked', 'win-unpacked'], 'win-unpacked'],
      ['win32', 'x64', ['win-arm64-unpacked', 'win-ia32-unpacked'], 'win-ia32-unpacked'],
      ['win32', 'arm64', ['win-unpacked', 'win-arm64-unpacked'], 'win-arm64-unpacked'],
      ['win32', 'arm64', ['win-ia32-unpacked', 'win-unpacked'], 'win-unpacked'],
      ['win32', 'ia32', ['win-unpacked', 'win-ia32-unpacked'], 'win-ia32-unpacked'],
      ['linux', undefined, ['linux-arm64-unpacked', 'linux-unpacked'], 'linux-unpacked'],
      ['linux', 'x64', ['linux-arm64-unpacked', 'linux-unpacked'], 'linux-unpacked'],
      ['linux', 'arm64', ['linux-unpacked', 'linux-arm64-unpacked'], 'linux-arm64-unpacked'],
      ['linux', 'arm64', ['linux-armv7l-unpacked', 'linux-unpacked'], 'linux-unpacked'],
      ['linux', 'arm', ['linux-unpacked', 'linux-armv7l-unpacked'], 'linux-armv7l-unpacked'],
      ['linux', 'ppc64', ['linux-arm64-unpacked', 'linux-unpacked'], 'linux-unpacked'],
      ['darwin', 'x64', ['mac-arm64', 'mac'], 'mac'],
      ['darwin', 'x64', ['mac-arm64', 'mac-universal'], 'mac-universal'],
      ['darwin', 'arm64', ['mac', 'mac-arm64'], 'mac-arm64'],
      ['darwin', 'arm64', ['mac-universal', 'mac-arm64'], 'mac-arm64'],
      ['darwin', 'arm64', ['mac', 'mac-universal'], 'mac-universal'],
      ['darwin', undefined, ['mac', 'mac-arm64', 'mac-universal'], 'mac-universal'],
    ])('should resolve %s on a %s host with %j to %s', async (platform, arch, dirs, expected) => {
      const binaryPath = await resolveFrom(platform, arch, builderInfo(), dirs.map(inDist));

      expect(binaryPath).toBe(appPath(platform, inDist(expected)));
    });

    it.each<[string, string, BuilderConfig, string[], string]>([
      ['win32', 'x64', { win: { defaultArch: 'arm64' } }, ['win-unpacked', 'win-x64-unpacked'], 'win-x64-unpacked'],
      ['win32', 'arm64', { win: { defaultArch: 'arm64' } }, ['win-x64-unpacked', 'win-unpacked'], 'win-unpacked'],
      ['darwin', 'x64', { mac: { defaultArch: 'universal' } }, ['mac', 'mac-x64'], 'mac-x64'],
      [
        'linux',
        'x64',
        { linux: { defaultArch: 'arm' } },
        ['linux-unpacked', 'linux-x64-unpacked'],
        'linux-x64-unpacked',
      ],
      ['linux', 'x64', { win: { defaultArch: 'arm64' } }, ['linux-arm64-unpacked', 'linux-unpacked'], 'linux-unpacked'],
    ])('should resolve %s on a %s host with %j and %j to %s', async (platform, arch, config, dirs, expected) => {
      const binaryPath = await resolveFrom(platform, arch, builderInfo(config), dirs.map(inDist));

      expect(binaryPath).toBe(appPath(platform, inDist(expected)));
    });
  });

  describe('when no build the host runs exists', () => {
    it.each<[string, string, string, AppBuildInfo, string]>([
      ['darwin', 'x64', 'dist/mac-arm64', builderInfo(), 'arm64'],
      ['linux', 'arm64', 'dist/linux-unpacked', builderInfo(), 'x64'],
      ['win32', 'x64', 'dist/win-unpacked', builderInfo({ win: { defaultArch: 'arm64' } }), 'arm64'],
      ['darwin', 'x64', 'out/my-app-darwin-arm64', forgeInfo, 'arm64'],
    ])('should warn on a %s %s host when only %s exists', async (platform, arch, dir, appBuildInfo, buildArch) => {
      expect(await resolveFrom(platform, arch, appBuildInfo, [dir])).toBe(appPath(platform, dir));
      expect(await hostWarningFrom(platform, arch, appBuildInfo, [dir])).toContain(
        `No ${arch} build of the app was found, so the service is using the ${buildArch} build`,
      );
    });

    it.each<[string, string, string]>([
      ['darwin', 'arm64', 'dist/mac'],
      ['win32', 'arm64', 'dist/win-unpacked'],
      ['win32', 'x64', 'dist/win-ia32-unpacked'],
      ['linux', 'x64', 'dist/linux-unpacked'],
      ['linux', 'ppc64', 'dist/linux-unpacked'],
    ])('should not warn on a %s %s host when only %s exists', async (platform, arch, dir) => {
      expect(await resolveFrom(platform, arch, builderInfo(), [dir])).toBe(appPath(platform, dir));
      expect(await hostWarningFrom(platform, arch, builderInfo(), [dir])).toBeUndefined();
    });
  });
});
