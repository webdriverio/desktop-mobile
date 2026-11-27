import { describe, expect, it, vi } from 'vitest';
import {
  hasSemicolonOutsideQuotes,
  hasTopLevelArrow,
  isFunctionSource,
  wrapStringScriptBody,
} from '../src/script-detect.js';

describe('hasSemicolonOutsideQuotes', () => {
  it('should return false for an empty string', () => {
    expect(hasSemicolonOutsideQuotes('')).toBe(false);
  });

  it('should return false for a single expression with no semicolon', () => {
    expect(hasSemicolonOutsideQuotes('a + b')).toBe(false);
  });

  it('should return true for two calls separated by a semicolon', () => {
    expect(hasSemicolonOutsideQuotes('a(); b()')).toBe(true);
  });

  it('should return true for a trailing semicolon after a call', () => {
    expect(hasSemicolonOutsideQuotes('a();')).toBe(true);
  });

  it('should return true when semicolon is at depth 0', () => {
    expect(hasSemicolonOutsideQuotes('x = 1; y = 2')).toBe(true);
  });

  it('should return false for a semicolon inside parentheses', () => {
    expect(hasSemicolonOutsideQuotes('for (let i = 0; i < 10; i++)')).toBe(false);
  });

  it('should return false for a semicolon inside square brackets', () => {
    expect(hasSemicolonOutsideQuotes('arr[a; b]')).toBe(false);
  });

  it('should return false for a semicolon inside curly braces', () => {
    expect(hasSemicolonOutsideQuotes('({ a: 1; b: 2 })')).toBe(false);
  });

  it('should return false for a semicolon inside a single-quoted string', () => {
    expect(hasSemicolonOutsideQuotes("'a; b'")).toBe(false);
  });

  it('should return false for a semicolon inside a double-quoted string', () => {
    expect(hasSemicolonOutsideQuotes('"a; b"')).toBe(false);
  });

  it('should return false for a semicolon inside a template literal', () => {
    expect(hasSemicolonOutsideQuotes('`a; b`')).toBe(false);
  });

  it('should return true for a semicolon after a closing string', () => {
    expect(hasSemicolonOutsideQuotes('"hello"; doSomething()')).toBe(true);
  });

  it('should handle escaped quotes inside strings', () => {
    expect(hasSemicolonOutsideQuotes("'it\\'s alive; nope'")).toBe(false);
    expect(hasSemicolonOutsideQuotes('"say \\"hi\\"; nope"')).toBe(false);
  });

  it('should handle escaped backslash before a semicolon inside a string', () => {
    expect(hasSemicolonOutsideQuotes("'path\\\\'; real()")).toBe(true);
  });

  it('should return true for a semicolon after nested brackets close', () => {
    expect(hasSemicolonOutsideQuotes('fn(a, b); fn2()')).toBe(true);
  });

  it('should handle deeply nested brackets correctly', () => {
    expect(hasSemicolonOutsideQuotes('fn(a, [b, {c: d}]); next()')).toBe(true);
  });

  it('should return false for a semicolon inside a template literal with expression', () => {
    expect(hasSemicolonOutsideQuotes('`${a}; ${b}`')).toBe(false);
  });

  it('should return false for a semicolon inside a nested template literal', () => {
    expect(hasSemicolonOutsideQuotes('`${`inner; value`}`')).toBe(false);
  });

  it('should return false for a semicolon in a doubly-nested template literal', () => {
    expect(hasSemicolonOutsideQuotes('`${`${`deep; value`}`}`')).toBe(false);
  });

  it('should return true for a semicolon after a nested template literal closes', () => {
    expect(hasSemicolonOutsideQuotes('`${`inner`}`; done()')).toBe(true);
  });
});

describe('hasTopLevelArrow', () => {
  it('should return false for an empty string', () => {
    expect(hasTopLevelArrow('')).toBe(false);
  });

  it('should return true for a simple arrow function', () => {
    expect(hasTopLevelArrow('() => {}')).toBe(true);
  });

  it('should return true for an arrow function with parameters', () => {
    expect(hasTopLevelArrow('(a, b) => a + b')).toBe(true);
  });

  it('should return true for an arrow function with typed parameters', () => {
    expect(hasTopLevelArrow('(_tauri, cmd) => { return cmd; }')).toBe(true);
  });

  it('should return false for an arrow function wrapped in outer parens', () => {
    expect(hasTopLevelArrow('((_tauri, cmd) => { return cmd; })')).toBe(false);
  });

  it('should return false for an expression with no arrow', () => {
    expect(hasTopLevelArrow('a + b')).toBe(false);
  });

  it('should return false for a greater-than-or-equal operator', () => {
    expect(hasTopLevelArrow('a >= b')).toBe(false);
  });

  it('should return false for an arrow inside a callback argument', () => {
    expect(hasTopLevelArrow('arr.find(x => x > 0)')).toBe(false);
  });

  it('should return false for an arrow inside nested parens', () => {
    expect(hasTopLevelArrow('(fn(x => x))')).toBe(false);
  });

  it('should return true for an async arrow function', () => {
    expect(hasTopLevelArrow('async () => {}')).toBe(true);
  });

  it('should return false for an arrow inside square brackets', () => {
    expect(hasTopLevelArrow('[() => 1]')).toBe(false);
  });

  it('should return false for an arrow inside a single-quoted string', () => {
    expect(hasTopLevelArrow("'() => {}'")).toBe(false);
  });

  it('should return false for an arrow inside a double-quoted string', () => {
    expect(hasTopLevelArrow('"() => {}"')).toBe(false);
  });

  it('should return false for an arrow inside a template literal', () => {
    expect(hasTopLevelArrow('`() => {}`')).toBe(false);
  });

  it('should return true for an arrow after a top-level closing paren', () => {
    expect(hasTopLevelArrow('(a, b) => a')).toBe(true);
  });

  it('should handle escaped quotes in strings correctly', () => {
    expect(hasTopLevelArrow("'it\\'s => not'")).toBe(false);
  });

  it('should return false for an arrow inside a nested template expression', () => {
    expect(hasTopLevelArrow('`${(x) => x}`')).toBe(false);
  });

  it('should return false for a nested template expression not containing an arrow at top level', () => {
    expect(hasTopLevelArrow('`${`inner`}`')).toBe(false);
  });

  it('should return true for a top-level arrow after a template literal', () => {
    expect(hasTopLevelArrow('(`template`) => 1')).toBe(true);
  });
});

describe('isFunctionSource', () => {
  it.each([
    '(tauri) => tauri.core.invoke("cmd")',
    '({ core }, name) => core.invoke("greet", { name })',
    'tauri => tauri.core.invoke("cmd")',
    '$ => $.core.invoke("cmd")',
    't$ => t$.core.invoke("cmd")',
    '_t => _t',
    'function (tauri) { return 1; }',
    'function named(tauri) { return 1; }',
    'async (tauri) => tauri.core.invoke("cmd")',
    'async tauri => tauri.core.invoke("cmd")',
    'async function (tauri) { return 1; }',
    '  (t) => t  ',
  ])('should return true for %s', (script) => {
    expect(isFunctionSource(script)).toBe(true);
  });

  it.each([
    '1 + 2',
    'window.location.href',
    'return 42',
    'const x = 1; return x',
    '(1 + 2)',
    'document.title === "x"',
    'asyncValue',
    'functionName()',
    'x >= 1',
  ])('should return false for %s', (script) => {
    expect(isFunctionSource(script)).toBe(false);
  });

  it('should recognise function sources preceded by comments', () => {
    expect(isFunctionSource('// helper\n(tauri) => 1')).toBe(true);
    expect(isFunctionSource('/* note */ async () => 1')).toBe(true);
  });

  it('should recognise an arrow whose parameter has a Unicode name or a comment before the arrow', () => {
    expect(isFunctionSource('τ => 42')).toBe(true);
    expect(isFunctionSource('tauri /* note */ => 42')).toBe(true);
    expect(isFunctionSource('τ + 1')).toBe(false);
  });
});

describe('wrapStringScriptBody', () => {
  const evalBody = (script: string, scope: Record<string, unknown> = {}): unknown => {
    const body = wrapStringScriptBody(script);
    return new Function(...Object.keys(scope), `return (function() { ${body}})()`)(...Object.values(scope));
  };

  it('should return a bare expression including one ending in a // comment', () => {
    expect(evalBody('1 + 1 // note')).toBe(2);
    expect(evalBody('window.title // the title', { window: { title: 'App' } })).toBe('App');
  });

  it('should handle a leading newline or leading comment before an expression', () => {
    expect(evalBody('\n  window.title\n', { window: { title: 'App' } })).toBe('App');
    expect(evalBody('// the title\nwindow.title', { window: { title: 'App' } })).toBe('App');
    expect(evalBody('/* multi\nline */\nwindow.title', { window: { title: 'App' } })).toBe('App');
  });

  it('should not misclassify an expression whose comment contains a semicolon', () => {
    expect(evalBody('window.title // a; b', { window: { title: 'App' } })).toBe('App');
    expect(evalBody('/* a; b */ window.title', { window: { title: 'App' } })).toBe('App');
  });

  it('should run statement scripts as a body including leading or trailing comments', () => {
    expect(evalBody('return 42 // answer')).toBe(42);
    expect(evalBody('// compute\nconst x = 40; return x + 2 // done')).toBe(42);
    expect(evalBody('/* note */\nreturn 42')).toBe(42);
    expect(evalBody('function foo() { return 42; }')).toBeUndefined();
    expect(evalBody('async function foo() { return 42; }')).toBeUndefined();
    expect(evalBody('class Foo {}')).toBeUndefined();
    expect(evalBody('function foo() { return 42; }\nreturn foo()')).toBe(42);
    expect(evalBody('function foo() { return 42; } !foo()')).toBeUndefined();
    expect(evalBody('function foo(){ label: {} /}/.test("}") }\nreturn foo() ?? 42')).toBe(42);
    expect(
      evalBody(
        'function foo(x){ switch (x) { case 1: {} /}/.test("}"); default: {} /}/.test("}") } }\nreturn foo(1) ?? 42',
      ),
    ).toBe(42);
    expect(evalBody('function café() { return 42 }\nreturn café()')).toBe(42);
    expect(evalBody('function \\u0066oo() { return 42 }\nreturn foo()')).toBe(42);
    expect(evalBody('function \\u{66}oo() { return 42 }\nreturn foo()')).toBe(42);
    expect(evalBody('class Café { x = 42 }\nreturn new Café().x')).toBe(42);
    expect(evalBody('class Foo { x = 42 }\nreturn new Foo().x')).toBe(42);
    expect(evalBody('/[/*]/.test("*"); return 42')).toBe(42);
    expect(evalBody('let x = {} / 2; return /x/')).toEqual(/x/);
    expect(evalBody('x = {} / 2; return /x/', { x: 0 })).toEqual(/x/);
    expect(evalBody('x = true?.5:{} / 2; return /x/', { x: 0 })).toEqual(/x/);
  });

  it('should not misclassify Unicode identifiers starting with a statement keyword', () => {
    expect(evalBody('returné', { returné: 42 })).toBe(42);
  });

  it('should evaluate function and class expressions instead of emitting them as declarations', async () => {
    expect(evalBody('function () { return 42 }()')).toBe(42);
    expect(evalBody('function named() { return 42 }()')).toBe(42);
    expect(evalBody('function named() { return 42 }.call(null)')).toBe(42);
    expect(evalBody('function named() { return /}/; }()')).toEqual(/}/);
    expect(await evalBody('async function () { return 42 }()')).toBe(42);
    expect(await evalBody('async function named() { return 42 }()')).toBe(42);
    expect(evalBody('class { static value = 42 }.value')).toBe(42);
    expect(evalBody('class Foo { static value = 42 }.value')).toBe(42);
  });

  it('should handle regex expressions containing semicolons or comment-like character classes', () => {
    expect(evalBody('/[/*]/.test("*")')).toBe(true);
    expect(evalBody('/a;b/.test("a;b")')).toBe(true);
  });

  it('should run a script that divides a variable named `of` as a body', () => {
    expect(evalBody('of / 2; return /x/', { of: 4 })).toEqual(/x/);
  });

  it('should run statements on separate lines without semicolons as a body', () => {
    const calls: string[] = [];
    const run = (name: string) => calls.push(name);
    expect(evalBody("run('a')\nrun('b')", { run })).toBeUndefined();
    expect(calls).toEqual(['a', 'b']);
  });

  it("should fall back to the heuristic for a script this runtime can't compile, which the app's engine may", () => {
    expect(wrapStringScriptBody('a b // note')).toBe('return (a b // note\n);');
    expect(wrapStringScriptBody('a b; return c')).toBe('a b; return c\n');
  });

  it('should keep compiling after a script too deeply nested to compile', () => {
    const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
    expect(wrapStringScriptBody(deep)).toBe(`return (${deep}\n);`);
    expect(wrapStringScriptBody('window.title // a; b')).toBe('return (window.title // a; b\n);');
  });

  it('should not let a script close the expression wrapper', () => {
    expect(wrapStringScriptBody('1); run(); (2')).toBe('1); run(); (2\n');
  });

  it('should return an awaited expression', async () => {
    const body = wrapStringScriptBody('await Promise.resolve(42)');
    await expect(new (async () => {}).constructor(body)()).resolves.toBe(42);
  });

  it('should handle empty and comment-only scripts without throwing', () => {
    expect(evalBody('')).toBeUndefined();
    expect(evalBody('   ')).toBeUndefined();
    expect(evalBody('// only a comment')).toBeUndefined();
    expect(evalBody('/* only a comment */')).toBeUndefined();
  });
});

describe('wrapStringScriptBody where compiling is blocked', () => {
  it('should fall back to statement keywords and top-level semicolons', async () => {
    const prototype = Object.getPrototypeOf(async () => {});
    const original = Object.getOwnPropertyDescriptor(prototype, 'constructor');
    let compileAttempts = 0;
    Object.defineProperty(prototype, 'constructor', {
      configurable: true,
      value: function BlockedAsyncFunction() {
        compileAttempts++;
        throw new EvalError('Refused to evaluate a string as JavaScript');
      },
    });
    try {
      vi.resetModules();
      const { wrapStringScriptBody: wrap } = await import('../src/script-detect.js');
      expect(wrap('// title\nwindow.title // note')).toBe('return (// title\nwindow.title // note\n);');
      expect(wrap('return 42')).toBe('return 42\n');
      expect(wrap('a(); b()')).toBe('a(); b()\n');
      expect(compileAttempts).toBe(1);
    } finally {
      Object.defineProperty(prototype, 'constructor', original as PropertyDescriptor);
      vi.resetModules();
    }
  });
});
