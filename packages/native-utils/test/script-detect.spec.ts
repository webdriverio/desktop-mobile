import { describe, expect, it } from 'vitest';
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

  it('should ignore semicolons inside line and block comments', () => {
    expect(hasSemicolonOutsideQuotes('window.title // a; b')).toBe(false);
    expect(hasSemicolonOutsideQuotes('/* a; b */ window.title')).toBe(false);
    expect(hasSemicolonOutsideQuotes("window.title // it's; fine")).toBe(false);
    expect(hasSemicolonOutsideQuotes('/* a; */ x = 1; y = 2')).toBe(true);
    expect(hasSemicolonOutsideQuotes('window.title // first\n; done()')).toBe(true);
  });

  it('should not treat /*/ as a closed block comment', () => {
    expect(hasSemicolonOutsideQuotes('/*/ ; */ x')).toBe(false);
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

  it('should ignore arrows inside comments', () => {
    expect(hasTopLevelArrow('x + 1 // () => 2')).toBe(false);
    expect(hasTopLevelArrow('/* () => 2 */ x + 1')).toBe(false);
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
  });

  it('should handle empty and comment-only scripts without throwing', () => {
    expect(evalBody('')).toBeUndefined();
    expect(evalBody('   ')).toBeUndefined();
    expect(evalBody('// only a comment')).toBeUndefined();
    expect(evalBody('/* only a comment */')).toBeUndefined();
  });
});
