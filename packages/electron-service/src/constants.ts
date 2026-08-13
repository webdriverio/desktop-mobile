export const APP_NOT_FOUND_ERROR =
  'Could not find Electron app built with %s!\nIf the application is not compiled, please do so before running your tests, e.g. via `%s`.';
export const CUSTOM_CAPABILITY_NAME = 'wdio:electronServiceOptions';

export enum Channel {
  Execute = 'wdio-electron.execute',
}

export const BUILD_TOOL_DETECTION_ERROR =
  'No build tool was detected, if the application is compiled at a different location, please specify the `appBinaryPath` option in your capabilities.';
export const APP_NAME_DETECTION_ERROR =
  'No application name was detected, please set name / productName in your package.json or build tool configuration.';

export const ELECTRON_VERSION_NOT_FOUND_ERROR = [
  'Could not determine the Electron version under test.',
  'Install `electron` or `electron-nightly` in the project being tested, or set the `browserVersion`',
  'capability to the Electron version under test, or set `wdio:chromedriverOptions.binary` to a',
  'Chromedriver you provide. See https://github.com/webdriverio/desktop-mobile/blob/main/packages/electron-service/docs/common-issues.md#could-not-determine-the-electron-version-under-test',
].join(' ');

export const CHROMIUM_VERSION_NOT_FOUND_ERROR = [
  'Could not determine the Chromium version for Electron v%s.',
  'This happens for nightly and forked builds, and for Electron releases newer than the bundled',
  'version map when the online lookup is unavailable.',
  'Set `wdio:chromedriverOptions.binary` to a matching Chromedriver, or set the `browserVersion`',
  'capability to the Chromium version this Electron build uses.',
  'See https://github.com/webdriverio/desktop-mobile/blob/main/packages/electron-service/docs/common-issues.md#could-not-determine-the-chromium-version-for-electron-vx',
].join(' ');

export const PKG_NAME_ELECTRON = {
  STABLE: 'electron',
  NIGHTLY: 'electron-nightly',
} as const;
export const PNPM_CATALOG_PREFIX = 'catalog:';
export const PNPM_WORKSPACE_YAML = 'pnpm-workspace.yaml';

export const BUILDER_CONFIG_NOT_FOUND_ERROR =
  'Electron-builder was detected but no configuration was found, make sure your config file is named correctly, e.g. `electron-builder.config.json`.';

export const FORGE_CONFIG_NOT_FOUND_ERROR = 'Forge was detected but no configuration was found.';
export const MULTIPLE_BUILD_TOOL_WARNING = {
  DESCRIPTION:
    'Detected both Forge and Builder configurations, the Forge configuration will be used to determine build information',
  SUGGESTION: 'You can override this by specifying the `appBinaryPath` option in your capabilities.',
};
export const SUPPORTED_PLATFORM = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'win32',
} as const;

export const SUPPORTED_BUILD_TOOL = {
  forge: 'forge',
  builder: 'builder',
} as const;
