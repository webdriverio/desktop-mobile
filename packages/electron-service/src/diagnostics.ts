import {
  createLogger,
  type DiagnosticResult,
  diagnoseBinary,
  diagnoseDiskSpace,
  diagnoseDisplay,
  diagnoseLinuxDependencies,
  diagnosePlatform,
} from '@wdio/native-utils';

const log = createLogger('electron-service');

const ELECTRON_LINUX_PACKAGES = [
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
  'libnss3',
  'libnspr4',
  'libatk1.0-0',
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

  results.push(...diagnoseLinuxDependencies(ELECTRON_LINUX_PACKAGES));
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
