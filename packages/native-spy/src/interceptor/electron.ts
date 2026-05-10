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
    throw new Error('unmocked Electron IPC channel in browser mode: ' + channel);
  };
  window.electron.ipcRenderer.sendSync = function(channel) {
    throw new Error('unmocked Electron IPC channel in browser mode: ' + channel);
  };
  window.electron.ipcRenderer.on = function() {};
  window.electron.ipcRenderer.once = function() {};
  window.electron.ipcRenderer.removeListener = function() {};
  window.electron.ipcRenderer.removeAllListeners = function() {};
})()`;
  }
}
