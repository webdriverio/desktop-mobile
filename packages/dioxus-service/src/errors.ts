// Error classes / message constants for the Dioxus service.
//
// `SevereServiceError` (re-exported from webdriverio) signals to the WDIO
// runner that the failure is non-recoverable and the run should abort — used
// when we detect a configuration that fundamentally can't work, e.g.
// `driverProvider: 'external'`, which this release doesn't support on any
// platform.

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
      'all platforms). Linux external-provider support needs an upstream ' +
      'Dioxus change that allows WebKit automation — see ' +
      'https://github.com/webdriverio/desktop-mobile/issues/712.',
  );
}

/**
 * Compose the error message thrown when a user selects
 * `driverProvider: 'external'` on macOS. The external provider requires
 * msedgedriver which is Windows-only.
 */
export function macosExternalProviderUnsupported(): Error {
  return new SevereServiceError(
    "driverProvider: 'external' is not supported on macOS. " +
      "Use driverProvider: 'embedded' instead (works on all platforms). " +
      'The external provider requires msedgedriver which is Windows-only.',
  );
}

/**
 * Compose the error message thrown when a user selects
 * `driverProvider: 'external'` on Windows, where the launcher doesn't start
 * wdio-dioxus-driver yet.
 */
export function windowsExternalProviderUnsupported(): Error {
  return new SevereServiceError(
    "driverProvider: 'external' is not supported on Windows in this release: the service " +
      "doesn't start wdio-dioxus-driver yet. Use driverProvider: 'embedded' instead (the " +
      'default, works on all platforms). See https://github.com/webdriverio/desktop-mobile/issues/713.',
  );
}
