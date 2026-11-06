import { hasSemicolonOutsideQuotes, isFunctionSource } from '@wdio/native-utils';
import { RESULT_AS_JSON_JS } from './scripts/result-as-json.js';

/**
 * Wrap a user script for execution via the direct eval channel.
 *
 * Follows the script-wrapping logic in packages/tauri-plugin/guest-js/index.ts:
 * - Function-like scripts receive __wdio_tauri (with mock-routing invoke) as first arg
 * - String scripts are wrapped as async functions with args via apply()
 * - __wdio_original_core__ is used to bypass Proxy invariant issues on macOS
 * - __wdio_mocks__ is checked first for mock routing
 *
 * The output script uses the W3C async-callback contract:
 * arguments[arguments.length - 1] is called with { ok, value, undef } or { ok, error }.
 * When the plugin passes the arguments before the callback, the script uses those instead of `argsJson`.
 * An older plugin passes only the callback.
 */
export function wrapScriptForDirectEval(script: string, argsJson: string): string {
  const trimmed = script.trim();
  const prelude = `var __cb = arguments[arguments.length - 1];
var __wdio_args = arguments.length > 1 ? Array.prototype.slice.call(arguments, 0, -1) : ${argsJson};`;

  // The newline before each closing bracket ends a `//` comment at the end of the script
  if (isFunctionSource(trimmed)) {
    return `${prelude}
(async () => {
  try {
    const __wdio_core_ref = window.__wdio_original_core__;
    let __wdio_invoke_real;
    if (__wdio_core_ref && typeof __wdio_core_ref.invoke === 'function') {
      __wdio_invoke_real = __wdio_core_ref.invoke.bind(__wdio_core_ref);
    } else {
      const startTime = Date.now();
      while (!window.__wdio_original_core__?.invoke && (Date.now() - startTime) < 5000) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const coreRef = window.__wdio_original_core__;
      if (!coreRef?.invoke) throw new Error('Tauri core.invoke not available after 5s timeout. Make sure the page loads @wdio/tauri-plugin and withGlobalTauri is enabled in tauri.conf.json');
      __wdio_invoke_real = coreRef.invoke.bind(coreRef);
    }
    const __wdio_invoke = async function(cmd, invokeArgs) {
      const mocks = window.__wdio_mocks__;
      if (mocks && typeof mocks[cmd] === 'function') {
        return mocks[cmd](invokeArgs);
      }
      return __wdio_invoke_real(cmd, invokeArgs);
    };
    const __wdio_tauri = { core: { invoke: __wdio_invoke } };
    const __result = await (${script}\n)(__wdio_tauri, ...__wdio_args);
    __cb({ ok: true, value: __result === undefined ? null : __result, undef: __result === undefined });
  } catch (e) {
    __cb({ ok: false, error: (e && e.message) || String(e) });
  }
})();`;
  }

  // String scripts cannot receive __wdio_tauri as a named parameter; use window.__TAURI__ directly.
  // Mock routing does not apply here. This matches the IPC path's behaviour for string scripts.
  const hasStatementKeyword = /^(const|let|var|if|for|while|switch|throw|try|do|return)(?=[^\w$]|$)/.test(trimmed);
  const hasStatement = hasStatementKeyword || hasSemicolonOutsideQuotes(trimmed);
  // Trimmed, as a newline right after `return` would end the statement
  const invocation = hasStatement
    ? `(async function() { ${trimmed}\n}).apply(null, __wdio_args)`
    : `(async function() { return ${trimmed}\n; }).apply(null, __wdio_args)`;

  return `${prelude}
(async () => {
  try {
    const __result = await ${invocation};
    __cb({ ok: true, value: __result === undefined ? null : __result, undef: __result === undefined });
  } catch (e) {
    __cb({ ok: false, error: (e && e.message) || String(e) });
  }
})();`;
}

// The plugin runs `__wdio_in.script` in the window `__wdio_in.label` names, or the one calling it without one, and
// reports to `__wdio_done` as the scripts above do. The inputs arrive as data, not source.
const PLUGIN_IPC_JS = `if (typeof window.wdioTauri === 'undefined') {
  __wdio_done({ ok: false, error: 'window.wdioTauri is undefined' });
} else if (typeof window.wdioTauri.execute !== 'function') {
  __wdio_done({ ok: false, error: 'window.wdioTauri.execute is ' + typeof window.wdioTauri.execute });
} else {
  try {
    var options = __wdio_in.label ? { windowLabel: __wdio_in.label } : {};
    window.wdioTauri.execute(__wdio_in.script, options, __wdio_in.argsJson).then(
      function (v) {
        var undef = v === undefined || (v !== null && typeof v === 'object' && v.__wdio_undefined__ === true);
        __wdio_done({ ok: true, value: undef ? null : v, undef: undef });
      },
      function (e) {
        __wdio_done({ ok: false, error: (e && e.message) || String(e) });
      }
    );
  } catch (e) {
    __wdio_done({ ok: false, error: (e && e.message) || String(e) });
  }
}`;

// For the service's own scripts on the external and CrabNebula providers: they never need element references, and
// the plugin answers at once in a frame or page without it, where a script run in the page would wait for it.
// Both wrappers send their inputs inside one object or array argument, as CrabNebula's macOS driver throws on a `null`
// argument.
export function wrapScriptForPluginIpc(
  script: string,
  argsJson: string,
  windowLabel?: string,
): { script: string; args: unknown[] } {
  return {
    script: `var __wdio_done = arguments[arguments.length - 1];
var __wdio_in = arguments[0];
${PLUGIN_IPC_JS}`,
    args: [{ label: windowLabel, script, argsJson }],
  };
}

// For browser.tauri.execute() on the external and CrabNebula providers. The script runs in the session's current
// webview, with the user's arguments in one array argument, so the driver turns references in them into elements and
// DOM nodes in the result into references. A script for another window goes through the plugin's IPC, as a reference
// only works in the window it came from. The page decides, as only it knows which webview the session is in.
export function wrapScriptForWebDriver(
  script: string,
  userArgs: unknown[],
  windowLabel?: string,
): { script: string; args: unknown[] } {
  const inPage = (argsExpression: string) => `${RESULT_AS_JSON_JS}
(function () {
${wrapScriptForDirectEval(script, '[]')}
}).apply(null, ${argsExpression}.concat([function (r) {
  __wdio_done(r.ok ? { ok: true, value: __wdio_asJson(r.value), undef: r.undef } : r);
}]));`;
  if (windowLabel === undefined) {
    return {
      script: `var __wdio_done = arguments[arguments.length - 1];
${inPage('arguments[0]')}`,
      args: [userArgs],
    };
  }

  // The plugin looks a window up by its webview's label.
  return {
    script: `var __wdio_done = arguments[arguments.length - 1];
var __wdio_in = arguments[0];
var __wdio_meta = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.metadata;
if (__wdio_meta && __wdio_meta.currentWebview && __wdio_meta.currentWebview.label === __wdio_in.label) {
  (function (__wdio_userArgs) {
${inPage('__wdio_userArgs')}
  })(arguments[1]);
} else {
${PLUGIN_IPC_JS}
}`,
    args: [{ label: windowLabel, script, argsJson: JSON.stringify(userArgs) }, userArgs],
  };
}
