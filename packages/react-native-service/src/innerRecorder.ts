// Inner-recorder script builders for the React Native mock layer.
//
// `browser.reactNative.mock` targets a *dotted path to a function in the Hermes
// JS realm* (e.g. 'nativeModuleProxy.Clipboard.getString'). These builders return
// JS expression strings evaluated in the app's Hermes global via Runtime.evaluate
// (see commands/execute.ts#evaluateInRealm). They never navigate the page.
//
// All recorders live under globalThis.__WDIO_RN_MOCKS__, keyed by target path.
// Each entry preserves the original function so mockRestore puts it back exactly.
// The recorder is a vitest-shaped spy; call/result history is read back one-way
// into the outer mock via buildReadCallDataScript.
//
// The string semantics here are only exercised end-to-end against a real Metro/
// Hermes target — unit tests assert the *expressions* emitted, not in-realm behaviour.

import type { InnerMockSetterMethod } from './mockTypes.js';

const REGISTRY = 'globalThis.__WDIO_RN_MOCKS__';

// A mock target is a dotted path of JS identifiers (`nativeModuleProxy.Clipboard.getString`).
// The VALID_TARGET guard rejects anything else (clear errors + defense-in-depth: a target
// that passes can't carry a quote, backslash, newline, or line/paragraph separator).
const VALID_TARGET = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

/** JS-source literal of a validated target path, safe to inline as an object key / string arg. */
function pathLiteral(target: string): string {
  if (!VALID_TARGET.test(target)) {
    throw new Error(
      `browser.reactNative.mock target ${JSON.stringify(target)} is not a valid dotted property path ` +
        `(expected identifiers separated by dots, e.g. 'nativeModuleProxy.Clipboard.getString').`,
    );
  }
  // The \`${key}\` interpolations below land in a JS *source* string (Runtime.evaluate).
  // JSON.stringify leaves U+2028/U+2029 raw; escape them plus '<' for the source context.
  // The VALID_TARGET guard already makes these no-ops, but this is the escaping CodeQL's
  // js/bad-code-sanitization recognises (a regex .test() guard alone does not clear it).
  return JSON.stringify(target)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/</g, '\\x3C');
}

const SETUP = `
  if (!${REGISTRY}) { ${REGISTRY} = {}; }
  var __rnReg = ${REGISTRY};
  if (!__rnReg.__callId) { __rnReg.__callId = 0; }
  if (!__rnReg.__createSpy) {
    var NOT_SET = {};
    __rnReg.__createSpy = function() {
      var _defaultImpl;
      var _savedImpls = [];
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
        _invocationCallOrder.push(__rnReg.__callId++);
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
      // withImplementation: temporarily swap the default impl (push), run the Node-side
      // callback, then restore (pop). A stack so nested withImplementation calls compose.
      spy.__pushImpl = function(fn) { _savedImpls.push(_defaultImpl); _defaultImpl = fn; return spy; };
      spy.__popImpl = function() { if (_savedImpls.length > 0) { _defaultImpl = _savedImpls.pop(); } return spy; };
      // Drain the whole stack back to its base (the impl before any withImplementation). The
      // stack is only non-empty while a withImplementation is pending, so when a popImpl never
      // lands (bridge dropped mid-call) this restores the pre-withImplementation default; a no-op
      // otherwise, so it never clobbers a plain mockImplementation/mockReturnValue default.
      spy.__resetImplStack = function() {
        if (_savedImpls.length > 0) { _defaultImpl = _savedImpls[0]; _savedImpls.length = 0; }
        return spy;
      };
      return spy;
    };
  }`;

const RESOLVE_PATH = `
    var __resolve = function(path) {
      var parts = path.split('.');
      var parent = globalThis;
      for (var i = 0; i < parts.length - 1; i++) {
        if (parent == null) { return undefined; }
        parent = parent[parts[i]];
      }
      if (parent == null) { return undefined; }
      return { parent: parent, key: parts[parts.length - 1] };
    };`;

export function buildInstallScript(target: string): string {
  const key = pathLiteral(target);
  return `(function() {${SETUP}${RESOLVE_PATH}
    var existing = __rnReg[${key}];
    if (existing) {
      // Reconnect / idempotent re-install: the spy persisted in the app realm, so preserve its
      // call history — but drain any impl stack left unbalanced by a withImplementation whose
      // popImpl never landed (e.g. the bridge dropped mid-call), so a temporary implementation
      // doesn't survive the reconnect (it otherwise persisted until mockRestore).
      if (existing.spy && existing.spy.__resetImplStack) { existing.spy.__resetImplStack(); }
      return;
    }
    var loc = __resolve(${key});
    if (!loc) {
      throw new Error('browser.reactNative.mock target ' + ${key} + ' could not be resolved: a parent on the path is undefined.');
    }
    var original = loc.parent[loc.key];
    if (typeof original !== 'function') {
      throw new Error('browser.reactNative.mock target ' + ${key} + ' is not a function (got ' + typeof original + ').');
    }
    var spy = __rnReg.__createSpy();
    __rnReg[${key}] = { spy: spy, original: original, parent: loc.parent, key: loc.key };
    loc.parent[loc.key] = spy;
  })()`;
}

/**
 * Enumerate the function-valued properties of the object at `target` (enumerable + own),
 * for `mockAll`. Returns the property names as a string array; `[]` if the path doesn't
 * resolve or holds no functions.
 */
export function buildEnumerateFunctionsScript(target: string): string {
  const key = pathLiteral(target);
  return `(function() {${RESOLVE_PATH}
    var loc = __resolve(${key});
    if (!loc) { return []; }
    var obj = loc.parent[loc.key];
    if (obj == null || (typeof obj !== 'object' && typeof obj !== 'function')) { return []; }
    var names = [];
    var add = function(n) {
      try { if (typeof obj[n] === 'function' && names.indexOf(n) === -1) { names.push(n); } } catch (e) {}
    };
    for (var k in obj) { add(k); }
    try { var own = Object.getOwnPropertyNames(obj); for (var i = 0; i < own.length; i++) { add(own[i]); } } catch (e) {}
    return names;
  })()`;
}

export function buildReadCallDataScript(target: string): string {
  const key = pathLiteral(target);
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (!entry || !entry.spy || !entry.spy.mock) { return { calls: [], results: [], invocationCallOrder: [] }; }
    var m = entry.spy.mock;
    var makeSafe = function() {
      var seen = [];
      return function(_k, v) {
        if (v instanceof Error) { return { __wdioError: true, name: v.name, message: v.message, stack: v.stack }; }
        if (typeof v === 'function') { return '[Function]'; }
        if (v && typeof v === 'object') {
          if (seen.indexOf(v) !== -1) { return '[Circular]'; }
          seen.push(v);
        }
        return v;
      };
    };
    return {
      calls: JSON.parse(JSON.stringify(m.calls || [], makeSafe())),
      results: JSON.parse(JSON.stringify(m.results || [], makeSafe())),
      invocationCallOrder: JSON.parse(JSON.stringify(m.invocationCallOrder || [])),
    };
  })()`;
}

export function buildSetImplementationScript(target: string, source: string, once = false): string {
  const key = pathLiteral(target);
  const method = once ? 'mockImplementationOnce' : 'mockImplementation';
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (entry && entry.spy) { entry.spy.${method}((${source})); }
  })()`;
}

/** Push a temporary default implementation (for withImplementation). */
export function buildPushImplementationScript(target: string, source: string): string {
  const key = pathLiteral(target);
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (entry && entry.spy && entry.spy.__pushImpl) { entry.spy.__pushImpl((${source})); }
  })()`;
}

/** Pop the temporary default implementation pushed by buildPushImplementationScript. */
export function buildPopImplementationScript(target: string): string {
  const key = pathLiteral(target);
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (entry && entry.spy && entry.spy.__popImpl) { entry.spy.__popImpl(); }
  })()`;
}

export function buildSetValueScript(target: string, method: InnerMockSetterMethod, valueLiteral: string): string {
  const key = pathLiteral(target);
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (!entry || !entry.spy) { return; }
    var _v = ${valueLiteral};
    var arg = _v;
    if (_v && typeof _v === 'object' && _v.__wdioError === true) {
      arg = new Error(_v.message);
      if (_v.name) { arg.name = _v.name; }
      if (_v.stack) { arg.stack = _v.stack; }
    }
    entry.spy.${method}(arg);
  })()`;
}

export function buildClearScript(target: string): string {
  const key = pathLiteral(target);
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (entry && entry.spy) { entry.spy.mockClear(); }
  })()`;
}

export function buildResetScript(target: string): string {
  const key = pathLiteral(target);
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (entry && entry.spy) { entry.spy.mockReset(); }
  })()`;
}

export function buildReturnThisScript(target: string): string {
  const key = pathLiteral(target);
  return `(function() {
    var reg = ${REGISTRY};
    var entry = reg && reg[${key}];
    if (entry && entry.spy) { entry.spy.mockReturnThis(); }
  })()`;
}

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
