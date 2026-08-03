import { nonChromeBrowserNameError, probeDevServerReachable, startManagedDevServer } from '@wdio/native-core';
import type {
  AppBuildInfo,
  BinaryPathResult,
  ElectronServiceCapabilities,
  ElectronServiceGlobalOptions,
  PathGenerationError,
} from '@wdio/native-types';
import {
  createLogger,
  formatDiagnosticResults,
  isErr,
  type NormalizedReadResult,
  readPackageUp,
} from '@wdio/native-utils';
import { getAppBuildInfo } from './appBuildInfo.js';
import { getBinaryPath } from './binaryPath.js';
import { getElectronVersion } from './electronVersion.js';

const log = createLogger('electron-service', 'launcher');

import type { Capabilities, Options, Services } from '@wdio/types';
import getPort from 'get-port';
import { SevereServiceError } from 'webdriverio';
import { applyApparmorWorkaround } from './apparmor.js';
import {
  getChromedriverOptions,
  getChromeOptions,
  getConvertedElectronCapabilities,
  getElectronCapabilities,
} from './capabilities.js';
import {
  CHROMIUM_VERSION_NOT_FOUND_ERROR,
  CUSTOM_CAPABILITY_NAME,
  ELECTRON_VERSION_NOT_FOUND_ERROR,
} from './constants.js';
import { diagnoseElectronEnvironment } from './diagnostics.js';
import { resolveAppPaths } from './pathResolver.js';
import { getChromiumVersion } from './versions.js';

/**
 * Generate a comprehensive error message based on the binary path detection result
 */
function generateBinaryPathErrorMessage(result: BinaryPathResult, appBuildInfo: AppBuildInfo): string {
  const buildToolName = appBuildInfo.isForge ? 'Electron Forge' : 'electron-builder';
  const suggestedCompileCommand = `npx ${appBuildInfo.isForge ? 'electron-forge make' : 'electron-builder build'}`;

  // Handle error case
  if (!result.ok) {
    const { pathGeneration, pathValidation } = result.error;

    // Path generation failed
    if (!pathGeneration.ok) {
      const generationErrors = pathGeneration.error.errors;
      const primaryError = generationErrors[0];

      switch (primaryError?.type) {
        case 'UNSUPPORTED_PLATFORM':
          return `Unsupported platform: ${process.platform}. This service only supports Windows, macOS, and Linux.`;

        case 'NO_BUILD_TOOL':
          return 'No supported build tool configuration found. Please configure either Electron Forge or electron-builder in your package.json.';

        case 'CONFIG_INVALID':
          return `Invalid ${buildToolName} configuration: ${primaryError.message}. Please check your build tool configuration.`;

        case 'CONFIG_MISSING':
          return `Missing ${buildToolName} configuration. Please ensure your build tool is properly configured in package.json.`;

        default:
          return `Failed to determine binary paths: ${primaryError?.message || 'Unknown error'}`;
      }
    }

    // Path generation succeeded but validation failed
    if (!pathValidation.ok) {
      const attempts = pathValidation.error.attempts;

      let errorDetails = `Checked ${attempts.length} possible location(s):`;

      for (const attempt of attempts) {
        errorDetails += `\n  - ${attempt.path}`;
        if (attempt.error) {
          switch (attempt.error.type) {
            case 'FILE_NOT_FOUND':
              errorDetails += ' (file not found)';
              break;
            case 'NOT_EXECUTABLE':
              errorDetails += ' (not executable)';
              break;
            case 'PERMISSION_DENIED':
              errorDetails += ' (permission denied)';
              break;
            case 'IS_DIRECTORY':
              errorDetails += ' (is a directory)';
              break;
            default:
              errorDetails += ` (${attempt.error.message})`;
          }
        }
      }

      return `Could not find Electron app built with ${buildToolName}!\n\n${errorDetails}\n\nIf the application is not compiled, please do so before running your tests:\n  ${suggestedCompileCommand}\n\nOtherwise if the application is compiled at a different location, please specify the \`appBinaryPath\` option in your capabilities.`;
    }
  }

  return 'Unknown error occurred while detecting binary path.';
}

export default class ElectronLaunchService implements Services.ServiceInstance {
  #globalOptions: ElectronServiceGlobalOptions;
  #projectRoot: string;
  #usedPorts = new Set<number>();
  #browserMode = false;
  // Teardown for a service-managed dev server (browser mode). Called from onComplete AND on an
  // onPrepare failure — WDIO does not call onComplete after onPrepare throws. Idempotent.
  #stopDevServer?: () => Promise<void>;

  constructor(globalOptions: ElectronServiceGlobalOptions, _caps: unknown, config: Options.Testrunner) {
    this.#globalOptions = globalOptions;
    this.#projectRoot = globalOptions.rootDir || config.rootDir || process.cwd();
  }

  async onComplete(): Promise<void> {
    // Tear down a service-managed dev server (browser mode). No-op otherwise; idempotent.
    await this.#stopDevServer?.();
    this.#stopDevServer = undefined;
  }

  async onPrepare(_config: Options.Testrunner, capabilities: ElectronServiceCapabilities) {
    const capsList = Array.isArray(capabilities)
      ? capabilities
      : Object.values(capabilities as Capabilities.RequestedMultiremoteCapabilities).map(
          (multiremoteOption) => (multiremoteOption as Capabilities.WithRequestedCapabilities).capabilities,
        );

    // Extract all Electron capabilities once — handles both standard and W3C alwaysMatch format
    const caps = capsList.flatMap((cap) => getElectronCapabilities(cap) as WebdriverIO.Capabilities);

    // Determine and validate run mode across all Electron capabilities
    const modes = caps.map((cap) => {
      const capOpts = ((cap as Record<string, unknown>)[CUSTOM_CAPABILITY_NAME] ?? {}) as ElectronServiceGlobalOptions;
      return capOpts.mode ?? this.#globalOptions.mode ?? 'native';
    });
    const uniqueModes = new Set(modes);
    if (uniqueModes.size > 1) {
      throw new SevereServiceError(
        `All Electron capabilities must use the same mode, but found mixed modes: ${[...uniqueModes].join(', ')}. ` +
          "Set mode consistently across all 'wdio:electronServiceOptions' entries.",
      );
    }
    const mode = modes[0] ?? 'native';

    if (mode === 'browser') {
      // Reject a non-chrome browserName on any cap before any network probe, so the actionable
      // misconfig error surfaces immediately rather than after a (up to 3s) dev-server probe.
      for (const cap of caps) {
        const browserNameError = nonChromeBrowserNameError(cap.browserName, ['chrome', 'electron']);
        if (browserNameError) {
          throw new SevereServiceError(browserNameError);
        }
      }
      // Everything from the dev-server start onward runs in one guard: any failure after the server
      // is up must stop it, because WDIO does not call onComplete after an onPrepare throw.
      try {
        // Auto-manage the dev server once for the run if requested; the managed readiness wait
        // supersedes the per-cap preflight below, and a devServer function may supply the URL. A
        // managed server serves one URL for every cap.
        let managedUrl: string | undefined;
        if (this.#globalOptions.devServer) {
          // Only a devServer *function* can supply the URL; a string/object form needs devServerUrl
          // as its readiness target. Require it up front so a missing one fails fast instead of
          // polling an empty URL for the whole readiness timeout.
          if (typeof this.#globalOptions.devServer !== 'function' && !this.#globalOptions.devServerUrl) {
            throw new SevereServiceError(
              'devServerUrl is required when mode is "browser" (set it, or return a url from a devServer function)',
            );
          }
          const managed = await startManagedDevServer(
            this.#globalOptions.devServer,
            this.#globalOptions.devServerUrl ?? '',
          );
          this.#stopDevServer = managed.stop;
          managedUrl = managed.url;
        }
        // Validate (+ preflight each distinct URL once when unmanaged) and stamp the resolved URL
        // back onto every cap so the worker navigates to it (a devServer function may have overridden it).
        const probedUrls = new Set<string>();
        for (const cap of caps) {
          const capRecord = cap as Record<string, unknown>;
          const capOpts = (capRecord[CUSTOM_CAPABILITY_NAME] ?? {}) as ElectronServiceGlobalOptions;
          const devServerUrl = managedUrl ?? capOpts.devServerUrl ?? this.#globalOptions.devServerUrl;
          if (!devServerUrl) {
            throw new SevereServiceError(
              'devServerUrl is required when mode is "browser" (set it, or return a url from a devServer function)',
            );
          }
          try {
            new URL(devServerUrl);
          } catch {
            throw new SevereServiceError(`devServerUrl is not a valid URL: ${devServerUrl}`);
          }
          if (!this.#globalOptions.devServer && !probedUrls.has(devServerUrl)) {
            const reachable = await probeDevServerReachable(devServerUrl);
            if (isErr(reachable)) {
              throw new SevereServiceError(reachable.error.message);
            }
            probedUrls.add(devServerUrl);
          }
          capRecord[CUSTOM_CAPABILITY_NAME] = { ...capOpts, devServerUrl };
        }
        // Rewrite every cap to a system-Chrome session.
        for (const cap of caps) {
          cap.browserName = 'chrome';
          // Preserve user-supplied goog:chromeOptions (args, extensions, prefs, etc.) but strip
          // `binary` — browser mode wants system Chrome, not the Electron binary passed for native mode.
          const chromeOpts = (cap as Record<string, unknown>)['goog:chromeOptions'] as
            | Record<string, unknown>
            | undefined;
          if (chromeOpts && 'binary' in chromeOpts) {
            delete chromeOpts.binary;
          }
          delete (cap as Record<string, unknown>)['wdio:enforceWebDriverClassic'];
        }
      } catch (error) {
        // Guard the teardown so a stop() rejection can't mask the original onPrepare failure.
        await this.#stopDevServer?.().catch(() => {});
        this.#stopDevServer = undefined;
        throw error instanceof SevereServiceError
          ? error
          : new SevereServiceError(`Failed to start dev server: ${(error as Error).message}`);
      }
      this.#browserMode = true;
      log.info('Browser mode enabled — skipping Electron binary and CDP bridge setup');
      return;
    }
    const pkg =
      (await readPackageUp({ cwd: this.#projectRoot })) ||
      ({ packageJson: { dependencies: {}, devDependencies: {} }, path: '' } as NormalizedReadResult);

    if (!caps.length) {
      const noElectronCapabilityError = new Error('No Electron browser found in capabilities');
      log.error(noElectronCapabilityError.message);
      throw noElectronCapabilityError;
    }

    const localElectronVersion = await getElectronVersion(pkg);

    // Track unique binary paths for AppArmor workaround
    const uniqueBinaryPaths = new Set<string>();
    let apparmorAutoInstall: ElectronServiceGlobalOptions['apparmorAutoInstall'] =
      this.#globalOptions.apparmorAutoInstall;

    await Promise.all(
      caps.map(async (cap) => {
        const electronVersion = cap.browserVersion || localElectronVersion || '';
        const chromiumVersion = await getChromiumVersion(electronVersion);
        if (!electronVersion) {
          log.warn('Could not determine the Electron version under test');
        } else if (chromiumVersion) {
          log.info(`Found Electron v${electronVersion} with Chromedriver v${chromiumVersion}`);
        } else {
          log.warn(`Found Electron v${electronVersion}, but no matching Chromedriver version is known`);
        }

        (cap as ElectronServiceCapabilities & Record<string, unknown>)['wdio:chromiumVersion'] = chromiumVersion;
        (cap as ElectronServiceCapabilities & Record<string, unknown>)['wdio:electronVersion'] = electronVersion;

        if (Number.parseInt(electronVersion.split('.')[0], 10) < 26 && !cap['wdio:chromedriverOptions']?.binary) {
          const invalidElectronVersionError = new SevereServiceError(
            'Electron version must be 26 or higher for auto-configuration of Chromedriver.  If you want to use an older version of Electron, you must configure Chromedriver manually using the wdio:chromedriverOptions capability',
          );
          log.error(invalidElectronVersionError.message);
          throw invalidElectronVersionError;
        }

        let {
          appBinaryPath,
          appEntryPoint,
          appArgs = ['--no-sandbox'],
          apparmorAutoInstall: capApparmorAutoInstall,
          electronBuilderConfig,
        } = Object.assign({}, this.#globalOptions, cap[CUSTOM_CAPABILITY_NAME]);

        // Use capability-level apparmorAutoInstall if provided, otherwise keep the existing value
        if (capApparmorAutoInstall !== undefined) {
          apparmorAutoInstall = capApparmorAutoInstall;
        }

        // Handle path validation and resolution with proper precedence
        if (appEntryPoint || appBinaryPath) {
          const result = await resolveAppPaths({ appEntryPoint, appBinaryPath, appArgs, pkg });
          appBinaryPath = result.appBinaryPath;
          appArgs = result.appArgs;

          // Emit log messages from path resolution
          for (const logMessage of result.logMessages) {
            if (logMessage.args) {
              log[logMessage.level](logMessage.message, ...logMessage.args);
            } else {
              log[logMessage.level](logMessage.message);
            }
          }
        } else {
          // Neither provided - use auto-detection
          log.info('No app binary specified, attempting to detect one...');
          try {
            const appBuildInfo = await getAppBuildInfo(pkg, electronBuilderConfig);

            try {
              // Use the detailed binary path function for better error handling
              const binaryResult = await getBinaryPath(pkg.path, appBuildInfo, electronVersion);

              if (binaryResult.ok) {
                appBinaryPath = binaryResult.value.binaryPath;
                log.info(`Detected app binary at ${appBinaryPath}`);

                // Log any warnings from path generation
                if (binaryResult.value.pathGeneration.ok && binaryResult.value.pathGeneration.value.warnings) {
                  const warnings = binaryResult.value.pathGeneration.value.warnings.filter(
                    (e: PathGenerationError) => e.type === 'CONFIG_WARNING',
                  );
                  warnings.forEach((warning: PathGenerationError) => {
                    log.warn(warning.message);
                  });
                }
              } else {
                // Generate comprehensive error message based on what failed
                const errorMessage = generateBinaryPathErrorMessage(binaryResult, appBuildInfo);
                throw new Error(errorMessage);
              }
            } catch (e) {
              // Fallback to original error handling for backward compatibility
              if (e instanceof Error && !e.message.includes('Could not find Electron app')) {
                const buildToolName = appBuildInfo.isForge ? 'Electron Forge' : 'electron-builder';
                const suggestedCompileCommand = `npx ${
                  appBuildInfo.isForge ? 'electron-forge make' : 'electron-builder build'
                }`;
                throw new Error(
                  `Could not find Electron app built with ${buildToolName}!\nIf the application is not compiled, please do so before running your tests, e.g. via \`${suggestedCompileCommand}\`.`,
                );
              }
              throw e;
            }
          } catch (e) {
            log.error(String(e));
            throw new SevereServiceError((e as Error).message);
          }
        }

        // Collect binary path for AppArmor workaround (applied once per unique path after loop)
        if (appBinaryPath) {
          uniqueBinaryPaths.add(appBinaryPath);
        }

        cap.browserName = 'chrome';
        cap['goog:chromeOptions'] = getChromeOptions({ appBinaryPath, appArgs }, cap);

        // disable WebDriver Bidi session
        cap['wdio:enforceWebDriverClassic'] = true;

        const chromedriverOptions = getChromedriverOptions(cap);
        if (!chromiumVersion && Object.keys(chromedriverOptions).length > 0) {
          cap['wdio:chromedriverOptions'] = chromedriverOptions;
        }

        // Force wdio:chromedriverOptions to be set when we have a chromium version
        // to ensure webdriverio uses the wdio-utils chromedriver setup path
        if (chromiumVersion && !cap['wdio:chromedriverOptions']) {
          cap['wdio:chromedriverOptions'] = {};
          log.info('Electron service: Forced wdio:chromedriverOptions = {} to enable wdio-utils chromedriver setup');
        }

        const browserVersion = chromiumVersion || cap.browserVersion;
        if (browserVersion) {
          cap.browserVersion = browserVersion;
        } else if (!cap['wdio:chromedriverOptions']?.binary) {
          // Two different failures reach here: no Electron version could be determined at all, or
          // one was determined but has no known Chromium mapping. The remedies differ, so they get
          // different messages — installing Electron does nothing for the latter.
          const invalidBrowserVersionOptsError = new Error(
            electronVersion
              ? CHROMIUM_VERSION_NOT_FOUND_ERROR.replace('%s', electronVersion)
              : ELECTRON_VERSION_NOT_FOUND_ERROR,
          );
          log.error(invalidBrowserVersionOptsError.message);
          throw invalidBrowserVersionOptsError;
        }

        /**
         * attach custom capability to be able to identify Electron instances
         * in the worker process
         */
        cap[CUSTOM_CAPABILITY_NAME] = cap[CUSTOM_CAPABILITY_NAME] || {};

        log.debug('Setting capability at onPrepare', cap);
      }),
    ).catch((err) => {
      const msg = `Failed setting up Electron session: ${err.stack}`;
      log.error(msg);
      throw new SevereServiceError(msg);
    });

    // Apply AppArmor workaround once per session with all discovered binary paths
    if (uniqueBinaryPaths.size > 0) {
      applyApparmorWorkaround(Array.from(uniqueBinaryPaths), apparmorAutoInstall);
    }
  }

  /**
   * Assigns unique debugging ports to each Electron instance to prevent port conflicts
   * when running multiple Electron instances concurrently.
   *
   * This method runs at the beginning of each worker process and:
   * 1. Dynamically finds available ports using get-port
   * 2. Adds the --inspect flag with the assigned port to each Electron instance
   * 3. Ensures each Electron instance has a unique debugging port
   *
   * This allows for reliable parallel debugging of multiple Electron instances.
   */
  async onWorkerStart(_cid: string, capabilities: WebdriverIO.Capabilities) {
    if (this.#browserMode) {
      return;
    }
    try {
      const capsList = Array.isArray(capabilities) ? (capabilities as WebdriverIO.Capabilities[]) : [capabilities];
      const caps = capsList.flatMap((cap) => getConvertedElectronCapabilities(cap) as WebdriverIO.Capabilities);

      const portList = await this.#allocateDebuggerPorts(caps.length);

      await Promise.all(
        caps.map(async (cap, index) => {
          setInspectArg(cap, portList[index]);
        }),
      );
      log.debug('Setting capability at onWorkerStart', JSON.stringify(caps));

      // Run environment diagnostics
      const firstCap = caps[0];
      const appBinaryPath = (firstCap?.['goog:chromeOptions'] as Record<string, unknown>)?.binary as string | undefined;
      const electronVersion = (firstCap as Record<string, unknown>)?.['wdio:electronVersion'] as string | undefined;
      const chromiumVersion = (firstCap as Record<string, unknown>)?.['wdio:chromiumVersion'] as string | undefined;
      const results = await diagnoseElectronEnvironment({ appBinaryPath, electronVersion, chromiumVersion });
      formatDiagnosticResults(results, 'electron-service');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack || error.message : String(error);
      const msg = `Failed to assign debugging ports to Electron instances: ${errorMessage}`;
      log.error(msg);
      throw new SevereServiceError(msg);
    }
  }

  async #allocateDebuggerPorts(quantity: number): Promise<number[]> {
    const ports: number[] = [];
    for (let i = 0; i < quantity; i++) {
      const port = await getPort({
        host: '127.0.0.1',
        exclude: [...this.#usedPorts, ...ports],
      });
      ports.push(port);
    }
    for (const port of ports) {
      this.#usedPorts.add(port);
    }
    return ports;
  }
}

/**
 * Configures an Electron capability with the necessary debugging arguments
 * by adding the --inspect flag with the assigned port to chrome options
 *
 * @param cap WebdriverIO capability to modify
 * @param debuggerPort Port number to use for the Node inspector
 */
const setInspectArg = (cap: WebdriverIO.Capabilities, debuggerPort: number) => {
  if (!('goog:chromeOptions' in cap)) {
    cap['goog:chromeOptions'] = { args: [] };
  }
  const chromeOptions = cap['goog:chromeOptions'];
  if (!chromeOptions) {
    return;
  }
  if (!('args' in chromeOptions)) {
    chromeOptions.args = [];
  }
  if (Array.isArray(chromeOptions.args)) {
    chromeOptions.args.push(`--inspect=localhost:${debuggerPort}`);
  }
};
