import {
  createLogger,
  type DiagnosticResult,
  diagnoseBinary,
  diagnoseDiskSpace,
  diagnoseDisplay,
  diagnoseLinuxDependencies,
  diagnosePlatform,
  isErr,
} from '@wdio/native-utils';
import { ensureTauriDriver, ensureWebKitWebDriver } from './driverManager.js';
import { isEmbeddedProvider } from './embeddedProvider.js';
import type { TauriServiceOptions } from './types.js';

const log = createLogger('tauri-service');

const TAURI_LINUX_PACKAGES = [
  'libgtk-3-0',
  'libgbm1',
  'libasound2',
  'libatk-bridge2.0-0',
  'libcups2',
  'libdrm2',
  'libxkbcommon0',
  'libxcomposite1',
  'libxdamage1',
  'libxrandr2',
];

export async function diagnoseTauriEnvironment(
  binaryPath: string,
  options: TauriServiceOptions = {},
): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  log.info('Running Tauri environment diagnostics...');

  results.push(...diagnosePlatform());
  results.push(...diagnoseDisplay());
  results.push(...diagnoseBinary(binaryPath));
  results.push(...diagnoseLinuxDependencies(TAURI_LINUX_PACKAGES));
  results.push(...(await diagnoseDriver(options)));
  results.push(...(await diagnoseWebKit()));
  results.push(...diagnoseDiskSpace());

  log.info('Diagnostics complete\n');
  return results;
}

async function diagnoseDriver(options: TauriServiceOptions): Promise<DiagnosticResult[]> {
  if (isEmbeddedProvider(options)) {
    return [
      {
        category: 'Tauri Driver',
        status: 'ok',
        message: 'Embedded WebDriver server (tauri-plugin-wdio-webdriver) — no external driver required',
      },
    ];
  }

  const results: DiagnosticResult[] = [];
  const driverResult = await ensureTauriDriver(options);

  if (isErr(driverResult)) {
    results.push({
      category: 'Tauri Driver',
      status: 'error',
      message: driverResult.error.message,
    });
  } else {
    results.push({
      category: 'Tauri Driver',
      status: 'ok',
      message: `${driverResult.value.path} (${driverResult.value.method})`,
    });
  }

  return results;
}

async function diagnoseWebKit(): Promise<DiagnosticResult[]> {
  if (process.platform !== 'linux') {
    return [];
  }

  const results: DiagnosticResult[] = [];
  const webkitResult = await ensureWebKitWebDriver();

  if (!isErr(webkitResult) && webkitResult.value.path) {
    results.push({
      category: 'WebKitWebDriver',
      status: 'ok',
      message: webkitResult.value.path,
    });
  } else if (isErr(webkitResult)) {
    results.push({
      category: 'WebKitWebDriver',
      status: 'warn',
      message: 'Not found',
      details: webkitResult.error.installInstructions,
    });
  }

  return results;
}
