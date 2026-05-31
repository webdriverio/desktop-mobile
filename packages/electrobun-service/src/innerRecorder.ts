// Inner-recorder script builders for the Electrobun mock layer.
//
// Electrobun has no enumerable main-process API, so `browser.electrobun.mock`
// targets a *dotted path to a function in the webview global scope* (e.g.
// 'api.fetchData' → window.api.fetchData) — the in-page analogue of Electron's
// browser-mode IPC-channel mock. These builders return JS expression strings
// that the worker evaluates over CDP via `Runtime.evaluate` (see
// commands/execute.ts#evaluateInActiveTarget). They never navigate the page.
//
// All recorders live under a single registry, window.__WDIO_ELECTROBUN_MOCKS__,
// keyed by target path. Each entry preserves the original function so
// mockRestore can put it back exactly where it was. The recorder function itself
// is a vitest-shaped spy whose call/result history is read back one-way into the
// outer mock by buildReadCallDataScript (mirrors the inner spy in
// @wdio/native-spy's WDIO_MOCK_SETUP_SCRIPT).
//
// The string semantics here are exercised end-to-end only against a real CEF app
// (no CEF in unit tests) — unit tests assert the *expressions* we emit, not their
// in-page behaviour. See test/mock.spec.ts.

import type { InnerMockSetterMethod } from './mockTypes.js';

const REGISTRY = 'window.__WDIO_ELECTROBUN_MOCKS__';

/** JSON literal of a target path, safe to inline as an object key / string arg. */
function pathLiteral(target: string): string {
  return JSON.stringify(target);
}

/**
 * Self-contained spy factory + registry setup. Idempotent: re-evaluating leaves
 * an existing registry and any already-installed recorders untouched. Mirrors the
 * mock-function shape used across the other services so call-data read-back is
 * identical (calls / results / invocationCallOrder).
 */
const SETUP = `
  if (!${REGISTRY}) { ${REGISTRY} = {}; }
  var __ebReg = ${REGISTRY};
  if (!__ebReg.__callId) { __ebReg.__callId = 0; }
  if (!__ebReg.__createSpy) {
    var NOT_SET = {};
    __ebReg.__createSpy = function() {
      var _defaultImpl;
      var _implQueue = [];
      var _defaultReturnValue = NOT_SET;
      var _defaultResolvedValue = NOT_SET;
      var _defaultRejectedValue = NOT_SET;
      var _returnThis = false;
      var _calls = [];
      var _results = [];
      var _invocationCallOrder = [];
      function spy() {
        var args = Array.prototype.slice.call(arguments);
        _calls.push(args);
        _invocationCallOrder.push(__ebReg.__callId++);
        var impl = _implQueue.length > 0 ? _implQueue.shift() : _defaultImpl;
        if (impl !== null && impl !== undefined && typeof impl === 'object' && impl.__wdioType) {
          if (impl.__wdioType === 'resolve') {
            _results.push({ type: 'return', value: impl.__wdioVal });
            return Promise.resolve(impl.__wdioVal);
          }
          _results.push({ type: 'throw', value: impl.__wdioVal });
          return Promise.reject(impl.__wdioVal);
        }
        if (impl !== undefined) {
          try {
            var val = impl.apply(this, args);
            _results.push({ type: 'return', value: val });
            return val;
          } catch (e) {
            _results.push({ type: 'throw', value: e });
            throw e;
          }
        } else if (_defaultRejectedValue !== NOT_SET) {
          _results.push({ type: 'throw', value: _defaultRejectedValue });
          return Promise.reject(_defaultRejectedValue);
        } else if (_defaultResolvedValue !== NOT_SET) {
          _results.push({ type: 'return', value: _defaultResolvedValue });
          return Promise.resolve(_defaultResolvedValue);
        } else if (_returnThis) {
          _results.push({ type: 'return', value: this });
          return this;
        } else if (_defaultReturnValue !== NOT_SET) {
          _results.push({ type: 'return', value: _defaultReturnValue });
          return _defaultReturnValue;
        } else {
          _results.push({ type: 'return', value: undefined });
          return undefined;
        }
      }
      spy.__isWdioSpy = true;
      spy.mock = { calls: _calls, results: _results, invocationCallOrder: _invocationCallOrder };
      spy.mockImplementation = function(fn) {
        _defaultImpl = fn; _defaultReturnValue = NOT_SET; _defaultResolvedValue = NOT_SET;
        _defaultRejectedValue = NOT_SET; _returnThis = false; return spy;
      };
      spy.mockImplementationOnce = function(fn) { _implQueue.push(fn); return spy; };
      spy.mockReturnValue = function(v) {
        _defaultImpl = undefined; _defaultReturnValue = v; _defaultResolvedValue = NOT_SET;
        _defaultRejectedValue = NOT_SET; _returnThis = false; return spy;
      };
      spy.mockReturnValueOnce = function(v) { _implQueue.push(function() { return v; }); return spy; };
      spy.mockResolvedValue = function(v) {
        _defaultImpl = undefined; _defaultResolvedValue = v; _defaultReturnValue = NOT_SET;
        _defaultRejectedValue = NOT_SET; _returnThis = false; return spy;
      };
      spy.mockResolvedValueOnce = function(v) { _implQueue.push({ __wdioType: 'resolve', __wdioVal: v }); return spy; };
      spy.mockRejectedValue = function(v) {
        _defaultImpl = undefined; _defaultRejectedValue = v; _defaultReturnValue = NOT_SET;
        _defaultResolvedValue = NOT_SET; _returnThis = false; return spy;
      };
      spy.mockRejectedValueOnce = function(v) { _implQueue.push({ __wdioType: 'reject', __wdioVal: v }); return spy; };
      spy.mockReturnThis = function() {
        _returnThis = true; _defaultReturnValue = NOT_SET; _defaultResolvedValue = NOT_SET;
        _defaultRejectedValue = NOT_SET; _defaultImpl = undefined; return spy;
      };
      spy.mockClear = function() {
        _calls.length = 0; _results.length = 0; _invocationCallOrder.length = 0; return spy;
      };
      spy.mockReset = function() {
        spy.mockClear();
        _implQueue = []; _defaultImpl = undefined; _defaultReturnValue = NOT_SET;
        _defaultResolvedValue = NOT_SET; _defaultRejectedValue = NOT_SET; _returnThis = false; return spy;
      };
      return spy;
    };
  }`;

/** Walk a dotted path to its `{ parent, key }`, returning undefined if any hop is missing. */
const RESOLVE_PATH = `
    var __resolve = function(path) {
      var parts = path.split('.');
      var parent = window;
      for (var i = 0; i < parts.length - 1; i++) {
        if (parent == null) { return undefined; }
        parent = parent[parts[i]];
      }
      if (parent == null) { return undefined; }
      return { parent: parent, key: parts[parts.length - 1] };
    };`;

/**
 * Install (idempotently) a recorder over the target function. Preserves the
 * original on the registry entry, replaces `parent[key]` with the spy, and
 * throws inside the page if the path doesn't resolve to a function. Re-running
 * with an existing entry is a no-op (no double-wrap).
 */
export function buildInstallScript(target: string): string {
  const key = pathLiteral(target);
  return `(function() {${SETUP}${RESOLVE_PATH}
    var existing = __ebReg[${key}];
    if (existing) { return; }
    var loc = __resolve(${key});
    if (!loc) {
      throw new Error('browser.electrobun.mock target ' + ${key} + ' could not be resolved: a parent on the path is undefined.');
    }
    var original = loc.parent[loc.key];
    if (typeof original !== 'function') {
      throw new Error('browser.electrobun.mock target ' + ${key} + ' is not a function (got ' + typeof original + ').');
    }
    var spy = __ebReg.__createSpy();
    __ebReg[${key}] = { spy: spy, original: original, parent: loc.parent, key: loc.key };
    loc.parent[loc.key] = spy;
  })()`;
}

/** Read the recorder's call data back as a JSON-cloned `{ calls, results, invocationCallOrder }`. */
export function buildReadCallDataScript(target: string): string {
  const key = pathLiteral(target);
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (!entry || !entry.spy || !entry.spy.mock) { return { calls: [], results: [], invocationCallOrder: [] }; }
    var m = entry.spy.mock;
    var errorReplacer = function(_k, v) {
      if (v instanceof Error) { return { __wdioError: true, name: v.name, message: v.message, stack: v.stack }; }
      return v;
    };
    return {
      calls: JSON.parse(JSON.stringify(m.calls || [], errorReplacer)),
      results: JSON.parse(JSON.stringify(m.results || [], errorReplacer)),
      invocationCallOrder: JSON.parse(JSON.stringify(m.invocationCallOrder || [])),
    };
  })()`;
}

/** Push a serialised implementation (function source) into the recorder. */
export function buildSetImplementationScript(target: string, source: string, once = false): string {
  const key = pathLiteral(target);
  const method = once ? 'mockImplementationOnce' : 'mockImplementation';
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (entry && entry.spy) { entry.spy.${method}((${source})); }
  })()`;
}

/**
 * Push a value-based behaviour into the recorder. `valueLiteral` must already be
 * a JS literal (see jsonLiteral / errorLiteral in mock.ts). Errors flagged with
 * `__wdioError` are reconstructed into real `Error` objects inside the page.
 */
export function buildSetValueScript(target: string, method: InnerMockSetterMethod, valueLiteral: string): string {
  const key = pathLiteral(target);
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (!entry || !entry.spy) { return; }
    var _v = ${valueLiteral};
    var arg = (_v && typeof _v === 'object' && _v.__wdioError === true) ? new Error(_v.message) : _v;
    entry.spy.${method}(arg);
  })()`;
}

/** Clear the recorder's call history (mockClear). */
export function buildClearScript(target: string): string {
  const key = pathLiteral(target);
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (entry && entry.spy) { entry.spy.mockClear(); }
  })()`;
}

/** Reset the recorder's implementation and history (mockReset). */
export function buildResetScript(target: string): string {
  const key = pathLiteral(target);
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (entry && entry.spy) { entry.spy.mockReset(); }
  })()`;
}

/** Invoke mockReturnThis on the recorder. */
export function buildReturnThisScript(target: string): string {
  const key = pathLiteral(target);
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (entry && entry.spy) { entry.spy.mockReturnThis(); }
  })()`;
}

/**
 * Restore the original function at the target path and drop the registry entry.
 * Re-assigns `parent[key]` to the preserved original so production code sees the
 * real implementation again.
 */
export function buildRestoreScript(target: string): string {
  const key = pathLiteral(target);
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (!entry) { return; }
    if (entry.parent) { entry.parent[entry.key] = entry.original; }
    delete reg[${key}];
  })()`;
}
