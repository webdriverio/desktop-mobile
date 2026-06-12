// browser.flutter.execute implementation.
//
// Dart is AOT-compiled, so there's no runtime source eval under a bare Appium (`am start`) launch —
// the VM's compileExpression service is only registered by `flutter run` / `flutter attach`. So
// `execute` is cooperative, the same model as `mock`: the app registers named handlers via
// wdio_flutter's `wdioHandlers`, and `execute('<name>', ...args)` invokes one by name over the
// `ext.wdio.invoke` VM-service extension (args JSON-serialised, result JSON).
//
// If no handler matches the name, it falls back to evaluating the name as a Dart expression (the
// `evaluate` RPC) — which works only when a Dart compiler is attached (you ran `flutter run` /
// `flutter attach`); otherwise it throws clear guidance. Arbitrary-expression eval is the opt-in
// advanced path (see the @wdio/flutter-service README / issue #389).

import type { VmInstanceRef, VmServiceClient } from '../vmService.js';

/** Coerce a Dart VM `@Instance` result to a JS value by kind (primitives), else its string form. */
export function coerceInstance(ref: VmInstanceRef | undefined): unknown {
  if (!ref) {
    return undefined;
  }
  switch (ref.kind) {
    case 'Null':
      return null;
    case 'Bool':
      return ref.valueAsString === 'true';
    case 'Int':
    case 'Double':
      return ref.valueAsString != null ? Number(ref.valueAsString) : undefined;
    case 'String':
      return ref.valueAsString;
    default:
      // Lists/maps/objects come back as their Dart toString() for v1.
      return ref.valueAsString;
  }
}

/** The `ext.wdio.invoke` response: a registered handler ran (`found`), else fall back to eval. */
interface InvokeResult {
  found?: boolean;
  value?: unknown;
  error?: string;
}

function noHandlerError(name: string, detail: string): Error {
  return new Error(
    `browser.flutter.execute: no handler '${name}' is registered, and evaluating it as a Dart ` +
      `expression failed (${detail}). Register a handler in the app — wdioHandlers.register('${name}', ` +
      '...) — or, for arbitrary-expression eval, attach a Dart compiler by running `flutter attach` ' +
      'against the app (see the @wdio/flutter-service README).',
  );
}

/**
 * Run a `browser.flutter.execute` call. Default path: invoke an app-registered handler `name` with
 * `args` (compile-free, over `ext.wdio.invoke`). Fallback: if no handler matches, evaluate `name`
 * as a Dart expression — only works with a compiler attached, else throws clear guidance.
 *
 * @throws if the handler throws, or — on the eval fallback — no handler exists and no compiler is attached.
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

  if (invoked?.found) {
    if (invoked.error != null) {
      throw new Error(`browser.flutter.execute('${name}') threw: ${invoked.error}`);
    }
    return invoked.value as ReturnValue;
  }

  // No registered handler — fall back to evaluating `name` as a Dart expression (the opt-in path).
  const { rootLibraryId } = await client.resolveRootLibrary();
  let result: VmInstanceRef;
  try {
    result = await client.evaluate(isolateId, rootLibraryId, name);
  } catch (error) {
    // The common case: no compiler attached → RPC 113 "No compilation service available" (also any
    // other compile/RPC failure). Guide the user toward a handler or attaching a compiler.
    throw noHandlerError(name, (error as Error).message);
  }
  if (result.type === '@Error' || result.kind === 'Error') {
    // The expression compiled (a compiler is attached) but raised a Dart error at runtime.
    throw new Error(`browser.flutter.execute('${name}') raised a Dart error: ${result.valueAsString ?? 'unknown'}`);
  }
  return coerceInstance(result) as ReturnValue;
}
