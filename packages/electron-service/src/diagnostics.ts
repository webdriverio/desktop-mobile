import {
  createLogger,
  type DiagnosticResult,
  diagnoseBinary,
  diagnoseDiskSpace,
  diagnoseDisplay,
  diagnoseLinuxDependencies,
  diagnosePlatform,
  type LinuxLibrary,
} from '@wdio/native-utils';

const log = createLogger('electron-service');

const ELECTRON_LINUX_LIBRARIES: LinuxLibrary[] = [
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
  { soname: 'libnss3.so', aptPackage: 'libnss3' },
  { soname: 'libnspr4.so', aptPackage: 'libnspr4' },
  { soname: 'libatk-1.0.so.0', aptPackage: 'libatk1.0-0' },
];

export interface ElectronDiagnosticsOptions {
  appBinaryPath?: string;
  electronVersion?: string;
  chromiumVersion?: string;
}

export async function diagnoseElectronEnvironment(
  options: ElectronDiagnosticsOptions = {},
): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  log.debug('Running Electron environment diagnostics...');

  results.push(...diagnosePlatform());
  results.push(...diagnoseDisplay());

  if (options.appBinaryPath) {
    results.push(...diagnoseBinary(options.appBinaryPath));
  }

  if (options.electronVersion) {
    results.push(...diagnoseElectronVersion(options.electronVersion));
  }

  if (options.chromiumVersion) {
    results.push(...diagnoseChromiumVersion(options.chromiumVersion));
  }

  results.push(...diagnoseLinuxDependencies(ELECTRON_LINUX_LIBRARIES));
  results.push(...diagnoseDiskSpace());

  log.debug('Diagnostics complete');
  return results;
}

function diagnoseElectronVersion(version: string): DiagnosticResult[] {
  const results: DiagnosticResult[] = [];
  const majorVersion = parseInt(version.split('.')[0], 10);

  if (Number.isNaN(majorVersion)) {
    results.push({
      category: 'Electron Version',
      status: 'warn',
      message: `Could not parse version: ${version}`,
    });
    return results;
  }

  if (majorVersion < 26) {
    results.push({
      category: 'Electron Version',
      status: 'error',
      message: `v${version} - Auto-configuration requires Electron 26+`,
      details: 'For older versions, manually configure Chromedriver using wdio:chromedriverOptions capability.',
    });
  } else {
    results.push({
      category: 'Electron Version',
      status: 'ok',
      message: `v${version}`,
    });
  }

  return results;
}

function diagnoseChromiumVersion(version: string): DiagnosticResult[] {
  return [
    {
      category: 'Chromium Version',
      status: 'ok',
      message: `v${version}`,
      details: 'Chromedriver version should match Chromium version for proper operation.',
    },
  ];
}
