// browser.electrobun.execute implementation. The user's code runs once, in the bridge's active target,
// via `Runtime.evaluate` (or its W3C stand-in on Linux).
//
// Invariant: this never issues Page.navigate — the bridge only enables Runtime
// on the live target (see @wdio/native-cdp-bridge).

import { randomUUID } from 'node:crypto';

import type { MultiTargetCdpBridge as CdpBridge } from '@wdio/native-cdp-bridge';
import type { ElectrobunAPIs } from '@wdio/native-types';
import { errorMessage, hasSemicolonOutsideQuotes } from '@wdio/native-utils';

import { STASH_NODES_JS } from './stashNodes.js';

export type StashedNodeResolver = (stash: string) => Promise<unknown>;

// Reads the nodes a script left on `window[stash]` through the WebDriver session, which returns them as
// references. syncWebDriverWindow keeps the session on the bridge's active target, where they were left.
export function stashedNodeResolver(browser: WebdriverIO.Browser): StashedNodeResolver {
  return (stash) =>
    browser.execute('var nodes = window[arguments[0]]; delete window[arguments[0]]; return nodes;', stash);
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
  if (STATEMENT_KEYWORD.test(trimmed) || hasSemicolonOutsideQuotes(trimmed)) {
    return `(async function () { ${script} })()`;
  }
  return `(async function () { return (${script}); })()`;
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

// `label` is the target the script ran in, which switchWindow() may have moved the bridge away from
async function discardStashedNodes(bridge: CdpBridge, label: string | undefined, stash: string): Promise<void> {
  const params = { expression: `delete window[${JSON.stringify(stash)}]` };
  try {
    await (label ? bridge.sendTo(label, 'Runtime.evaluate', params) : bridge.send('Runtime.evaluate', params));
  } catch {
    // Best effort: the page drops the nodes when it navigates
  }
}

async function withElementReferences(
  result: unknown,
  mark: string,
  stash: string,
  bridge: CdpBridge,
  label: string | undefined,
  resolveNodes: StashedNodeResolver,
): Promise<unknown> {
  if (!isStashEnvelope(result, mark)) {
    return result;
  }
  if (result[mark] === 0) {
    return result.value;
  }
  let refs: unknown;
  try {
    refs = await resolveNodes(stash);
  } catch (error) {
    await discardStashedNodes(bridge, label, stash);
    throw new Error(`browser.electrobun.execute could not return the result's DOM nodes: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  if (!Array.isArray(refs)) {
    await discardStashedNodes(bridge, label, stash);
    throw new Error(
      "browser.electrobun.execute returned DOM nodes, but the WebDriver session isn't on the window or frame " +
        'the script ran in, so they have no element references there. Switch windows with ' +
        'browser.electrobun.switchWindow(), and leave a frame with browser.switchFrame(null).',
    );
  }
  return replacePlaceholders(result.value, mark, refs);
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
  const expression = `(async () => {
    ${STASH_NODES_JS}
    return __wdioStashNodes(await ${run}, ${JSON.stringify(stash)}, ${JSON.stringify(mark)});
  })()`;

  const label = bridge.activeLabel;
  let result: unknown;
  try {
    result = await evaluateInActiveTarget<unknown>(bridge, expression);
  } catch (error) {
    // The page may have stashed nodes before the call failed, e.g. on a timeout. Don't wait on the cleanup:
    // the connection that just failed could make it fail slowly too.
    void discardStashedNodes(bridge, label, stash);
    throw error;
  }
  return (await withElementReferences(result, mark, stash, bridge, label, resolveNodes)) as Awaited<ReturnValue>;
}
