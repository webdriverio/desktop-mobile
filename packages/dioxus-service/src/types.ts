// Extended service options for `@wdio/dioxus-service`. Builds on the shared
// types in @wdio/native-types with implementation-specific fields needed by
// the launcher / service.

import type { DioxusServiceOptions as BaseDioxusServiceOptions } from '@wdio/native-types';

export type { DioxusCapabilities, DioxusDriverProvider, DioxusServiceGlobalOptions } from '@wdio/native-types';

export type DioxusServiceOptions = BaseDioxusServiceOptions;
