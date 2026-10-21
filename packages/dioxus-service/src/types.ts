// Extended service options for `@wdio/dioxus-service`. Builds on the shared
// types in @wdio/native-types with implementation-specific fields needed by
// the launcher / service.

import type {
  DioxusServiceGlobalOptions as BaseDioxusServiceGlobalOptions,
  DioxusServiceOptions as BaseDioxusServiceOptions,
} from '@wdio/native-types';

export type { DioxusCapabilities, DioxusDriverProvider } from '@wdio/native-types';

export type DioxusServiceOptions = BaseDioxusServiceOptions;

export interface DioxusServiceGlobalOptions extends BaseDioxusServiceGlobalOptions {
  /** Overall app startup budget in ms (default 60000). A capability-level value takes precedence. */
  startTimeout?: number;
}
