import type { FrameworkAdapter, InnerMockMethod, InnerMockSetterMethod } from './framework.js';
import { errorReconstructExpr, mockLookupExpr, WDIO_MOCK_SETUP_SCRIPT } from './injection.js';
import type { IpcContext } from './ipcContext.js';
import { buildContextSeedScript } from './ipcContext.js';
import type { SerializedHandler } from './serialize.js';
import { safeJson } from './serialize.js';

/**
 * Mock interceptor adapter for `@wdio/dioxus-service`.
 *
 * Mirrors {@link import('./tauri.js').TauriAdapter}'s registration / call-
 * data / implementation scripts but targets `window.__WDIO_DIOXUS__.invoke`
 * (installed by `@wdio/dioxus-bridge`) instead of Tauri's
 * `window.__TAURI_INTERNALS__.invoke`. Dioxus has no plugin event-bus
 * equivalent, so `buildBrowserIpcInjectionScript` is much simpler.
 */
export class DioxusAdapter implements FrameworkAdapter {
  readonly framework = 'dioxus' as const;

  buildRegistrationScript(mockName: string): string {
    return `(_dx) => {
  const spy = window.__wdio_spy__;
  if (!spy?.fn) { throw new Error('@wdio/native-spy not available. Ensure @wdio/dioxus-bridge is installed in your Dioxus Config via wdio_dioxus_bridge::install(cfg).'); }
  const mockFn = spy.fn();
  mockFn.mockName(${JSON.stringify(`dioxus.${mockName}`)});
  if (!window.__wdio_mocks__) { window.__wdio_mocks__ = {}; }
  window.__wdio_mocks__[${JSON.stringify(mockName)}] = mockFn;
  mockFn.mockClear();
}`;
  }

  buildCallDataReadScript(mockName: string): string {
    const lookup = mockLookupExpr(mockName);
    return `(_dx) => {
  const mockObj = ${lookup};
  if (!mockObj?.mock) { return { calls: [], results: [], invocationCallOrder: [] }; }
  const m = mockObj.mock;
  const errorReplacer = function(_k, v) {
    if (v instanceof Error) {
      return { __wdioError: true, name: v.name, message: v.message, stack: v.stack };
    }
    return v;
  };
  return {
    calls: JSON.parse(JSON.stringify(m.calls || [], errorReplacer)),
    results: JSON.parse(JSON.stringify(m.results || [], errorReplacer)),
    invocationCallOrder: JSON.parse(JSON.stringify(m.invocationCallOrder || [])),
  };
}`;
  }

  buildSetImplementationScript(mockName: string, s: SerializedHandler, once = false): string {
    const lookup = mockLookupExpr(mockName);
    const method = once ? 'mockImplementationOnce' : 'mockImplementation';
    return `(_dx) => {
  const mockObj = ${lookup};
  if (mockObj) { mockObj.${method}?.((${s.source})); }
}`;
  }

  buildInnerInvocationScript(mockName: string, method: InnerMockMethod): string {
    const lookup = mockLookupExpr(mockName);
    return `(_dx) => {
  const mockObj = ${lookup};
  mockObj?.${method}?.();
}`;
  }

  buildInnerSetterScript(mockName: string, method: InnerMockSetterMethod, value: unknown): string {
    const lookup = mockLookupExpr(mockName);
    const serialized = safeJson(value);
    const reconstruct = errorReconstructExpr('_v');
    return `(_dx) => {
  const _v = ${serialized};
  const mockObj = ${lookup};
  mockObj?.${method}?.(${reconstruct});
}`;
  }

  buildUnregistrationScript(mockName: string): string {
    return `(_dx) => {
  if (window.__wdio_mocks__?.[${JSON.stringify(mockName)}]) {
    delete window.__wdio_mocks__[${JSON.stringify(mockName)}];
  }
}`;
  }

  buildContextSeedScript(context: IpcContext): string {
    return buildContextSeedScript(context);
  }

  /**
   * Browser-context init script. Sets up `window.__wdio_spy__` /
   * `window.__wdio_mocks__` and patches `window.__WDIO_DIOXUS__.invoke` so
   * registered mocks intercept calls before they hit the bridge's
   * `wdio://invoke` protocol.
   */
  buildBrowserIpcInjectionScript(): string {
    return `(function() {
${WDIO_MOCK_SETUP_SCRIPT}
  if (!window.__WDIO_DIOXUS__) { window.__WDIO_DIOXUS__ = {}; }
  var __wdio_original_invoke__ = window.__WDIO_DIOXUS__.invoke;
  window.__WDIO_DIOXUS__.invoke = function(cmd, args) {
    var mock = window.__wdio_mocks__ && window.__wdio_mocks__[cmd];
    if (mock && typeof mock === 'function') {
      return Promise.resolve().then(function() { return mock(args); });
    }
    if (typeof __wdio_original_invoke__ === 'function') {
      return __wdio_original_invoke__(cmd, args);
    }
    return Promise.reject(new Error('unmocked Dioxus command and no bridge invoke installed: ' + cmd));
  };
})()`;
  }

  buildWithImplementationScript(mockName: string, implFnSource: string, callbackFnSource: string): string {
    const lookup = mockLookupExpr(mockName);
    return `async (_dx) => {
  const impl = (${implFnSource});
  const callback = (${callbackFnSource});
  let result;
  const mockObj = ${lookup};
  await mockObj?.withImplementation?.(impl, async () => { result = await (_dx !== undefined ? callback(_dx) : callback()); });
  return result;
}`;
  }
}
