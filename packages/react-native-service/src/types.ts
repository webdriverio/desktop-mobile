// Extended service options for `@wdio/react-native-service`. Builds on the shared
// types in @wdio/native-types; kept as a thin re-export for now — diverge here
// only when the implementation needs a field that doesn't belong on the public
// @wdio/native-types surface.

import type { ReactNativeServiceOptions as BaseReactNativeServiceOptions } from '@wdio/native-types';

export type { ReactNativeCapabilities, ReactNativeServiceGlobalOptions } from '@wdio/native-types';

export type ReactNativeServiceOptions = BaseReactNativeServiceOptions;
