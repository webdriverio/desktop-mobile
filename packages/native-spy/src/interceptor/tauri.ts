import type { FrameworkAdapter, InnerMockMethod, InnerMockSetterMethod } from './framework.js';
import { errorReconstructExpr, mockLookupExpr, WDIO_MOCK_SETUP_SCRIPT } from './injection.js';
import type { IpcContext } from './ipcContext.js';
import { buildContextSeedScript } from './ipcContext.js';
import type { SerializedHandler } from './serialize.js';
import { safeJson } from './serialize.js';

export class TauriAdapter implements FrameworkAdapter {
  readonly framework = 'tauri' as const;

  buildRegistrationScript(mockName: string): string {
    return `(_tauri) => {
  const spy = window.__wdio_spy__;
  if (!spy?.fn) { throw new Error('@wdio/native-spy not available. Make sure @wdio/tauri-plugin is imported and initialized in your app.'); }
  const mockFn = spy.fn();
  mockFn.mockName(${JSON.stringify(`tauri.${mockName}`)});
  if (!window.__wdio_mocks__) { window.__wdio_mocks__ = {}; }
  window.__wdio_mocks__[${JSON.stringify(mockName)}] = mockFn;
  mockFn.mockClear();
}`;
  }

  buildCallDataReadScript(mockName: string): string {
    const lookup = mockLookupExpr(mockName);
    return `(_tauri) => {
  const mockObj = ${lookup};
  if (!mockObj?.mock) { return { calls: [], results: [], invocationCallOrder: [] }; }
  const m = mockObj.mock;
  return {
    calls: JSON.parse(JSON.stringify(m.calls || [])),
    results: JSON.parse(JSON.stringify(m.results || [])),
    invocationCallOrder: JSON.parse(JSON.stringify(m.invocationCallOrder || [])),
  };
}`;
  }

  buildSetImplementationScript(mockName: string, s: SerializedHandler, once = false): string {
    const lookup = mockLookupExpr(mockName);
    const method = once ? 'mockImplementationOnce' : 'mockImplementation';
    return `(_tauri) => {
  const mockObj = ${lookup};
  if (mockObj) { mockObj.${method}?.((${s.source})); }
}`;
  }

  buildInnerInvocationScript(mockName: string, method: InnerMockMethod): string {
    const lookup = mockLookupExpr(mockName);
    return `(_tauri) => {
  const mockObj = ${lookup};
  mockObj?.${method}?.();
}`;
  }

  buildInnerSetterScript(mockName: string, method: InnerMockSetterMethod, value: unknown): string {
    const lookup = mockLookupExpr(mockName);
    const serialized = safeJson(value);
    const reconstruct = errorReconstructExpr('_v');
    return `(_tauri) => {
  const _v = ${serialized};
  const mockObj = ${lookup};
  mockObj?.${method}?.(${reconstruct});
}`;
  }

  buildUnregistrationScript(mockName: string): string {
    return `(_tauri) => {
  if (window.__wdio_mocks__?.[${JSON.stringify(mockName)}]) {
    delete window.__wdio_mocks__[${JSON.stringify(mockName)}];
  }
}`;
  }

  buildContextSeedScript(context: IpcContext): string {
    return buildContextSeedScript(context);
  }

  buildBrowserIpcInjectionScript(): string {
    return `(function() {
${WDIO_MOCK_SETUP_SCRIPT}
  if (!window.__TAURI_INTERNALS__) { window.__TAURI_INTERNALS__ = {}; }
  if (!window.__TAURI_INTERNALS__.callbacks) {
    var __wdio_callbacks__ = new Map();
    var __wdio_uid__ = 0;
    window.__TAURI_INTERNALS__.callbacks = __wdio_callbacks__;
    window.__TAURI_INTERNALS__.transformCallback = function(cb, once) {
      var id = ++__wdio_uid__;
      __wdio_callbacks__.set(id, function(data) {
        if (once) { __wdio_callbacks__.delete(id); }
        return cb && cb(data);
      });
      return id;
    };
    window.__TAURI_INTERNALS__.runCallback = function(id, data) {
      var cb = __wdio_callbacks__.get(id);
      if (cb) { cb(data); }
    };
    window.__TAURI_INTERNALS__.unregisterCallback = function(id) {
      __wdio_callbacks__.delete(id);
    };
  }
  if (!window.__wdio_tauri_listeners__) { window.__wdio_tauri_listeners__ = {}; }
  if (typeof window.__wdio_event_id_seq__ !== 'number') { window.__wdio_event_id_seq__ = 0; }
  if (!window.__TAURI_EVENT_PLUGIN_INTERNALS__) {
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: function(event, eventId) {
        var bucket = window.__wdio_tauri_listeners__[event];
        if (bucket) { delete bucket[eventId]; }
      }
    };
  }
  function __wdio_normalize_target__(t) {
    if (t === undefined || t === null) { return { kind: 'Any' }; }
    if (typeof t === 'string') { return { kind: 'AnyLabel', label: t }; }
    return t;
  }
  function __wdio_target_matches__(subscriberTarget, emitTarget) {
    var s = __wdio_normalize_target__(subscriberTarget);
    var e = __wdio_normalize_target__(emitTarget);
    if (s.kind === 'Any' || e.kind === 'Any') { return true; }
    if (s.kind === 'App' || e.kind === 'App') { return s.kind === e.kind; }
    return s.label === e.label;
  }
  window.__wdio_emit_tauri_event__ = function(eventName, payload, target) {
    var bucket = window.__wdio_tauri_listeners__[eventName];
    if (!bucket) { return; }
    var ids = Object.keys(bucket);
    for (var i = 0; i < ids.length; i++) {
      var entry = bucket[ids[i]];
      if (!entry) { continue; }
      if (target !== undefined && !__wdio_target_matches__(entry.target, target)) { continue; }
      window.__TAURI_INTERNALS__.runCallback(entry.handlerId, {
        event: eventName,
        id: Number(ids[i]),
        payload: payload
      });
    }
  };
  function __wdio_handle_plugin_event__(cmd, args) {
    if (cmd === 'plugin:event|listen') {
      var eventId = ++window.__wdio_event_id_seq__;
      var ev = args && args.event;
      if (!window.__wdio_tauri_listeners__[ev]) { window.__wdio_tauri_listeners__[ev] = {}; }
      window.__wdio_tauri_listeners__[ev][eventId] = {
        handlerId: args && args.handler,
        target: args && args.target
      };
      return Promise.resolve(eventId);
    }
    if (cmd === 'plugin:event|unlisten') {
      var ev2 = args && args.event;
      var id = args && args.eventId;
      var bucket = window.__wdio_tauri_listeners__[ev2];
      if (bucket) { delete bucket[id]; }
      return Promise.resolve();
    }
    if (cmd === 'plugin:event|emit') {
      window.__wdio_emit_tauri_event__(args && args.event, args && args.payload);
      return Promise.resolve();
    }
    if (cmd === 'plugin:event|emit_to') {
      window.__wdio_emit_tauri_event__(args && args.event, args && args.payload, args && args.target);
      return Promise.resolve();
    }
    return Promise.resolve();
  }
  window.__TAURI_INTERNALS__.invoke = function(cmd, args, options) {
    var mock = window.__wdio_mocks__ && window.__wdio_mocks__[cmd];
    if (mock && typeof mock === 'function') {
      var mockResult = Promise.resolve().then(function() { return mock(args, options); });
      if (cmd && cmd.indexOf('plugin:event|') === 0) {
        return mockResult.then(function() { return __wdio_handle_plugin_event__(cmd, args); });
      }
      return mockResult;
    }
    if (cmd && cmd.indexOf('plugin:event|') === 0) {
      return __wdio_handle_plugin_event__(cmd, args);
    }
    if (cmd && cmd.indexOf('plugin:') === 0) {
      return Promise.resolve();
    }
    return Promise.reject(new Error('unmocked Tauri command in browser mode: ' + cmd));
  };
})()`;
  }

  buildWithImplementationScript(mockName: string, implFnSource: string, callbackFnSource: string): string {
    const lookup = mockLookupExpr(mockName);
    return `async (_tauri) => {
  const impl = (${implFnSource});
  const callback = (${callbackFnSource});
  let result;
  const mockObj = ${lookup};
  await mockObj?.withImplementation?.(impl, async () => { result = await (_tauri !== undefined ? callback(_tauri) : callback()); });
  return result;
}`;
  }
}
