// The user's code runs once, in the bridge's active target, over `Runtime.evaluate` or, on Linux, its W3C
// stand-in.
//
// Invariant: this never issues Page.navigate — the bridge only enables Runtime
// on the live target (see @wdio/native-cdp-bridge).

import { randomUUID } from 'node:crypto';

import type { MultiTargetCdpBridge as CdpBridge } from '@wdio/native-cdp-bridge';
import type { ElectrobunAPIs, Result } from '@wdio/native-types';
import { errorMessage, hasSemicolonOutsideQuotes } from '@wdio/native-utils';

import { STASH_NODES_JS } from './stashNodes.js';

export type StashedNodeResolver = (stash: string) => Promise<Result<unknown[]>>;

// Reads the nodes a script left on `window[stash]` through the WebDriver session, which returns them as
// references. syncWebDriverWindow keeps the session on the bridge's active target, where they were left.
export function stashedNodeResolver(browser: WebdriverIO.Browser): StashedNodeResolver {
  return async (stash) => {
    let refs: unknown;
    try {
      refs = await browser.execute(
        'var nodes = window[arguments[0]]; delete window[arguments[0]]; return nodes;',
        stash,
      );
    } catch (error) {
      const message = `browser.electrobun.execute could not return the result's DOM nodes: ${errorMessage(error)}`;
      return { ok: false, error: new Error(message, { cause: error }) };
    }
    if (!Array.isArray(refs)) {
      const message =
        "browser.electrobun.execute returned DOM nodes, but the WebDriver session couldn't find them: it isn't on " +
        'the window or frame the script ran in, or the page navigated first. Switch windows with ' +
        'browser.electrobun.switchWindow(), and leave a frame with browser.switchFrame(null).';
      return { ok: false, error: new Error(message) };
    }
    return { ok: true, value: refs };
  };
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
 * Serialise a value to a JS literal for inlining into a script source, rejecting
 * anything `JSON.stringify` would silently drop or choke on. Shared by `execute`
 * (user args) and the mock layer (impl/return values pushed into the page).
 *
 * @param context - caller label used in the error message (e.g. `browser.electrobun.execute`).
 * @param index - optional positional index appended to the error message.
 */
export function jsonLiteral(value: unknown, context: string, index?: number): string {
  const at = index === undefined ? '' : ` at index ${index}`;
  // JSON.stringify(fn) / JSON.stringify(symbol) returns `undefined` rather than
  // throwing, which would silently drop the value — reject those up front.
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new Error(
      `${context}${at} is not JSON-serialisable ` +
        `(a ${typeof value} cannot be inlined into the script source; JSON.stringify would silently drop it).`,
    );
  }
  try {
    // JSON.stringify leaves U+2028/U+2029 raw (legal JSON since ES2019); escape
    // them for the JS-source inlining context — same treatment as pathLiteral.
    return (JSON.stringify(value) ?? 'undefined').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  } catch (err) {
    throw new Error(
      `${context}${at} is not JSON-serialisable ` +
        '(values are inlined into the script source via JSON.stringify). This typically means the ' +
        `value contains a circular reference, a BigInt, or a function. Underlying error: ${(err as Error).message}`,
    );
  }
}

// A string as a literal in script source. The names this inlines are our own, so the escaping changes
// nothing, but it's what CodeQL's js/bad-code-sanitization recognises: JSON.stringify leaves U+2028,
// U+2029 and `<` raw.
function sourceLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/</g, '\\x3C');
}

function inlineArgs(args: unknown[]): string {
  return args.map((arg, index) => jsonLiteral(arg, 'browser.electrobun.execute argument', index)).join(', ');
}

const STATEMENT_KEYWORD = /^(const|let|var|if|for|while|switch|throw|try|do|return)(?=[^\w$]|$)/;

/**
 * Wrap a string script for `Runtime.evaluate`, mirroring `@wdio/electron-service`:
 * a statement-style script (leading keyword like `return`/`const`, or multiple
 * statements separated by a real `;`) becomes a function body; anything else is
 * treated as an expression and `return`ed. This lets callers write `return 42`,
 * `const x = …; return x`, or a bare `1 + 2` and get the value back either way —
 * matching the convergent execute surface across services.
 */
function wrapStringScript(script: string): string {
  const trimmed = script.trim();
  // The newline ends a `//` comment at the end of the script
  if (STATEMENT_KEYWORD.test(trimmed) || hasSemicolonOutsideQuotes(trimmed)) {
    return `(async function () { ${script}\n})()`;
  }
  return `(async function () { return (${script}\n); })()`;
}

/**
 * Evaluate a raw JS expression in the active CEF content target and return its
 * (returned-by-value) result. Centralises `Runtime.evaluate` + exception
 * handling for both `execute` and the mock layer. Never issues Page.navigate.
 */
export async function evaluateInActiveTarget<ReturnValue>(
  bridge: CdpBridge,
  expression: string,
  context = 'browser.electrobun.execute',
): Promise<ReturnValue> {
  return evaluatedValue<ReturnValue>(await sendEvaluate(bridge, expression), context);
}

function sendEvaluate(bridge: CdpBridge, expression: string): Promise<EvaluateResponse> {
  return bridge.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }) as Promise<EvaluateResponse>;
}

function evaluatedValue<ReturnValue>(response: EvaluateResponse, context: string): ReturnValue {
  if (response.exceptionDetails) {
    const detail =
      response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'Unknown evaluation error';
    throw new Error(`${context} failed: ${detail}`);
  }
  return response.result?.value as ReturnValue;
}

function isStashEnvelope(value: unknown, mark: string): value is Record<string, unknown> & { value: unknown } {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)[mark] === 'number';
}

function replacePlaceholders(value: unknown, mark: string, refs: unknown[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholders(item, mark, refs));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === mark) {
    return refs[record[mark] as number];
  }
  return Object.fromEntries(keys.map((key) => [key, replacePlaceholders(record[key], mark, refs)]));
}

// Callers don't wait for this: the connection that just failed, or a busy renderer, could stall it.
async function discardStashedNodes(bridge: CdpBridge, stash: string): Promise<void> {
  try {
    await bridge.send('Runtime.evaluate', { expression: `delete window[${sourceLiteral(stash)}]` });
  } catch {
    // Best effort: the page drops the nodes when it navigates
  }
}

async function withElementReferences(
  result: unknown,
  mark: string,
  stash: string,
  bridge: CdpBridge,
  resolveNodes: StashedNodeResolver,
): Promise<unknown> {
  if (!isStashEnvelope(result, mark)) {
    return result;
  }
  const refs = await resolveNodes(stash);
  if (!refs.ok) {
    void discardStashedNodes(bridge, stash);
    throw refs.error;
  }
  return replacePlaceholders(result.value, mark, refs.value);
}

/**
 * Run a user function (or raw expression string) in the active Electrobun content
 * target and return its result. DOM elements and shadow roots in the result come
 * back as W3C references, as `browser.execute()` returns them.
 *
 * Function form: the source is wrapped in an async IIFE that passes
 * `window.__WDIO_ELECTROBUN__` (defaulting to `{}`) as the first arg, then the
 * inlined user args. String form: wrapped via `wrapStringScript` so both a bare
 * expression (`1 + 2`) and a statement body (`return 42`, `const x = …; return x`)
 * return their value — matching the convergent execute surface.
 */
export async function execute<ReturnValue, InnerArguments extends unknown[] = unknown[]>(
  bridge: CdpBridge,
  resolveNodes: StashedNodeResolver,
  script: string | ((eb: ElectrobunAPIs, ...args: InnerArguments) => ReturnValue),
  ...args: InnerArguments
): Promise<Awaited<ReturnValue>> {
  const token = randomUUID().replace(/-/g, '');
  const mark = `__wdio_node_${token}__`;
  const stash = `__wdio_electrobun_nodes_${token}`;
  const run =
    typeof script === 'function'
      ? `(async () => {
          const userFn = (${script.toString()});
          const eb = window.__WDIO_ELECTROBUN__ || {};
          return await userFn(eb, ${inlineArgs(args)});
        })()`
      : wrapStringScript(script);
  // The helper goes after the user's code, so line numbers in the user's errors still match their script
  const expression = `(async () => { return __wdioStashNodes(await ${run}, ${sourceLiteral(stash)}, ${sourceLiteral(mark)});
${STASH_NODES_JS}
})()`;

  let response: EvaluateResponse;
  try {
    response = await sendEvaluate(bridge, expression);
  } catch (error) {
    // Unlike a script error, a failed call can leave a stash, as when the response fails after the script ran
    void discardStashedNodes(bridge, stash);
    throw error;
  }
  const result = evaluatedValue<unknown>(response, 'browser.electrobun.execute');
  return (await withElementReferences(result, mark, stash, bridge, resolveNodes)) as Awaited<ReturnValue>;
}
