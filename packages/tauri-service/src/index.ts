// Import types package to ensure module augmentation is loaded
import { browser as wdioBrowser } from '@wdio/globals';
import '@wdio/native-types';

export { default as launcher } from './launcher.js';
export { default } from './service.js';
export {
  cleanup as cleanupWdioSession,
  createTauriCapabilities,
  init as startWdioSession,
} from './session.js';
export const browser: WebdriverIO.Browser = wdioBrowser;
export type {
  TauriCapabilities,
  TauriServiceGlobalOptions,
  TauriServiceOptions,
} from './types.js';

import type { TauriExecuteOptions } from '@wdio/native-types';

/**
 * Create Tauri execute options with proper sentinel.
 * Use this to avoid ambiguity between user arguments and options.
 *
 * @example
 * ```js
 * import { withExecuteOptions } from '@wdio/tauri-service';
 *
 * await browser.tauri.execute(
 *   (tauri, config) => tauri.core.invoke('open', config),
 *   withExecuteOptions({ windowLabel: 'popup' }),
 *   { width: 400, height: 300 }
 * );
 * ```
 */
export function withExecuteOptions(options: { windowLabel?: string }): TauriExecuteOptions {
  return { ...options, __wdioOptions__: true } as TauriExecuteOptions;
}
