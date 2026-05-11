export function mockLookupExpr(mockName: string): string {
  return `window.__wdio_mocks__?.[${JSON.stringify(mockName)}]`;
}

export function errorReconstructExpr(varName: string): string {
  return `(${varName} && typeof ${varName} === 'object' && ${varName}.__wdioError === true ? new Error(${varName}.message) : ${varName})`;
}

/**
 * Self-contained browser-side mock factory setup script (no imports).
 * Emitted verbatim inside an IIFE by each framework adapter's
 * buildBrowserIpcInjectionScript(). Sets up window.__wdio_call_id__,
 * defines createMockFn, and assigns window.__wdio_spy__ + window.__wdio_mocks__.
 * Callers append the framework-specific IPC patch after this block.
 */
export const WDIO_MOCK_SETUP_SCRIPT = `  window.__wdio_call_id__ = window.__wdio_call_id__ || 0;
  var NOT_SET = {};
  function createMockFn() {
    var _name = 'spy';
    var _defaultImpl;
    var _implQueue = [];
    var _defaultReturnValue = NOT_SET;
    var _defaultResolvedValue = NOT_SET;
    var _defaultRejectedValue = NOT_SET;
    var _returnThis = false;
    var _calls = [];
    var _results = [];
    var _invocationCallOrder = [];
    function mockFn() {
      var args = Array.prototype.slice.call(arguments);
      _calls.push(args);
      _invocationCallOrder.push(window.__wdio_call_id__++);
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
        var rv = _defaultRejectedValue;
        _results.push({ type: 'throw', value: rv });
        return Promise.reject(rv);
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
    mockFn._isMockFunction = true;
    var _mockSnapshot = { calls: _calls, results: _results, invocationCallOrder: _invocationCallOrder };
    Object.defineProperty(mockFn, 'mock', {
      get: function() { return _mockSnapshot; },
      enumerable: true, configurable: true
    });
    mockFn.mockName = function(n) { _name = n; return mockFn; };
    mockFn.getMockName = function() { return _name; };
    mockFn.getMockImplementation = function() { return _defaultImpl; };
    mockFn.mockImplementation = function(fn) { _defaultImpl = fn; _returnThis = false; return mockFn; };
    mockFn.mockImplementationOnce = function(fn) { _implQueue.push(fn); return mockFn; };
    mockFn.mockReturnValue = function(val) {
      _defaultImpl = undefined; _defaultReturnValue = val; _defaultResolvedValue = NOT_SET;
      _defaultRejectedValue = NOT_SET; _returnThis = false; return mockFn;
    };
    mockFn.mockReturnValueOnce = function(val) { _implQueue.push(function() { return val; }); return mockFn; };
    mockFn.mockResolvedValue = function(val) {
      _defaultImpl = undefined; _defaultResolvedValue = val; _defaultReturnValue = NOT_SET;
      _defaultRejectedValue = NOT_SET; _returnThis = false; return mockFn;
    };
    mockFn.mockResolvedValueOnce = function(val) {
      _implQueue.push({ __wdioType: 'resolve', __wdioVal: val }); return mockFn;
    };
    mockFn.mockRejectedValue = function(val) {
      _defaultImpl = undefined; _defaultRejectedValue = val; _defaultReturnValue = NOT_SET;
      _defaultResolvedValue = NOT_SET; _returnThis = false; return mockFn;
    };
    mockFn.mockRejectedValueOnce = function(val) {
      _implQueue.push({ __wdioType: 'reject', __wdioVal: val }); return mockFn;
    };
    mockFn.mockClear = function() {
      _calls.length = 0; _results.length = 0; _invocationCallOrder.length = 0;
      return mockFn;
    };
    mockFn.mockReset = function() {
      mockFn.mockClear();
      _implQueue = [];
      _defaultImpl = undefined; _defaultReturnValue = NOT_SET;
      _defaultResolvedValue = NOT_SET; _defaultRejectedValue = NOT_SET; _returnThis = false;
      return mockFn;
    };
    mockFn.mockReturnThis = function() {
      _returnThis = true; _defaultReturnValue = NOT_SET; _defaultResolvedValue = NOT_SET;
      _defaultRejectedValue = NOT_SET; return mockFn;
    };
    mockFn.withImplementation = function(fn, callback) {
      var prevImpl = _defaultImpl, prevQueue = _implQueue.slice(), prevReturnThis = _returnThis;
      _defaultImpl = fn; _implQueue = []; _returnThis = false;
      var result = callback();
      if (result && typeof result.then === 'function') {
        return result.then(function(r) {
          _defaultImpl = prevImpl; _implQueue = prevQueue; _returnThis = prevReturnThis; return r;
        }, function(e) {
          _defaultImpl = prevImpl; _implQueue = prevQueue; _returnThis = prevReturnThis; throw e;
        });
      }
      _defaultImpl = prevImpl; _implQueue = prevQueue; _returnThis = prevReturnThis;
      return result;
    };
    return mockFn;
  }
  if (!window.__wdio_spy__) { window.__wdio_spy__ = { fn: createMockFn }; }
  if (!window.__wdio_mocks__) { window.__wdio_mocks__ = {}; }`;
