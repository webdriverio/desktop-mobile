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
 */
export function wrapScriptForDirectEval(script: string, argsJson: string): string {
  const trimmed = script.trim();

  if (isFunctionSource(trimmed)) {
    return `var __cb = arguments[arguments.length - 1];
(async () => {
  try {
    const __wdio_args = ${argsJson};
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
      if (!coreRef?.invoke) throw new Error('Tauri core.invoke not available after 5s timeout');
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

  return `var __cb = arguments[arguments.length - 1];
const __wdio_args = ${argsJson};
(async () => {
  try {
    const __result = await ${invocation};
    __cb({ ok: true, value: __result === undefined ? null : __result, undef: __result === undefined });
  } catch (e) {
    __cb({ ok: false, error: (e && e.message) || String(e) });
  }
})();`;
}
