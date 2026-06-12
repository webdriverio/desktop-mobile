// browser.flutter.execute implementation.
//
// Dart is AOT-compiled, so there's no runtime source eval under a bare Appium launch. So `execute`
// is cooperative, the same model as `mock`: the app registers named handlers via wdio_flutter's
// `wdioHandlers`, and `execute('<name>', ...args)` invokes one by name over the `ext.wdio.invoke`
// VM-service extension (args JSON-serialised, result JSON). An unregistered name is an error that
// lists the registered handlers (catching a typo / forgotten register()).
//
// Arbitrary Dart-expression eval is a separate opt-in (attach a Dart compiler) — see issue #389;
// it is NOT a silent fallback here, so a missing handler reports as exactly that.

import type { VmServiceClient } from '../vmService.js';

/** The `ext.wdio.invoke` response: a registered handler ran (`found`), else the registered names. */
interface InvokeResult {
  found?: boolean;
  value?: unknown;
  error?: string;
  registered?: string[];
}

/**
 * Invoke the app-registered Dart handler `name` with positional `args` over `ext.wdio.invoke`.
 *
 * @throws if the handler itself throws, or no handler is registered for `name` — the message lists
 *   the registered handler names. (Arbitrary Dart-expression eval is a separate opt-in; see #389.)
 */
export async function executeScript<ReturnValue = unknown>(
  client: VmServiceClient,
  name: string,
  args: unknown[] = [],
): Promise<ReturnValue> {
  const isolateId = await client.getMainIsolateId();
  const invoked = (await client.callServiceExtension('ext.wdio.invoke', {
    isolateId,
    name,
    args: JSON.stringify(args),
  })) as InvokeResult;

  if (!invoked?.found) {
    const registered = invoked?.registered ?? [];
    const list = registered.length > 0 ? registered.join(', ') : '(none registered)';
    throw new Error(
      `browser.flutter.execute: no handler '${name}' is registered. Registered handlers: ${list}. ` +
        `Register one in the app — wdioHandlers.register('${name}', () => ...).`,
    );
  }
  if (invoked.error != null) {
    throw new Error(`browser.flutter.execute('${name}') threw: ${invoked.error}`);
  }
  return invoked.value as ReturnValue;
}
