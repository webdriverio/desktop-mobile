// browser.reactNative.execute implementation.
//
// React Native's `execute`/`mock` run in the app's Hermes JS realm over the CDP
// bridge's `Runtime.evaluate` (Metro inspector-proxy). A string-built *synchronous*
// IIFE is built from the user's function source, with args inlined as JSON literals.
// The realm itself (`globalThis` in Hermes — `nativeModuleProxy`, `HermesInternal`)
// is passed as the callback's first argument.
//
// Why synchronous (not an async IIFE): Hermes' `Runtime.evaluate` cannot compile
// `async` source — Metro/Babel transpiles async away before it ever reaches Hermes,
// so raw `async`/`await` sent over CDP is a compile error ("async functions are
// unsupported"). And RN installs a polyfilled `Promise` whose internal slots CDP
// `awaitPromise` can't unwrap, so a returned promise comes back as its raw internals
// rather than the resolved value. The wrapper — and therefore user callbacks — must
// be synchronous in the RN realm.
//
// Invariant: only `Runtime.evaluate` — never `Page.navigate`.

import type { CdpBridge } from '@wdio/native-cdp-bridge';
import type { ReactNativeAPIs, ReactNativeExecuteOptions } from '@wdio/native-types';
import { hasSemicolonOutsideQuotes } from '@wdio/native-utils';

/** True for the per-call options object (the `__wdioOptions__` sentinel set by withExecuteOptions). */
export function isExecuteOptions(arg: unknown): arg is ReactNativeExecuteOptions {
  return typeof arg === 'object' && arg !== null && '__wdioOptions__' in arg;
}

interface RemoteObject {
  type?: string;
  value?: unknown;
  description?: string;
}

interface EvaluateResponse {
  result?: RemoteObject;
  exceptionDetails?: {
    text?: string;
    exception?: { description?: string; value?: unknown };
  };
}

/**
 * Serialise a value to a JS literal for inlining into evaluated source, rejecting
 * anything `JSON.stringify` would silently drop or choke on.
 *
 * @param context - caller label for the error message (e.g. `browser.reactNative.execute`).
 * @param index - optional positional index appended to the error message.
 */
export function jsonLiteral(value: unknown, context: string, index?: number): string {
  const at = index === undefined ? '' : ` at index ${index}`;
  // JSON.stringify(fn)/JSON.stringify(symbol) returns `undefined` rather than
  // throwing — that would silently drop the value, so reject it up front.
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new Error(
      `${context}${at} is not JSON-serialisable ` +
        `(a ${typeof value} cannot be inlined into the evaluated source; JSON.stringify would silently drop it).`,
    );
  }
  try {
    // Escape JS line terminators (legal raw in JSON since ES2019) and `<` before
    // inlining the JSON.stringify output into evaluated source — a regex guard
    // alone does not clear CodeQL js/bad-code-sanitization for this sink.
    return (JSON.stringify(value) ?? 'undefined')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
      .replace(/</g, '\\u003C');
  } catch (err) {
    throw new Error(
      `${context}${at} is not JSON-serialisable ` +
        '(values are inlined into the evaluated source via JSON.stringify). This usually means a ' +
        `circular reference, a BigInt, or a function. Underlying error: ${(err as Error).message}`,
    );
  }
}

function inlineArgs(args: unknown[]): string {
  return args.map((arg, index) => jsonLiteral(arg, 'browser.reactNative.execute argument', index)).join(', ');
}

const STATEMENT_KEYWORD = /^(const|let|var|if|for|while|switch|throw|try|do|return|function)(?=[^\w$]|$)/;

/**
 * Wrap a string script for `Runtime.evaluate`, mirroring the convergent execute
 * surface: a statement-style script (leading `return`/`const`/… or multiple
 * statements) becomes a function body; anything else is treated as an expression
 * and returned. So `return 42`, `const x = …; return x`, and bare `1 + 2` all
 * yield their value.
 */
function wrapStringScript(script: string): string {
  const trimmed = script.trim();
  if (STATEMENT_KEYWORD.test(trimmed) || hasSemicolonOutsideQuotes(trimmed)) {
    return `(function () { ${script} })()`;
  }
  return `(function () { return (${script}); })()`;
}

/**
 * Evaluate a raw JS expression in the Hermes realm and return its
 * (returned-by-value) result. Centralises `Runtime.evaluate` + exception handling
 * for `execute` and the mock layer.
 */
export async function evaluateInRealm<ReturnValue>(
  bridge: CdpBridge,
  expression: string,
  context = 'browser.reactNative.execute',
): Promise<ReturnValue> {
  const response = (await bridge.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as EvaluateResponse;

  if (response.exceptionDetails) {
    const detail =
      response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'Unknown evaluation error';
    throw new Error(`${context} failed: ${detail}`);
  }

  return response.result?.value as ReturnValue;
}

/**
 * Run a user function (or raw expression string) in the app's Hermes realm and
 * return its (JSON-serialisable) result.
 *
 * Function form: the source is wrapped in a synchronous IIFE that passes the Hermes
 * realm (`globalThis`) as the first arg, then the inlined user args. String form:
 * wrapped via `wrapStringScript` so both a bare expression and a statement body
 * return their value. The wrapper is synchronous (and so user callbacks must be too)
 * because Hermes can't eval async source — see the file header.
 */
export async function executeScript<ReturnValue, InnerArguments extends unknown[] = unknown[]>(
  bridge: CdpBridge,
  script: string | ((rn: ReactNativeAPIs, ...args: InnerArguments) => ReturnValue),
  ...args: InnerArguments
): Promise<ReturnValue> {
  // Strip the per-call options sentinel (RN has no per-call options yet, but the
  // overload accepts one) so it isn't inlined as a positional arg and shift the user's.
  const innerArgs = (isExecuteOptions(args[0]) ? args.slice(1) : args) as InnerArguments;
  const expression =
    typeof script === 'function'
      ? `(function () {
          var userFn = (${script.toString()});
          var rn = globalThis;
          return userFn(rn, ${inlineArgs(innerArgs)});
        })()`
      : wrapStringScript(script);

  return evaluateInRealm<ReturnValue>(bridge, expression);
}
