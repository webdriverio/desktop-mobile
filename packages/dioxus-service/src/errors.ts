// Error classes / message constants for the Dioxus service.
//
// `SevereServiceError` (re-exported from webdriverio) signals to the WDIO
// runner that the failure is non-recoverable and the run should abort — used
// when we detect a configuration that fundamentally can't work, e.g.
// `driverProvider: 'external'` on Linux (blocked pending an upstream Dioxus
// PR per spike/FINDINGS.md).

import { SevereServiceError } from 'webdriverio';

export { SevereServiceError };

/**
 * Compose the error message thrown when a user selects
 * `driverProvider: 'external'` on Linux. The message points them at
 * `'embedded'` and explains why the external path doesn't work here yet.
 */
export function linuxExternalProviderUnsupported(): Error {
  return new SevereServiceError(
    "driverProvider: 'external' is not supported on Linux in this release. " +
      "Use driverProvider: 'embedded' instead (this is the recommended path on " +
      'all platforms). Linux external-provider support is pending an upstream ' +
      'Dioxus PR that exposes Wry automation mode — see ' +
      'https://github.com/webdriverio/desktop-mobile/blob/main/spike/FINDINGS.md ' +
      'for context.',
  );
}
