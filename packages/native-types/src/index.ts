// ============================================================================
// Re-export all types from split files
// ============================================================================

// Dioxus types
export type {
  DioxusAPIs,
  DioxusBrowserExtension,
  DioxusCapabilities,
  DioxusDriverProvider,
  DioxusMock,
  DioxusMockInstance,
  DioxusServiceAPI,
  DioxusServiceGlobalOptions,
  DioxusServiceOptions,
} from './dioxus.js';
// Electrobun types
export type {
  ElectrobunAPIs,
  ElectrobunBrowserExtension,
  ElectrobunCapabilities,
  ElectrobunMock,
  ElectrobunMockInstance,
  ElectrobunServiceAPI,
  ElectrobunServiceGlobalOptions,
  ElectrobunServiceOptions,
} from './electrobun.js';
// Electron types
export type {
  ApiCommand,
  AppBuildInfo,
  BinaryPathResult,
  BuilderArch,
  BuilderBuildInfo,
  BuilderConfig,
  Electron,
  ElectronApiFn,
  ElectronBrowserExtension,
  ElectronClassMock,
  ElectronFunctionMock,
  ElectronInterface,
  ElectronMock,
  ElectronMockInstance,
  ElectronServiceAPI,
  ElectronServiceCapabilities,
  ElectronServiceGlobalOptions,
  ElectronServiceOptions,
  ElectronStandaloneCapability,
  ElectronType,
  ExecuteOpts,
  ForgeArch,
  ForgeBuildInfo,
  ForgeConfig,
  PackageJson,
  PathGenerationError,
  PathGenerationErrorType,
  PathGenerationResult,
  PathValidationAttempt,
  PathValidationError,
  PathValidationErrorType,
  PathValidationResult,
  vitestFn,
  WdioElectronConfig,
  WdioElectronWindowObj,
  WebdriverClientFunc,
} from './electron.js';
// Package.json types
export type {
  NormalizedPackageJson,
  NormalizedReadResult,
  ReadPackageUpOptions,
} from './package.js';
// React Native types
export type {
  ReactNativeAPIs,
  ReactNativeBrowserExtension,
  ReactNativeCapabilities,
  ReactNativeExecuteOptions,
  ReactNativeMock,
  ReactNativeMockInstance,
  ReactNativeResult,
  ReactNativeServiceAPI,
  ReactNativeServiceCapabilities,
  ReactNativeServiceCapabilitiesType,
  ReactNativeServiceCustomCapability,
  ReactNativeServiceGlobalOptions,
  ReactNativeServiceOptions,
  WdioReactNativeConfig,
} from './react-native.js';
// Shared types
export type {
  AbstractFn,
  AsyncFn,
  BaseServiceGlobalOptions,
  BaseServiceOptions,
  BaseWithExecute,
  BrowserBase,
  DriverProviderConfig,
  Fn,
  LogCaptureConfig,
  LogLevel,
  MockLifecycleConfig,
  MockOverride,
  MockResult,
  Result,
  SelectorsBase,
  ServiceMockContext,
} from './shared.js';

// Tauri types
export type {
  TauriAPIs,
  TauriBrowserExtension,
  TauriCapabilities,
  TauriEventTarget,
  TauriExecuteOptions,
  TauriMock,
  TauriMockInstance,
  TauriResult,
  TauriServiceAPI,
  TauriServiceCapabilities,
  TauriServiceCapabilitiesType,
  TauriServiceCustomCapability,
  TauriServiceGlobalOptions,
  TauriServiceOptions,
  WdioTauriConfig,
} from './tauri.js';

// ============================================================================
// Combined Browser Extension
// ============================================================================

import type { DioxusBrowserExtension } from './dioxus.js';
import type { ElectrobunBrowserExtension } from './electrobun.js';
import type { ElectronBrowserExtension } from './electron.js';
import type { ReactNativeBrowserExtension } from './react-native.js';
import type { TauriBrowserExtension } from './tauri.js';

/**
 * Browser extension that supports Electron, Tauri, Dioxus, Electrobun, and React Native services
 */
export interface BrowserExtension
  extends ElectronBrowserExtension,
    TauriBrowserExtension,
    DioxusBrowserExtension,
    ElectrobunBrowserExtension,
    ReactNativeBrowserExtension {}

// ============================================================================
// Module Augmentation (WebdriverIO)
// ============================================================================

import type { fn as vitestFn } from '@wdio/native-spy';
import type { DioxusServiceGlobalOptions, DioxusServiceOptions } from './dioxus.js';
import type { ElectrobunServiceGlobalOptions, ElectrobunServiceOptions } from './electrobun.js';
import type {
  ElectronInterface,
  ElectronServiceGlobalOptions,
  ElectronServiceOptions,
  ElectronType,
  PackageJson,
  WdioElectronWindowObj,
} from './electron.js';
import type { ReactNativeServiceGlobalOptions, ReactNativeServiceOptions } from './react-native.js';
import type { ElementBase, Fn } from './shared.js';
import type { TauriServiceGlobalOptions, TauriServiceOptions } from './tauri.js';

declare global {
  interface Window {
    wdioElectron: WdioElectronWindowObj;
  }

  // biome-ignore lint/style/noNamespace: This is a legitimate use of namespace for global augmentation
  namespace WebdriverIO {
    interface Browser
      extends ElectronBrowserExtension,
        TauriBrowserExtension,
        DioxusBrowserExtension,
        ElectrobunBrowserExtension,
        ReactNativeBrowserExtension {}
    interface Element extends ElementBase {}
    interface MultiRemoteBrowser
      extends ElectronBrowserExtension,
        TauriBrowserExtension,
        DioxusBrowserExtension,
        ElectrobunBrowserExtension,
        ReactNativeBrowserExtension {}
    interface Capabilities {
      'wdio:electronServiceOptions'?: ElectronServiceOptions;
      'wdio:tauriServiceOptions'?: TauriServiceOptions;
      'wdio:dioxusServiceOptions'?: DioxusServiceOptions;
      'wdio:electrobunServiceOptions'?: ElectrobunServiceOptions;
      'wdio:reactNativeServiceOptions'?: ReactNativeServiceOptions;
    }
    interface ServiceOption
      extends ElectronServiceGlobalOptions,
        TauriServiceGlobalOptions,
        DioxusServiceGlobalOptions,
        ElectrobunServiceGlobalOptions,
        ReactNativeServiceGlobalOptions {}
  }

  var __name: (func: Fn) => Fn;
  var browser: WebdriverIO.Browser;
  var fn: typeof vitestFn;
  var originalApi: Record<ElectronInterface, ElectronType[ElectronInterface]>;
  var packageJson: PackageJson;
}

/**
 * Version constant to ensure the module has runtime code
 * This is needed for bundlers that require at least one runtime export
 */
export const __nativeTypesVersion = '9.2.0';
