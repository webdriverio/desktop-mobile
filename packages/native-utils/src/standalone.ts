import type { StandaloneSessionOptions } from '@wdio/native-types';

/** The request timeout for a standalone `remote()` call: WebdriverIO's default unless the caller sets one. */
export function standaloneRequestTimeout(options?: StandaloneSessionOptions): StandaloneSessionOptions {
  return options?.connectionRetryTimeout === undefined
    ? {}
    : { connectionRetryTimeout: options.connectionRetryTimeout };
}
