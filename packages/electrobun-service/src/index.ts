// @wdio/electrobun-service entry point.
//
// - Default export: the worker-side service (registered automatically by the
//   WDIO test runner via `services: ['@wdio/electrobun-service']`).
// - Named `launcher` export: the main-process launch service (auto-detected by
//   the runner using the standard service convention).
//
// The bare import pulls in @wdio/native-types' ambient module augmentation so
// `browser.electrobun.*` and `wdio:electrobunServiceOptions` are typed for
// consumers.
import '@wdio/native-types';

import ElectrobunLaunchService from './launcher.js';
import ElectrobunWorkerService from './service.js';

export { ElectrobunLaunchService as launcher };
export default ElectrobunWorkerService;

export { cefRendererRequired, deeplinkUnsupportedOnPlatform, SevereServiceError } from './errors.js';
export type { ElectrobunCapabilities, ElectrobunServiceGlobalOptions, ElectrobunServiceOptions } from './types.js';
