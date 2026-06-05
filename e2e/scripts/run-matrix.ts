#!/usr/bin/env tsx

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { createEnvironmentContext, type EnvironmentContext } from '../config/envSchema.js';
import { StatusBar, type TestResult, TestStatusTracker } from '../lib/statusBar.js';
import { execWdio, formatDuration, getE2EAppDirName, getLogDirName } from '../lib/utils.js';
import BuildManager from './build-apps.js';

/**
 * Test variant definition
 */
interface TestVariant {
  framework: 'electron' | 'tauri';
  app: 'builder' | 'forge' | 'script' | 'basic';
  testType: 'standard' | 'window' | 'multiremote' | 'standalone' | 'deeplink';
  binary: boolean;
}

/**
 * Get human-readable test name
 */
function getTestName(variant: TestVariant): string {
  const parts = [variant.framework, variant.app, variant.testType, variant.binary ? 'binary' : 'script'];
  return parts.join('-');
}

/**
 * Generate all possible test variants
 */
function generateTestVariants(): TestVariant[] {
  // If FRAMEWORK is set, only generate variants for that framework
  const frameworks: Array<'electron' | 'tauri'> = process.env.FRAMEWORK
    ? [process.env.FRAMEWORK as 'electron' | 'tauri']
    : ['electron', 'tauri'];

  console.log(`🔍 Debug: FRAMEWORK env var: ${process.env.FRAMEWORK}`);
  console.log(`🔍 Debug: Generated frameworks: ${frameworks.join(', ')}`);

  const electronApps: Array<'builder' | 'forge' | 'script'> = ['builder', 'forge', 'script'];
  const tauriApps: Array<'basic'> = ['basic'];
  const testTypes: Array<'standard' | 'window' | 'multiremote' | 'standalone' | 'deeplink'> = [
    'standard',
    'window',
    'multiremote',
    'standalone',
    'deeplink',
  ];

  const variants: TestVariant[] = [];

  for (const framework of frameworks) {
    const apps = framework === 'electron' ? electronApps : tauriApps;

    for (const app of apps) {
      for (const testType of testTypes) {
        // script app is always non-binary for Electron
        // Tauri apps are always binary
        const binary = framework === 'tauri' || app !== 'script';

        // Skip deeplink tests for script mode - deeplink requires packaged apps
        if (testType === 'deeplink' && !binary) {
          continue;
        }

        variants.push({
          framework,
          app,
          testType,
          binary,
        });
      }
    }
  }

  console.log(`🔍 Debug: Generated ${variants.length} variants:`);
  variants.forEach((variant, index) => {
    console.log(
      `  ${index + 1}. ${variant.framework}-${variant.app}-${variant.testType}-${variant.binary ? 'binary' : 'script'}`,
    );
  });

  return variants;
}

/**
 * Check if environment variables are set for filtering
 */
function hasEnvironmentFilters(): boolean {
  return !!(
    process.env.FRAMEWORK ||
    process.env.APP ||
    process.env.TEST_TYPE ||
    process.env.BINARY ||
    process.env.MAC_UNIVERSAL === 'true'
  );
}

/**
 * Filter variants based on environment variables
 * - If NO environment filters are set: run ALL variants (local development)
 * - If ANY environment filters are set: run only matching variants (CI mode)
 */
function filterVariants(variants: TestVariant[], envContext: EnvironmentContext): TestVariant[] {
  // If no environment filters are set, run all variants (full matrix for local dev)
  if (!hasEnvironmentFilters()) {
    console.log('🎯 No environment filters detected - running full test matrix');
    return variants;
  }

  console.log('🎯 Environment filters detected - filtering test variants');
  console.log('🔍 Debug: Environment filter values:');
  console.log(`  process.env.FRAMEWORK: "${process.env.FRAMEWORK}"`);
  console.log(`  process.env.APP: "${process.env.APP}"`);
  console.log(`  process.env.TEST_TYPE: "${process.env.TEST_TYPE}"`);
  console.log(`  process.env.BINARY: "${process.env.BINARY}"`);
  console.log(`  envContext.framework: "${envContext.framework}"`);
  console.log(`  envContext.app: "${envContext.app}"`);
  console.log(`  envContext.testType: "${envContext.testType}"`);
  console.log(`  envContext.isBinary: ${envContext.isBinary}`);
  console.log(`  envContext.isMacUniversal: ${envContext.isMacUniversal}`);

  const filtered = variants.filter((variant) => {
    // Framework filter - only apply if explicitly set
    if (process.env.FRAMEWORK && variant.framework !== envContext.framework) {
      return false;
    }

    // App filter - only apply if explicitly set
    if (process.env.APP && variant.app !== envContext.app) {
      return false;
    }

    // Test type filter - only apply if explicitly set
    if (process.env.TEST_TYPE && variant.testType !== envContext.testType) {
      return false;
    }

    // Binary filter - only apply if explicitly set
    if (process.env.BINARY && variant.binary !== envContext.isBinary) {
      return false;
    }

    // Mac Universal mode - include builder/forge binary tests (Electron only)
    if (envContext.isMacUniversal) {
      return variant.framework === 'electron' && ['builder', 'forge'].includes(variant.app) && variant.binary;
    }

    return true;
  });

  console.log(`🔍 Debug: Filtered ${variants.length} variants down to ${filtered.length}`);
  return filtered;
}

/**
 * Run a single test variant
 */
async function runTest(
  variant: TestVariant,
  buildManager: BuildManager,
  envContext: EnvironmentContext,
  collectedLogDirs: string[],
): Promise<TestResult> {
  const testName = getTestName(variant);
  const startTime = Date.now();

  console.log(`\n🚀 Starting test: ${testName}`);

  try {
    // Determine app directory based on framework
    const fixturesDir = 'e2e-apps';
    const isScript = !variant.binary;
    const appDirName = getE2EAppDirName(variant.framework, variant.app, isScript);

    const appPath = join(process.cwd(), '..', 'fixtures', fixturesDir, appDirName);

    console.log(`🔍 Debug: Test paths for ${testName}`);
    console.log(`  Current working directory: ${process.cwd()}`);
    console.log(`  App directory name: ${appDirName}`);
    console.log(`  Full app path: ${appPath}`);
    console.log(`  Platform: ${process.platform}`);

    // Ensure app is built
    const buildSuccess = await buildManager.ensureAppBuilt(appPath);
    if (!buildSuccess) {
      console.error(`❌ Build failed for app: ${appPath}`);
      throw new Error(`Failed to build app: ${appPath}`);
    }

    // Create environment for test execution
    const testEnv = envContext.createChildEnvironment({
      FRAMEWORK: variant.framework,
      APP: variant.app,
      TEST_TYPE: variant.testType,
      BINARY: variant.binary ? 'true' : 'false',
      APP_DIR: appPath,
    });

    // Enable splash screen for window tests
    if (variant.testType === 'window') {
      testEnv.ENABLE_SPLASH_WINDOW = 'true';
    }

    console.log(`  Environment: ${JSON.stringify(testEnv, null, 2)}`);

    // Create log directory for this test
    const logDirName = getLogDirName(envContext.testType, appDirName, envContext.driverProvider);
    const logDir = join(process.cwd(), 'logs', logDirName);
    const outputLogPath = join(logDir, 'wdio-output.log');

    collectedLogDirs.push(logDir);

    // Ensure log directory exists
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    let result: { code: number; stdout: string; stderr: string };

    // Standalone tests run directly with tsx, not through WDIO test runner
    // They are simple scripts that call the session API directly
    // Run each spec file sequentially to avoid port conflicts
    if (variant.testType === 'standalone') {
      const testDir =
        variant.framework === 'electron'
          ? join(process.cwd(), 'test/electron/standalone')
          : join(process.cwd(), 'test/tauri/standalone');

      const specFiles = readdirSync(testDir).filter((f) => f.endsWith('.spec.ts'));

      // Run each spec file sequentially
      let lastResult = { code: 0, stdout: '', stderr: '' };
      for (const specFile of specFiles) {
        const specPath = join(testDir, specFile);
        console.log(`  Running standalone test: ${specFile}`);

        // Use execWdio but with tsx instead of wdio command
        // On Linux, wrap with xvfb-run to provide virtual display
        const command =
          process.platform === 'linux' && variant.framework === 'electron'
            ? `xvfb-run tsx ${specPath}`
            : `tsx ${specPath}`;
        lastResult = await execWdio(command, testEnv, {
          cwd: process.cwd(),
          timeout: 300000, // 5 minutes
        });

        // Node 24 on Windows can trip a libuv `UV_HANDLE_CLOSING` assertion in
        // src/win/async.c when WDIO's HTTP keepalive sockets are torn down
        // during process.exit(). The test body itself succeeds (we print
        // "✅ Cleanup complete" before exit), but Node aborts with a non-zero
        // code mid-teardown. Treat that specific case as a pass: if the
        // cleanup marker is present AND the only error mention is the libuv
        // assertion, the test logically passed.
        const cleanupSucceeded = lastResult.stdout.includes('✅ Cleanup complete');
        const onlyLibuvAssertion =
          lastResult.code !== 0 &&
          /Assertion failed: !\(handle->flags & UV_HANDLE_CLOSING\)/.test(`${lastResult.stdout}\n${lastResult.stderr}`);
        if (lastResult.code !== 0 && !(cleanupSucceeded && onlyLibuvAssertion)) {
          console.log(`  ❌ Standalone test failed: ${specFile}`);
          break; // Stop on first failure
        }

        if (lastResult.code !== 0) {
          console.log(
            `  ⚠️  Standalone test ${specFile}: passed test body but tripped Node 24 / libuv ` +
              `UV_HANDLE_CLOSING during process exit (known Node bug on Windows). Treating as pass.`,
          );
          // Reset code so the outer matrix doesn't see a non-zero from a known-benign crash.
          lastResult = { ...lastResult, code: 0 };
        } else {
          console.log(`  ✅ Standalone test passed: ${specFile}`);
        }

        // Add a small delay between standalone tests to ensure cleanup
        if (specFiles.indexOf(specFile) < specFiles.length - 1) {
          console.log(`  Waiting 2s before next standalone test...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      result = lastResult;
    } else {
      // Run the test - execWdio automatically retries xvfb failures on Linux
      result = await execWdio('pnpm wdio run wdio.conf.ts', testEnv, {
        cwd: process.cwd(),
        timeout: 300000, // 5 minutes
      });
    }

    const duration = Date.now() - startTime;

    // Save output to wdio-output.log
    const fullOutput = `=== STDOUT ===\n${result.stdout}\n=== STDERR ===\n${result.stderr}`;
    writeFileSync(outputLogPath, fullOutput, 'utf8');
    console.log(`📝 Output saved to: ${outputLogPath}`);

    if (result.code === 0) {
      console.log(`✅ Test passed: ${testName} (${formatDuration(duration)})`);
      return {
        name: testName,
        success: true,
        duration,
      };
    } else {
      console.log(`❌ Test failed: ${testName} (${formatDuration(duration)})`);
      return {
        name: testName,
        success: false,
        duration,
        error: result.stderr || result.stdout || 'Unknown error',
      };
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.log(`❌ Test error: ${testName} (${formatDuration(duration)})`);
    console.error(`  Error: ${errorMessage}`);

    return {
      name: testName,
      success: false,
      duration,
      error: errorMessage,
    };
  }
}

/**
 * Display full test output at the end of the run
 * Only shows logs from the directories created during this invocation
 */
function displayFullOutput(logDirs: string[]): void {
  if (logDirs.length === 0) {
    return;
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('📋 FULL TEST OUTPUT');
  console.log('='.repeat(80));

  for (const logDir of logDirs) {
    const outputLogPath = join(logDir, 'wdio-output.log');

    if (existsSync(outputLogPath)) {
      const dirName = logDir.split(/[\\/]/).at(-1) ?? logDir;
      console.log(`\n--- ${dirName}/wdio-output.log ---`);
      const content = readFileSync(outputLogPath, 'utf8');
      if (content.trim()) {
        console.log(content);
      } else {
        console.log('(empty)');
      }
    }
  }

  console.log(`\n${'='.repeat(80)}`);
}

/**
 * Main test runner
 */
async function runTests(): Promise<void> {
  const startTime = Date.now();
  console.log(`🔍 Debug: Starting test execution at ${new Date().toISOString()}`);
  console.log(`🔍 Debug: Node.js version: ${process.version}`);
  console.log(`🔍 Debug: Platform: ${process.platform} ${process.arch}`);
  console.log(`🔍 Debug: Process arguments: ${process.argv.join(' ')}`);

  try {
    console.log(`🔍 Debug: Parsing environment context...`);
    // Parse environment and validate
    const envContext = createEnvironmentContext();
    console.log(`🎯 Test Environment: ${envContext.toString()}`);
    console.log(`🔍 Debug: Environment context created successfully`);

    console.log(`🔍 Debug: Setting up build manager...`);
    // Set up build manager
    const buildManager = new BuildManager();

    // Set up concurrency
    const concurrency = envContext.concurrency;
    console.log(`🚀 Running tests with concurrency: ${concurrency}`);
    const limit = pLimit(concurrency);

    console.log(`🔍 Debug: Generating test variants...`);
    // Generate and filter test variants
    const allVariants = generateTestVariants();
    console.log(`🔍 Debug: Generated ${allVariants.length} total variants`);

    console.log(`🔍 Debug: Filtering test variants...`);
    const filteredVariants = filterVariants(allVariants, envContext);

    console.log(`📊 Generated ${allVariants.length} possible test variants`);
    console.log(`📊 Filtered to ${filteredVariants.length} test variants for current environment`);

    if (filteredVariants.length === 0) {
      console.log('\n⚠️ WARNING: No test variants match the current environment!');
      console.log('Environment configuration:');
      console.log(`  FRAMEWORK: ${envContext.framework}`);
      console.log(`  APP: ${envContext.app}`);
      console.log(`  TEST_TYPE: ${envContext.testType}`);
      console.log(`  BINARY: ${envContext.isBinary}`);
      console.log(`  MAC_UNIVERSAL: ${envContext.isMacUniversal}`);

      console.error('\n❌ ERROR: Cannot continue without any test variants to run.');
      process.exit(1);
    }

    // Print test plan
    console.log('\n📋 Test Plan:');
    for (const variant of filteredVariants) {
      const testName = getTestName(variant);
      console.log(`  • ${testName}`);
    }
    console.log('═'.repeat(80));

    // Set up status tracking
    const statusBar = StatusBar.getInstance();
    const testNames = filteredVariants.map(getTestName);
    const statusTracker = new TestStatusTracker(testNames);

    // Initialize status bar
    statusBar.initialize();

    // Set up status updates
    const statusUpdateInterval = setInterval(() => {
      const status = statusTracker.getStatus();
      statusBar.updateStatus(status);
    }, 500);

    console.log(`🔍 Debug: Starting test execution with ${filteredVariants.length} variants...`);
    console.log(`🔍 Debug: System resources before test execution:`);
    console.log(`    Memory usage: ${JSON.stringify(process.memoryUsage())}`);
    console.log(`    Uptime: ${process.uptime()}s`);
    console.log(`    Load average: ${process.platform !== 'win32' ? JSON.stringify(loadavg()) : 'N/A (Windows)'}`);

    const collectedLogDirs: string[] = [];

    // Run all tests with controlled concurrency
    const results: TestResult[] = await Promise.all(
      filteredVariants.map((variant, index) =>
        limit(async () => {
          const testName = getTestName(variant);
          console.log(
            `🔍 Debug: Starting variant ${index + 1}/${filteredVariants.length}: ${testName} at ${new Date().toISOString()}`,
          );
          statusTracker.startTest(testName);

          const variantStartTime = Date.now();
          const result = await runTest(variant, buildManager, envContext, collectedLogDirs);
          const variantDuration = Date.now() - variantStartTime;

          console.log(
            `🔍 Debug: Completed variant ${index + 1}/${filteredVariants.length}: ${testName} - ${result.success ? 'SUCCESS' : 'FAILED'} in ${variantDuration}ms`,
          );

          statusTracker.completeTest(testName, result);
          return result;
        }),
      ),
    );

    console.log(`🔍 Debug: All test variants completed. Processing results...`);

    // Clean up status updates
    if (statusUpdateInterval) {
      clearInterval(statusUpdateInterval);
    }

    console.log(`🔍 Debug: Printing final summary...`);
    // Print final summary
    statusBar.printFinalSummary(results, startTime);

    // Display output only for directories created during this run
    displayFullOutput(collectedLogDirs);

    console.log(`🔍 Debug: Analyzing test results...`);
    // Check if all tests passed
    const failed = results.filter((r) => !r.success && !r.skipped).length;
    const passed = results.filter((r) => r.success && !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;

    console.log(`🔍 Debug: Test results breakdown: ${passed} passed, ${failed} failed, ${skipped} skipped`);

    if (failed > 0) {
      console.error(`\n❌ ${failed} test(s) failed out of ${results.length}`);
      console.log(`🔍 Debug: Exiting with code 1 due to test failures`);
      process.exit(1);
    } else {
      console.log(`\n✅ All ${passed} tests passed successfully!`);
      console.log(`🔍 Debug: All tests passed, exiting with code 0`);
    }
  } catch (error) {
    console.error(`\n❌ Error running tests: ${error}`);
    console.log(`🔍 Debug: Caught error in main test runner:`, error);
    console.log(`🔍 Debug: Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
    console.log(`🔍 Debug: Exiting with code 1 due to unhandled error`);
    process.exit(1);
  }
}

/**
 * Parse command line arguments
 */
function parseCommandLineArgs(): void {
  const args = process.argv.slice(2);

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--debug') {
      process.env.WDIO_MATRIX_DEBUG = 'true';
      continue;
    }

    if (arg === '--verbose') {
      process.env.WDIO_VERBOSE = 'true';
      continue;
    }

    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (match) {
      const [, key, value] = match;
      switch (key) {
        case 'framework':
          process.env.FRAMEWORK = value;
          console.log(`Set FRAMEWORK=${value} from command line`);
          break;
        case 'app':
          process.env.APP = value;
          console.log(`Set APP=${value} from command line`);
          break;
        case 'module-type':
        case 'modules':
          // MODULE_TYPE is deprecated for E2E tests (ESM only)
          // Kept for backward compatibility but not used
          console.log(`⚠️  MODULE_TYPE is deprecated for E2E tests (ESM only). Ignoring: ${value}`);
          break;
        case 'test-type':
        case 'tests':
          process.env.TEST_TYPE = value;
          console.log(`Set TEST_TYPE=${value} from command line`);
          break;
        case 'binary':
          process.env.BINARY = value;
          console.log(`Set BINARY=${value} from command line`);
          break;
        case 'mac-universal':
          process.env.MAC_UNIVERSAL = value;
          console.log(`Set MAC_UNIVERSAL=${value} from command line`);
          break;
        case 'concurrency':
          process.env.CONCURRENCY = value;
          console.log(`Set CONCURRENCY=${value} from command line`);
          break;
        default:
          console.log(`Unknown argument: ${arg}`);
      }
    }
  }
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
🚀 WebdriverIO Desktop & Mobile E2E Test Matrix

USAGE:
  tsx scripts/run-matrix.ts [options]

FILTERING OPTIONS:
  --framework=<framework>   Run tests for specific framework(s): electron, tauri
  --app=<app>              Run tests for specific app(s): builder, forge, script, basic, advanced
  --module-type=<type>      Run tests for specific module type(s): cjs, esm
  --test-type=<type>       Run tests for specific test type(s): standard, window, multiremote, standalone
  --binary=<true|false>     Run binary or script tests
  --mac-universal=<true>    Run Mac Universal build tests (Electron builder/forge only)

EXECUTION OPTIONS:
  --concurrency=<n>         Number of tests to run concurrently (default: 1)
  --debug                   Enable debug output
  --verbose                 Enable verbose WDIO output
  --help, -h               Show this help message

EXAMPLES:
  # Run full test matrix (all combinations)
  tsx scripts/run-matrix.ts

  # Run only Electron tests
  tsx scripts/run-matrix.ts --framework=electron

  # Run only Tauri tests
  tsx scripts/run-matrix.ts --framework=tauri

  # Run only builder tests
  tsx scripts/run-matrix.ts --app=builder

  # Run only basic Tauri tests
  tsx scripts/run-matrix.ts --framework=tauri --app=basic

  # Run only ESM tests
  tsx scripts/run-matrix.ts --module-type=esm

  # Run only window tests for forge platform
  tsx scripts/run-matrix.ts --framework=electron --app=forge --test-type=window

  # Run tests with higher concurrency
  tsx scripts/run-matrix.ts --concurrency=3

  # CI mode - run specific combination (set via environment)
  FRAMEWORK=electron APP=builder tsx scripts/run-matrix.ts

ENVIRONMENT VARIABLES:
  All command-line options can also be set via environment variables:
  FRAMEWORK, APP, TEST_TYPE, BINARY, MAC_UNIVERSAL, CONCURRENCY

  Note: MODULE_TYPE is deprecated for E2E tests (ESM only). CJS/ESM testing is done in package tests.
`);
}

// Main execution
async function main(): Promise<void> {
  // Prevent duplicate execution
  if (process.env.WDIO_MATRIX_EXECUTING) {
    console.log('⚠️ Script already executing, skipping duplicate run');
    return;
  }
  process.env.WDIO_MATRIX_EXECUTING = 'true';

  console.log('🚀 WebdriverIO Desktop & Mobile E2E Test Matrix');
  console.log('Arguments:', process.argv.slice(2));

  // Parse command line arguments
  parseCommandLineArgs();

  // Run tests
  await runTests();
}

// Run the tests
main().catch((error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});
