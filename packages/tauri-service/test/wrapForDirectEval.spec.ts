import { describe, expect, it } from 'vitest';
import { wrapScriptForDirectEval } from '../src/wrapForDirectEval.js';

describe('wrapScriptForDirectEval', () => {
  describe('function-like scripts', () => {
    it('should wrap an arrow function', () => {
      const result = wrapScriptForDirectEval('(tauri, x) => x * 2', '[21]');
      expect(result).toContain('var __cb = arguments[arguments.length - 1]');
      expect(result).toContain('__wdio_args = [21]');
      expect(result).toContain('__wdio_tauri = { core: { invoke: __wdio_invoke } }');
      expect(result).toContain('await ((tauri, x) => x * 2)(__wdio_tauri, ...__wdio_args)');
      expect(result).toContain('__cb({ ok: true,');
      expect(result).toContain('__cb({ ok: false,');
    });

    it('should wrap a named function expression', () => {
      const result = wrapScriptForDirectEval('function myFn(tauri) { return 1; }', '[]');
      expect(result).toContain('var __cb = arguments[arguments.length - 1]');
      expect(result).toContain('await (function myFn(tauri) { return 1; })(__wdio_tauri, ...__wdio_args)');
    });

    it('should wrap an async function', () => {
      const result = wrapScriptForDirectEval('async function fn(tauri) { return await fetch(); }', '[]');
      expect(result).toContain('await (async function fn(tauri) { return await fetch(); })(__wdio_tauri');
    });

    it('should wrap an async arrow function', () => {
      const result = wrapScriptForDirectEval('async (tauri) => 42', '[]');
      expect(result).toContain('await (async (tauri) => 42)(__wdio_tauri');
    });

    it('should wrap a bare identifier arrow function', () => {
      const result = wrapScriptForDirectEval('x => x + 1', '[5]');
      expect(result).toContain('await (x => x + 1)(__wdio_tauri');
    });

    it('should wrap a bare identifier arrow function containing $', () => {
      const result = wrapScriptForDirectEval('t$ => t$.core', '[]');
      expect(result).toContain('await (t$ => t$.core)(__wdio_tauri');
    });

    it('should include mock-routing invoke block', () => {
      const result = wrapScriptForDirectEval('(tauri) => 1', '[]');
      expect(result).toContain('window.__wdio_mocks__');
      expect(result).toContain('mocks[cmd]');
      expect(result).toContain('__wdio_invoke_real');
    });

    it('should include __wdio_original_core__ wait loop', () => {
      const result = wrapScriptForDirectEval('(tauri) => 1', '[]');
      expect(result).toContain('window.__wdio_original_core__');
      expect(result).toContain('5s timeout');
    });

    it('should embed args JSON correctly', () => {
      const result = wrapScriptForDirectEval('(tauri, a, b) => a + b', '[1,"hello"]');
      expect(result).toContain('__wdio_args = [1,"hello"]');
    });

    it('should pass undef=true for undefined results', () => {
      const result = wrapScriptForDirectEval('(tauri) => 1', '[]');
      expect(result).toContain('undef: __result === undefined');
      expect(result).toContain('value: __result === undefined ? null : __result');
    });
  });

  describe('string expression scripts', () => {
    it('should wrap a simple expression', () => {
      const result = wrapScriptForDirectEval('1 + 2', '[]');
      expect(result).toContain('var __cb = arguments[arguments.length - 1]');
      expect(result).toContain('(async function() { return 1 + 2; }).apply(null, __wdio_args)');
      expect(result).toContain('__cb({ ok: true,');
    });

    it('should wrap a property access expression', () => {
      const result = wrapScriptForDirectEval('document.title', '[]');
      expect(result).toContain('(async function() { return document.title; }).apply(null, __wdio_args)');
    });

    it('should embed args JSON', () => {
      const result = wrapScriptForDirectEval('arguments[0] * 2', '[21]');
      expect(result).toContain('__wdio_args = [21]');
    });
  });

  describe('string statement scripts', () => {
    it('should wrap a const declaration', () => {
      const result = wrapScriptForDirectEval('const x = 1; return x;', '[]');
      expect(result).toContain('(async function() { const x = 1; return x; }).apply(null, __wdio_args)');
    });

    it('should wrap a let declaration', () => {
      const result = wrapScriptForDirectEval('let x = 2; return x;', '[]');
      expect(result).toContain('(async function() { let x = 2; return x; }).apply(null, __wdio_args)');
    });

    it('should wrap an if statement', () => {
      const result = wrapScriptForDirectEval('if (true) { return 1; }', '[]');
      expect(result).toContain('(async function() { if (true) { return 1; } }).apply(null, __wdio_args)');
    });

    it('should wrap a script with semicolons as statement', () => {
      const result = wrapScriptForDirectEval('var x = 1; var y = 2; return x + y;', '[]');
      expect(result).toContain('(async function() { var x = 1; var y = 2; return x + y; }).apply(null, __wdio_args)');
    });

    it('should wrap a return statement', () => {
      const result = wrapScriptForDirectEval('return document.title', '[]');
      expect(result).toContain('(async function() { return document.title }).apply(null, __wdio_args)');
    });

    it('should NOT wrap return statement as expression', () => {
      const result = wrapScriptForDirectEval('return 42', '[]');
      expect(result).not.toContain('return return 42');
      expect(result).toContain('(async function() { return 42 }).apply(null');
    });
  });

  describe('callback contract', () => {
    it('should always set up the __cb callback', () => {
      for (const script of ['(tauri) => 1', '1 + 1', 'return 1']) {
        const result = wrapScriptForDirectEval(script, '[]');
        expect(result).toContain('var __cb = arguments[arguments.length - 1]');
      }
    });

    it('should always call __cb on success', () => {
      for (const script of ['(tauri) => 1', '1 + 1', 'return 1']) {
        const result = wrapScriptForDirectEval(script, '[]');
        expect(result).toContain('__cb({ ok: true,');
      }
    });

    it('should always call __cb on error', () => {
      for (const script of ['(tauri) => 1', '1 + 1', 'return 1']) {
        const result = wrapScriptForDirectEval(script, '[]');
        expect(result).toContain('__cb({ ok: false,');
      }
    });
  });
});
