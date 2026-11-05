import { hasSemicolonOutsideQuotes, isFunctionSource } from '@wdio/native-utils';

/**
 * Wrap a user script for execution via the direct eval channel.
 *
 * Mirrors the script-wrapping logic in packages/tauri-plugin/guest-js/index.ts
 * to produce behaviorally identical output:
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
      if (!coreRef?.invoke) throw new Error('Tauri core.invoke not available after 5s timeout. Make sure withGlobalTauri is enabled in tauri.conf.json');
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
  const invocation = hasStatement
    ? `(async function() { ${script} }).apply(null, __wdio_args)`
    : `(async function() { return ${script}; }).apply(null, __wdio_args)`;

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

/**
 * Wrap a user script for WebDriver's Execute Async Script on the external and CrabNebula providers.
 *
 * The script runs in the session's current window, so the driver returns DOM elements as references. A script for
 * another window goes through the plugin's IPC, because a reference only works in the window it came from. Both
 * report to the callback as {@link wrapScriptForDirectEval} does.
 */
export function wrapScriptForWebDriver(
  script: string,
  argsJson: string,
  windowLabel?: string,
): { script: string; args: string[] } {
  const inPage = wrapScriptForDirectEval(script, argsJson);
  if (windowLabel === undefined) {
    return { script: inPage, args: [] };
  }

  // The label and the plugin's inputs travel as arguments, not source. The in-page script is a function expression,
  // not an arrow, so it reads the callback from its own `arguments`.
  return {
    script: `var __wdio_done = arguments[arguments.length - 1];
var __wdio_label = arguments[0];
var __wdio_meta = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.metadata;
if (__wdio_meta && __wdio_meta.currentWindow && __wdio_meta.currentWindow.label === __wdio_label) {
  (function () {
${inPage}
  })(__wdio_done);
} else {
  try {
    window.wdioTauri.execute(arguments[1], { windowLabel: __wdio_label }, arguments[2]).then(
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
