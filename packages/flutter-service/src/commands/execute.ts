// browser.flutter.execute implementation.
//
// Flutter has no JS realm — `execute` evaluates a **Dart expression string** in the app's
// root library via the Dart VM Service `evaluate` RPC (the documented divergence from the
// JS-realm services). Primitive results are coerced to JS by their Dart kind; richer
// objects come back as their Dart `toString()`.
//
// (Positional args / a `scope` binding are a planned enhancement — v1 evaluates the
// expression as written.)

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

/**
 * Evaluate a Dart expression in the app's root isolate and return its (coerced) value.
 *
 * @throws if the expression raises a Dart error or the VM Service rejects the RPC.
 */
export async function executeScript<ReturnValue = unknown>(
  client: VmServiceClient,
  script: string,
): Promise<ReturnValue> {
  const { isolateId, rootLibraryId } = await client.resolveRootLibrary();
  const result = await client.evaluate(isolateId, rootLibraryId, script);
  if (result.type === '@Error' || result.kind === 'Error') {
    throw new Error(`browser.flutter.execute failed: ${result.valueAsString ?? 'unknown Dart error'}`);
  }
  return coerceInstance(result) as ReturnValue;
}
