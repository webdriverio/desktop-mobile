import { hasSemicolonOutsideQuotes, isFunctionSource } from '@wdio/native-utils';

/**
 * Wrap a user script for execution via the direct eval channel.
 *
 * Follows the script-wrapping logic in packages/tauri-plugin/guest-js/index.ts, except that it waits for the
 * plugin's core only when the script calls invoke:
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

  if (isFunctionSource(trimmed)) {
    return `${prelude}
(async () => {
  try {
    // Looked up on the first invoke, so a script that never calls it doesn't wait for a page without the plugin
    let __wdio_invoke_real;
    const __wdio_real_invoke = async function() {
      if (!__wdio_invoke_real) {
        const startTime = Date.now();
        while (!window.__wdio_original_core__?.invoke && (Date.now() - startTime) < 5000) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const coreRef = window.__wdio_original_core__;
        if (!coreRef?.invoke) throw new Error('Tauri core.invoke not available after 5s timeout. Make sure the page loads @wdio/tauri-plugin and withGlobalTauri is enabled in tauri.conf.json');
        __wdio_invoke_real = coreRef.invoke.bind(coreRef);
      }
      return __wdio_invoke_real;
    };
    const __wdio_invoke = async function(cmd, invokeArgs) {
      const mocks = window.__wdio_mocks__;
      if (mocks && typeof mocks[cmd] === 'function') {
        return mocks[cmd](invokeArgs);
      }
      return (await __wdio_real_invoke())(cmd, invokeArgs);
    };
    const __wdio_tauri = { core: { invoke: __wdio_invoke } };
    const __result = await (${script})(__wdio_tauri, ...__wdio_args);
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
  // The newline ends a `//` comment at the end of the script
  const invocation = hasStatement
    ? `(async function() { ${script}\n}).apply(null, __wdio_args)`
    : `(async function() { return ${script}\n; }).apply(null, __wdio_args)`;

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

// For the service's own scripts, and a script for another window, on the external and CrabNebula providers. The
// plugin runs the script in the window `windowLabel` names, or the one calling it without one, and answers at once
// in a frame or page without the plugin, where a script run in the page would wait for it.
export function wrapScriptForPluginIpc(
  script: string,
  argsJson: string,
  windowLabel?: string,
): { script: string; args: unknown[] } {
  return {
    script: `var __wdio_done = arguments[arguments.length - 1];
var __wdio_label = arguments[0];
if (typeof window.wdioTauri === 'undefined') {
  __wdio_done({ ok: false, error: 'window.wdioTauri is undefined' });
} else if (typeof window.wdioTauri.execute !== 'function') {
  __wdio_done({ ok: false, error: 'window.wdioTauri.execute is ' + typeof window.wdioTauri.execute });
} else {
  try {
    window.wdioTauri.execute(arguments[1], __wdio_label ? { windowLabel: __wdio_label } : {}, arguments[2]).then(
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
}`,
    args: [windowLabel, script, argsJson],
  };
}

// For browser.tauri.execute() in the session's current window on the external and CrabNebula providers. The user's
// arguments are the script's own, so the driver turns references in them into elements, and DOM nodes in the result
// into references.
export function wrapScriptForWebDriver(script: string, userArgs: unknown[]): { script: string; args: unknown[] } {
  // Results follow JSON, as on the embedded provider and the plugin's IPC, apart from DOM nodes and the lists that
  // hold them, which are left for the driver. The rules are script-result-refs.js's, which the embedded drivers use.
  return {
    script: `var __wdio_done = arguments[arguments.length - 1];
function __wdio_asJson(value) {
  var nodes = [];
  var mark = '__wdio_node_' + Math.random().toString(36).slice(2);
  function isNode(item) {
    // Chromium's <embed> and <object> elements are callable, so their typeof is 'function'
    if (item === null || (typeof item !== 'object' && typeof item !== 'function')) return false;
    return item.nodeType === 1 || (item.nodeType === 11 && !!item.host);
  }
  function listOf(item) {
    if (item === null || typeof item !== 'object' || Array.isArray(item) || typeof item.nodeType === 'number') return undefined;
    if (typeof item[Symbol.iterator] !== 'function' || typeof item.length !== 'number') return undefined;
    return Array.from({ length: item.length }, function (_, i) { return item[i]; });
  }
  var json;
  try {
    json = JSON.stringify(value, function (_key, item) {
      if (isNode(item)) {
        var placeholder = {};
        placeholder[mark] = nodes.push(item) - 1;
        return placeholder;
      }
      var list = listOf(item);
      return list === undefined ? item : list;
    });
  } catch (e) {
    // A result JSON rejects, such as a cycle, goes to the driver as it is, which reports it
    return value;
  }
  if (json === undefined) return null;
  return JSON.parse(json, function (_key, item) {
    return item !== null && typeof item === 'object' && typeof item[mark] === 'number' ? nodes[item[mark]] : item;
  });
}
(function () {
${wrapScriptForDirectEval(script, '[]')}
}).apply(null, Array.prototype.slice.call(arguments, 0, -1).concat([function (r) {
  __wdio_done(r.ok ? { ok: true, value: __wdio_asJson(r.value), undef: r.undef } : r);
}]));`,
    args: userArgs,
  };
}
