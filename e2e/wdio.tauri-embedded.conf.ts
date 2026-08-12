import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NormalizedPackageJson } from '@wdio/native-types';

import { createEnvironmentContext } from './config/envSchema.js';
import { fileExists, getLogDirName, resolveTauriFixtureBinary, safeJsonParse } from './lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration context for WDIO Tauri tests with embedded WebDriver provider
 */
interface TauriEmbeddedConfigContext {
  envContext: ReturnType<typeof createEnvironmentContext>;
  appPath: string;
  appBinaryPath: string;
  packageJson: NormalizedPackageJson;
}

/**
 * Get Tauri embedded configuration context
 */
async function getTauriEmbeddedConfigContext(): Promise<TauriEmbeddedConfigContext> {
  console.log('🔍 Creating WDIO Tauri Embedded configuration context...');

  // Note: Embedded provider supports macOS natively - no platform skip needed

  // Parse and validate environment
  const envContext = createEnvironmentContext();

  // Ensure we're using Tauri framework
  if (envContext.framework !== 'tauri') {
    throw new Error(`This config is for Tauri framework, got: ${envContext.framework}`);
  }

  console.log(`Environment: ${envContext.toString()}`);

  // Determine app directory
  const appPath = envContext.env.APP_DIR || envContext.appDirPath;
  console.log(`App path: ${appPath}`);

  if (!existsSync(appPath)) {
    throw new Error(`App directory does not exist: ${appPath}`);
  }

  // Load package.json from app
  const packageJsonPath = join(appPath, 'package.json');
  if (!fileExists(packageJsonPath)) {
    throw new Error(`package.json not found: ${packageJsonPath}`);
  }

  const packageJsonContent = readFileSync(packageJsonPath, 'utf-8');
  const packageJson = safeJsonParse<NormalizedPackageJson>(packageJsonContent, {
    name: 'tauri-app',
    version: '1.0.0',
    readme: '',
    _id: 'tauri-app@1.0.0',
  } as NormalizedPackageJson);

  // Set package.json on globalThis for tests
  globalThis.packageJson = packageJson;

  console.log('🔍 Setting up Tauri Embedded test with app binary path');

  // Resolve the built fixture binary (shared with wdio.tauri.conf.ts and the
  // standalone specs). Uses debug builds — they include tauri-plugin-automation
  // needed by the CrabNebula provider on macOS.
  const appBinaryPath = resolveTauriFixtureBinary(appPath);
  console.log(`Using Tauri binary: ${appBinaryPath}`);

  return {
    envContext,
    appPath,
    appBinaryPath,
    packageJson,
  };
}

const context = await getTauriEmbeddedConfigContext();
const { envContext, appBinaryPath } = context;

// Configure specs based on test type
let specs: string[] = [];
let exclude: string[] = [];
let maxInstances = 5;
switch (envContext.testType) {
  case 'multiremote':
    specs = ['./test/tauri/multiremote/*.spec.ts'];
    maxInstances = 1;
    break;
  case 'standalone':
    specs = ['./test/tauri/standalone/*.spec.ts'];
    break;
  case 'window':
    // Window tests - only window-specific functionality
    specs = ['./test/tauri/window.spec.ts'];
    break;
  case 'deeplink':
    // Deeplink tests require single-instance mode and sequential execution
    specs = ['./test/tauri/deeplink.spec.ts'];
    maxInstances = 1;
    break;
  default:
    // Standard tests - core functionality without specialized test modes
    specs = ['./test/tauri/*.spec.ts'];
    // Sequential execution required: embedded mode shares a single Tauri app instance
    // across all workers, so window.__wdio_mocks__ is global shared state. Running
    // specs one at a time ensures afterSession cleans up mocks before the next spec starts.
    maxInstances = 1;
    // Exclude:
    // - window tests (require splash)
    // - deeplink tests (require single-instance)
    // - trace-debug tests (WebKit limitation - not captured in embedded mode)
    exclude = [
      './test/tauri/window.spec.ts',
      './test/tauri/deeplink.spec.ts',
      './test/tauri/logging.tauri-driver.spec.ts',
      // #591 Bug 2 tripwire asserts the upstream external+Linux failure; on the
      // embedded provider setValue works, so its inverse assertion would false-fire.
      './test/tauri/set-value.linux-tripwire.spec.ts',
    ];
    // Note: logging.embedded.spec.ts is included to document the limitation
    break;
}

// Configure capabilities
type TauriCapability = {
  browserName?: 'tauri';
  'wdio:enforceWebDriverClassic'?: boolean;
  'tauri:options': {
    application: string;
    args?: string[];
  };
  'wdio:tauriServiceOptions': {
    appBinaryPath: string;
    appArgs: string[];
    driverProvider: 'embedded';
    embeddedPort?: number;
    env?: Record<string, string>;
    captureBackendLogs?: boolean;
    captureFrontendLogs?: boolean;
    backendLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    frontendLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  };
};

type InstanceConfig = {
  capabilities: TauriCapability;
  hostname?: string;
  port?: number;
};

type MultiremoteCapabilities = {
  browserA: InstanceConfig;
  browserB: InstanceConfig;
};

type StandardCapabilities = TauriCapability[];

let capabilities: MultiremoteCapabilities | StandardCapabilities;

if (envContext.isMultiremote) {
  // Tauri multiremote configuration with embedded provider
  const baseEnv: Record<string, string> = {};
  if (envContext.isSplashEnabled) {
    baseEnv.ENABLE_SPLASH_WINDOW = 'true';
  }

  // Each instance gets a unique embedded port (base 4445)
  capabilities = {
    browserA: {
      capabilities: {
        browserName: 'tauri',
        'wdio:enforceWebDriverClassic': true,
        'tauri:options': {
          application: appBinaryPath,
          args: ['--browser=A'],
        },
        'wdio:tauriServiceOptions': {
          appBinaryPath: appBinaryPath,
          appArgs: ['--browser=A'],
          driverProvider: 'embedded',
          embeddedPort: 4445,
          env: baseEnv,
          // Enable log capture for logging tests
          captureBackendLogs: true,
          captureFrontendLogs: true,
          backendLogLevel: 'info',
          frontendLogLevel: 'info',
        },
      },
      hostname: '127.0.0.1',
      port: 4445, // Embedded WebDriver port
    },
    browserB: {
      capabilities: {
        browserName: 'tauri',
        'wdio:enforceWebDriverClassic': true,
        'tauri:options': {
          application: appBinaryPath,
          args: ['--browser=B'],
        },
        'wdio:tauriServiceOptions': {
          appBinaryPath: appBinaryPath,
          appArgs: ['--browser=B'],
          driverProvider: 'embedded',
          embeddedPort: 4446,
          env: baseEnv,
          // Enable log capture for logging tests
          captureBackendLogs: true,
          captureFrontendLogs: true,
          backendLogLevel: 'info',
          frontendLogLevel: 'info',
        },
      },
      hostname: '127.0.0.1',
      port: 4446, // Embedded WebDriver port
    },
  };
} else {
  const baseEnv: Record<string, string> = {};
  if (envContext.isSplashEnabled) {
    baseEnv.ENABLE_SPLASH_WINDOW = 'true';
  }
  if (envContext.testType === 'deeplink') {
    baseEnv.ENABLE_SINGLE_INSTANCE = 'true';
  }

  capabilities = [
    {
      browserName: 'tauri',
      'wdio:enforceWebDriverClassic': true,
      'tauri:options': {
        application: appBinaryPath,
        args: ['foo', 'bar=baz'],
      },
      'wdio:tauriServiceOptions': {
        appBinaryPath: appBinaryPath,
        appArgs: ['foo', 'bar=baz'],
        driverProvider: 'embedded',
        // Enable log capture for logging tests
        captureBackendLogs: true,
        captureFrontendLogs: true,
        backendLogLevel: 'info',
        frontendLogLevel: 'info',
      },
    },
  ];
}

// Create log directory
const logDirName = getLogDirName(envContext.testType, envContext.appDirName, 'embedded');
const logDir = join(__dirname, 'logs', logDirName);

// Export the configuration object directly
export const config = {
  runner: 'local',
  specs,
  exclude,
  maxInstances,
  capabilities,
  logLevel: 'info',
  bail: 0,
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  autoXvfb: false,
  services: [
    [
      '@wdio/tauri-service',
      {
        driverProvider: 'embedded', // Use embedded WebDriver provider
      },
    ],
  ],
  framework: 'mocha',
  reporters: ['spec'],
  // Regression harness for user command-override composition (#422/#443): register
  // a user element-command override for `click` BEFORE the service's before() runs
  // (the config `before` precedes it — the ordering that let the service clobber
  // it). The service must chain this override via installMockSyncOverride, not
  // replace it; command-override.spec.ts asserts the flag. The flag lives on
  // globalThis (shared with the spec in the same worker process) — an arbitrary
  // WDIO browser property doesn't persist across every tauri provider. The
  // passthrough chains origClick, so other specs behave identically.
  before: async (_caps: never, _specs: never, browser: WebdriverIO.Browser) => {
    await browser.overwriteCommand(
      'click',
      async function (
        this: WebdriverIO.Element,
        origClick: (...a: readonly unknown[]) => Promise<unknown>,
        ...args: readonly unknown[]
      ): Promise<unknown> {
        (globalThis as unknown as Record<string, unknown>).__userClickOverrideRan = true;
        return origClick(...args);
      } as Parameters<typeof browser.overwriteCommand>[1],
      true,
    );
  },
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },
  outputDir: logDir,
};
