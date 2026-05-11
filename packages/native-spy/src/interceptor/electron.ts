import type { FrameworkAdapter, InnerMockMethod, InnerMockSetterMethod } from './framework.js';
import { errorReconstructExpr, mockLookupExpr, WDIO_MOCK_SETUP_SCRIPT } from './injection.js';
import type { IpcContext } from './ipcContext.js';
import { buildContextSeedScript } from './ipcContext.js';
import type { SerializedHandler } from './serialize.js';
import { safeJson } from './serialize.js';

export class ElectronAdapter implements FrameworkAdapter {
  readonly framework = 'electron' as const;

  buildRegistrationScript(mockName: string): string {
    return `(_electron) => {
  const spy = window.__wdio_spy__;
  if (!spy?.fn) { throw new Error('@wdio/native-spy not available. Make sure browser mode is initialized in your test config.'); }
  const mockFn = spy.fn();
  mockFn.mockName(${JSON.stringify(`electron.${mockName}`)});
  if (!window.__wdio_mocks__) { window.__wdio_mocks__ = {}; }
  window.__wdio_mocks__[${JSON.stringify(mockName)}] = mockFn;
  mockFn.mockClear();
}`;
  }

  buildCallDataReadScript(mockName: string): string {
    const lookup = mockLookupExpr(mockName);
    return `(_electron) => {
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
    return `(_electron) => {
  const mockObj = ${lookup};
  if (mockObj) { mockObj.${method}?.((${s.source})); }
}`;
  }

  buildInnerInvocationScript(mockName: string, method: InnerMockMethod): string {
    const lookup = mockLookupExpr(mockName);
    return `(_electron) => {
  const mockObj = ${lookup};
  mockObj?.${method}?.();
}`;
  }

  buildInnerSetterScript(mockName: string, method: InnerMockSetterMethod, value: unknown): string {
    const lookup = mockLookupExpr(mockName);
    const serialized = safeJson(value);
    const reconstruct = errorReconstructExpr('_v');
    return `(_electron) => {
  const _v = ${serialized};
  const mockObj = ${lookup};
  mockObj?.${method}?.(${reconstruct});
}`;
  }

  buildUnregistrationScript(mockName: string): string {
    return `(_electron) => {
  if (window.__wdio_mocks__?.[${JSON.stringify(mockName)}]) {
    delete window.__wdio_mocks__[${JSON.stringify(mockName)}];
  }
}`;
  }

  buildContextSeedScript(context: IpcContext): string {
    return buildContextSeedScript(context);
  }

  buildWithImplementationScript(mockName: string, implFnSource: string, callbackFnSource: string): string {
    const lookup = mockLookupExpr(mockName);
    return `async (_electron) => {
  const impl = (${implFnSource});
  const callback = (${callbackFnSource});
  let result;
  const mockObj = ${lookup};
  await mockObj?.withImplementation?.(impl, async () => { result = await callback(); });
  return result;
}`;
  }

  buildBrowserIpcInjectionScript(): string {
    return `(function() {
${WDIO_MOCK_SETUP_SCRIPT}
  if (!window.electron) { window.electron = {}; }
  if (!window.electron.ipcRenderer) { window.electron.ipcRenderer = {}; }
  window.electron.ipcRenderer.invoke = function(channel) {
    var args = Array.prototype.slice.call(arguments, 1);
    var mock = window.__wdio_mocks__ && window.__wdio_mocks__[channel];
    if (mock && typeof mock === 'function') {
      return Promise.resolve().then(function() { return mock.apply(null, args); });
    }
    return Promise.reject(new Error('unmocked Electron IPC channel in browser mode: ' + channel));
  };
  window.electron.ipcRenderer.send = function(channel) {
    var args = Array.prototype.slice.call(arguments, 1);
    var mock = window.__wdio_mocks__ && window.__wdio_mocks__[channel];
    if (mock && typeof mock === 'function') {
      mock.apply(null, args);
      return;
    }
    throw new Error('unmocked Electron IPC channel in browser mode: ' + channel);
  };
  window.electron.ipcRenderer.sendSync = function(channel) {
    var args = Array.prototype.slice.call(arguments, 1);
    var mock = window.__wdio_mocks__ && window.__wdio_mocks__[channel];
    if (mock && typeof mock === 'function') {
      var result = mock.apply(null, args);
      if (result && typeof result.then === 'function') {
        throw new Error(
          'Electron sendSync mock returned a Promise for channel "' + channel + '". ' +
          'sendSync is synchronous — use mockReturnValue(...) (not mockResolvedValue) ' +
          'or a synchronous mockImplementation.'
        );
      }
      return result;
    }
    throw new Error('unmocked Electron IPC channel in browser mode: ' + channel);
  };
  if (!window.__wdio_electron_listeners__) { window.__wdio_electron_listeners__ = {}; }
  window.electron.ipcRenderer.on = function(channel, fn) {
    if (!window.__wdio_electron_listeners__[channel]) { window.__wdio_electron_listeners__[channel] = []; }
    window.__wdio_electron_listeners__[channel].push({ fn: fn, once: false });
    return window.electron.ipcRenderer;
  };
  window.electron.ipcRenderer.addListener = window.electron.ipcRenderer.on;
  window.electron.ipcRenderer.once = function(channel, fn) {
    if (!window.__wdio_electron_listeners__[channel]) { window.__wdio_electron_listeners__[channel] = []; }
    window.__wdio_electron_listeners__[channel].push({ fn: fn, once: true });
    return window.electron.ipcRenderer;
  };
  window.electron.ipcRenderer.removeListener = function(channel, fn) {
    var bucket = window.__wdio_electron_listeners__[channel];
    if (!bucket) { return window.electron.ipcRenderer; }
    for (var i = 0; i < bucket.length; i++) {
      if (bucket[i].fn === fn) { bucket.splice(i, 1); break; }
    }
    return window.electron.ipcRenderer;
  };
  window.electron.ipcRenderer.off = window.electron.ipcRenderer.removeListener;
  window.electron.ipcRenderer.removeAllListeners = function(channel) {
    if (channel === undefined) {
      window.__wdio_electron_listeners__ = {};
    } else {
      delete window.__wdio_electron_listeners__[channel];
    }
    return window.electron.ipcRenderer;
  };
  window.__wdio_emit_electron_event__ = function(channel) {
    var args = Array.prototype.slice.call(arguments, 1);
    var bucket = window.__wdio_electron_listeners__[channel];
    if (!bucket || bucket.length === 0) { return; }
    var snapshot = bucket.slice();
    for (var i = 0; i < snapshot.length; i++) {
      var entry = snapshot[i];
      if (entry.once) {
        var idx = bucket.indexOf(entry);
        if (idx !== -1) { bucket.splice(idx, 1); }
      }
      var event = { ports: [], sender: window.electron.ipcRenderer, senderId: 0 };
      try { entry.fn.apply(null, [event].concat(args)); } catch (e) { /* don't block other listeners */ }
    }
  };
})()`;
  }
}
