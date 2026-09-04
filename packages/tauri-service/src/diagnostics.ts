import {
  createLogger,
  type DiagnosticResult,
  diagnoseBinary,
  diagnoseDiskSpace,
  diagnoseDisplay,
  diagnoseLinuxDependencies,
  diagnosePlatform,
  isErr,
  type LinuxLibrary,
} from '@wdio/native-utils';
import { ensureTauriDriver, ensureWebKitWebDriver } from './driverManager.js';
import { isEmbeddedProvider } from './embeddedProvider.js';
import type { TauriServiceOptions } from './types.js';

const log = createLogger('tauri-service');

const TAURI_LINUX_LIBRARIES: LinuxLibrary[] = [
  { soname: 'libgtk-3.so.0', aptPackage: 'libgtk-3-0' },
  { soname: 'libgbm.so.1', aptPackage: 'libgbm1' },
  { soname: 'libasound.so.2', aptPackage: 'libasound2' },
  { soname: 'libatk-bridge-2.0.so.0', aptPackage: 'libatk-bridge2.0-0' },
  { soname: 'libcups.so.2', aptPackage: 'libcups2' },
  { soname: 'libdrm.so.2', aptPackage: 'libdrm2' },
  { soname: 'libxkbcommon.so.0', aptPackage: 'libxkbcommon0' },
  { soname: 'libXcomposite.so.1', aptPackage: 'libxcomposite1' },
  { soname: 'libXdamage.so.1', aptPackage: 'libxdamage1' },
  { soname: 'libXrandr.so.2', aptPackage: 'libxrandr2' },
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
  results.push(...diagnoseLinuxDependencies(TAURI_LINUX_LIBRARIES));
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
