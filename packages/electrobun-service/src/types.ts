// Extended service options for `@wdio/electrobun-service`. Builds on the shared
// types in @wdio/native-types with any implementation-specific fields the
// launcher / service need. Kept as a thin alias for now — diverge here only
// when the implementation requires a field that doesn't belong in the public
// @wdio/native-types surface.

import type { ElectrobunServiceOptions as BaseElectrobunServiceOptions } from '@wdio/native-types';

export type { ElectrobunCapabilities, ElectrobunServiceGlobalOptions } from '@wdio/native-types';

export type ElectrobunServiceOptions = BaseElectrobunServiceOptions;
