// @wdio/dioxus-service entry point.
//
// - Default export: the worker-side service (registered automatically by
//   the WDIO test runner via `services: ['@wdio/dioxus-service']`).
// - Named `launcher` export: the main-process launcher (auto-detected by
//   the runner using the standard service convention).

import DioxusLaunchService from './launcher.js';
import DioxusWorkerService from './service.js';

export { DioxusLaunchService as launcher };
export default DioxusWorkerService;

export { linuxExternalProviderUnsupported, SevereServiceError } from './errors.js';
export {
  cleanup as cleanupWdioSession,
  createDioxusCapabilities,
  init as startWdioSession,
} from './session.js';
export type {
  DioxusCapabilities,
  DioxusDriverProvider,
  DioxusServiceGlobalOptions,
  DioxusServiceOptions,
} from './types.js';
