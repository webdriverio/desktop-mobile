import path from 'node:path';
import type {
  AppBuildInfo,
  BinaryPathResult,
  BuilderArch,
  BuilderBuildInfo,
  ForgeBuildInfo,
  PathGenerationError,
  PathGenerationResult,
  PathValidationResult,
} from '@wdio/native-types';
import { validateBinaryPaths } from '@wdio/native-utils';
import { SUPPORTED_BUILD_TOOL, SUPPORTED_PLATFORM } from './constants.js';

type SupportedPlatform = keyof typeof SUPPORTED_PLATFORM;
type SupportedBuildTool = keyof typeof SUPPORTED_BUILD_TOOL;

interface BinaryOptions {
  buildTool: SupportedBuildTool;
  platform: SupportedPlatform;
  appName: string;
  config: ForgeBuildInfo['config'] | BuilderBuildInfo['config'];
  projectDir: string;
  hostArch?: string;
}

function sanitizeAppNameForPath(appName: string, platform: SupportedPlatform): string {
  // Linux does not support spaces in paths, so we convert the app name to kebab-case before using it
  return platform === 'linux' ? appName.toLowerCase().replace(/ /g, '-') : appName;
}

// Every arch searched on each platform, in the order tried after the ones the host runs
const ARCHS: Record<SupportedPlatform, BuilderArch[]> = {
  darwin: ['universal', 'arm64', 'x64'],
  linux: ['x64', 'arm64', 'armv7l'],
  win32: ['x64', 'arm64', 'ia32'],
};

// The archs a host runs besides its own, emulated or in 32-bit mode
const ALSO_RUNS: Record<SupportedPlatform, Partial<Record<BuilderArch, BuilderArch[]>>> = {
  darwin: { arm64: ['universal', 'x64'], x64: ['universal'] },
  linux: { arm64: ['armv7l'] },
  win32: { arm64: ['x64', 'ia32'], x64: ['ia32'] },
};

// process.arch and electron-builder's defaultArch can both spell armv7l as `arm`
function toArch(name?: string): BuilderArch | undefined {
  const arch = name === 'arm' ? 'armv7l' : name;
  return arch === 'x64' || arch === 'arm64' || arch === 'ia32' || arch === 'armv7l' || arch === 'universal'
    ? arch
    : undefined;
}

// The first folder holding the app wins, so search the builds the host can run before the rest
function getArchOrder(platform: SupportedPlatform, hostArch?: string): BuilderArch[] {
  const host = toArch(hostArch);
  const runnable = host && ARCHS[platform].includes(host) ? [host, ...(ALSO_RUNS[platform][host] ?? [])] : [];
  return [...new Set([...runnable, ...ARCHS[platform]])];
}

function getForgeDistDir(
  config: ForgeBuildInfo['config'],
  appName: string,
  platform: SupportedPlatform,
  archs: BuilderArch[],
): string[] {
  const forgeOutDir = config?.outDir || 'out';

  // Forge may create directories with different naming conventions depending on the platform
  // We need to check both the original name and sanitized versions
  const possibleNames = [
    appName, // Original name (e.g., "Forge App Example")
    sanitizeAppNameForPath(appName, platform), // Sanitized for platform (e.g., "forge-app-example" on Linux)
  ];

  // Remove duplicates in case sanitization doesn't change the name
  const uniqueNames = [...new Set(possibleNames)];

  return archs.flatMap((arch) => uniqueNames.map((name) => path.join(forgeOutDir, `${name}-${platform}-${arch}`)));
}

const BUILDER_PLATFORM_KEY = { darwin: 'mac', linux: 'linux', win32: 'win' } as const;

function getBuilderDistDir(
  config: BuilderBuildInfo['config'],
  platform: SupportedPlatform,
  archs: BuilderArch[],
): string[] {
  const builderOutDirName = config?.directories?.output || 'dist';
  const key = BUILDER_PLATFORM_KEY[platform];
  // electron-builder adds the arch to every folder name but the platform's defaultArch
  const defaultArch = toArch(config?.[key]?.defaultArch) ?? 'x64';
  const unpacked = platform === 'darwin' ? '' : '-unpacked';
  return archs.map((arch) =>
    path.join(builderOutDirName, `${key}${arch === defaultArch ? '' : `-${arch}`}${unpacked}`),
  );
}

function getPlatformBinaryPath(
  outDir: string,
  binaryName: string,
  platform: SupportedPlatform,
  options: BinaryOptions,
): string {
  const getExecutableName = (): string => {
    if (
      options.buildTool === SUPPORTED_BUILD_TOOL.builder &&
      (options.config as BuilderBuildInfo['config']).executableName
    ) {
      return (options.config as BuilderBuildInfo['config']).executableName || binaryName;
    }
    return binaryName;
  };

  const binaryPathMap = {
    darwin: () => {
      const executableName = getExecutableName();
      let appBundleName: string;

      if (options.buildTool === SUPPORTED_BUILD_TOOL.forge) {
        // For Forge: use packagerConfig.name for .app bundle, executableName for binary
        const forgeConfig = options.config as ForgeBuildInfo['config'];
        const appDisplayName = forgeConfig.packagerConfig?.name || binaryName;
        appBundleName = `${appDisplayName}.app`;
      } else {
        // For electron-builder: use executableName for .app bundle
        appBundleName = `${executableName}.app`;
      }

      return path.join(appBundleName, 'Contents', 'MacOS', executableName);
    },
    linux: () => sanitizeAppNameForPath(getExecutableName(), platform),
    win32: () => `${getExecutableName()}.exe`,
  };
  return path.join(outDir, binaryPathMap[platform]());
}

function getBinaryName(options: BinaryOptions): string {
  const { buildTool, config, appName } = options;

  if (buildTool === SUPPORTED_BUILD_TOOL.forge) {
    return (config as ForgeBuildInfo['config']).packagerConfig?.executableName || appName;
  }

  // For electron-builder, we use productName for the app bundle name
  return appName;
}

function getOutDir(options: BinaryOptions): string[] {
  const { buildTool, config, appName, platform, projectDir, hostArch } = options;
  const archs = getArchOrder(platform, hostArch);

  const outDirs =
    buildTool === SUPPORTED_BUILD_TOOL.forge
      ? getForgeDistDir(config as ForgeBuildInfo['config'], appName, platform, archs)
      : getBuilderDistDir(config as BuilderBuildInfo['config'], platform, archs);

  return outDirs.map((dir) => path.join(projectDir, dir));
}

/**
 * Generate possible binary paths for the Electron application
 * Phase 1: Path Generation
 */
export function generateBinaryPaths(
  packageJsonPath: string,
  appBuildInfo: AppBuildInfo,
  p = process,
): PathGenerationResult {
  const errors: PathGenerationError[] = [];
  let paths: string[] = [];

  try {
    // Platform validation
    if (!isSupportedPlatform(p.platform)) {
      return {
        ok: false,
        error: {
          errors: [
            {
              type: 'UNSUPPORTED_PLATFORM',
              message: `Unsupported platform: ${p.platform}`,
            },
          ],
        },
      };
    }

    // Build tool validation
    if (!appBuildInfo.isForge && !appBuildInfo.isBuilder) {
      return {
        ok: false,
        error: {
          errors: [
            {
              type: 'NO_BUILD_TOOL',
              message: 'Configurations that are neither Forge nor Builder are not supported.',
            },
          ],
        },
      };
    }

    // Generate paths based on build tool configuration
    const options: BinaryOptions = {
      buildTool: appBuildInfo.isForge ? SUPPORTED_BUILD_TOOL.forge : SUPPORTED_BUILD_TOOL.builder,
      platform: p.platform,
      appName: appBuildInfo.appName,
      config: appBuildInfo.config,
      projectDir: path.dirname(packageJsonPath),
      hostArch: p.arch,
    };

    try {
      const outDirs = getOutDir(options);
      const binaryName = getBinaryName(options);
      paths = outDirs.map((dir) => getPlatformBinaryPath(dir, binaryName, options.platform, options));

      // Add warning if configuration seems incomplete
      if (appBuildInfo.isBuilder && !appBuildInfo.config?.directories?.output) {
        errors.push({
          type: 'CONFIG_WARNING',
          message:
            'Using default output directory "dist" - consider specifying directories.output in electron-builder config',
          buildTool: 'electron-builder',
          details: 'Missing directories.output field in configuration',
        });
      }

      if (appBuildInfo.isForge && !appBuildInfo.config?.outDir) {
        errors.push({
          type: 'CONFIG_WARNING',
          message: 'Using default output directory "out" - consider specifying outDir in Forge config',
          buildTool: 'electron-forge',
          details: 'Missing outDir field in configuration',
        });
      }
    } catch (error) {
      const buildTool = appBuildInfo.isForge ? 'electron-forge' : 'electron-builder';
      return {
        ok: false,
        error: {
          errors: [
            {
              type: 'CONFIG_INVALID',
              message: `Failed to generate binary paths from ${buildTool} configuration: ${(error as Error).message}`,
              buildTool,
              details: (error as Error).stack,
            },
          ],
        },
      };
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        errors: [
          {
            type: 'CONFIG_INVALID',
            message: `Unexpected error during path generation: ${(error as Error).message}`,
            details: (error as Error).stack,
          },
        ],
      },
    };
  }

  if (paths.length === 0) {
    return {
      ok: false,
      error: {
        errors: errors.length > 0 ? errors : [{ type: 'CONFIG_INVALID', message: 'No paths generated' }],
      },
    };
  }

  const result: { paths: string[]; warnings?: PathGenerationError[] } = { paths };
  if (errors.length > 0) {
    result.warnings = errors;
  }

  return {
    ok: true,
    value: result,
  };
}

/**
 * Determine the path to the Electron application binary using a two-phase approach
 * Returns detailed information about both path generation and validation
 * @param packageJsonPath path to the nearest package.json
 * @param appBuildInfo build information about the Electron application
 * @param _electronVersion unused; kept so `p` stays the fourth argument
 * @param p process object (used for testing purposes)
 * @returns detailed result with binary path and diagnostic information
 */
export async function getBinaryPath(
  packageJsonPath: string,
  appBuildInfo: AppBuildInfo,
  _electronVersion?: string,
  p = process,
): Promise<BinaryPathResult> {
  // Phase 1: Generate possible binary paths
  const pathGeneration = generateBinaryPaths(packageJsonPath, appBuildInfo, p);

  // Phase 2: Validate generated paths
  let pathValidation: PathValidationResult;

  if (!pathGeneration.ok || pathGeneration.value.paths.length === 0) {
    pathValidation = {
      ok: false,
      error: {
        attempts: [],
      },
    };
  } else {
    pathValidation = await validateBinaryPaths(pathGeneration.value.paths);
  }

  // Combine results - TypeScript needs explicit narrowing
  if (pathGeneration.ok && pathValidation.ok) {
    return {
      ok: true,
      value: {
        binaryPath: pathValidation.value.validPath,
        pathGeneration,
        pathValidation,
      },
    };
  }

  return {
    ok: false,
    error: {
      pathGeneration,
      pathValidation,
    },
  };
}

function isSupportedPlatform(p: NodeJS.Platform): p is SupportedPlatform {
  return p in SUPPORTED_PLATFORM;
}
