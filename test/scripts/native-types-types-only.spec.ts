import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Soundness guard for scripts/detect-changes.ts: it classifies `native-types` as a TYPES_ONLY
// package, so a change to it skips every per-service E2E (a type change is erased at compile time
// and can only break compilation, which the always-on build + unit jobs catch). That holds only
// while native-types ships no runtime code beyond an inert version constant. This test fails the
// moment a real runtime export lands — at which point either restore types-only, or remove
// native-types from TYPES_ONLY_PACKAGES so its changes run the full matrix again.

const SRC = new URL('../../packages/native-types/src', import.meta.url).pathname;
const ALLOWED_RUNTIME_EXPORTS = new Set(['__nativeTypesVersion']);

/**
 * Transpile a TS source to JS and report the names it still runtime-exports. Using the real
 * compiler erases every type-only construct exactly — `export type { … }`, the inline
 * `export { type X }` form, `interface`, `declare global`, type aliases — so only genuine runtime
 * bindings survive. Far more robust than scanning TS source with regexes.
 */
function runtimeExports(source: string): string[] {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, isolatedModules: true },
  }).outputText;
  const names: string[] = [];
  for (const m of js.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([\w$]+)/g)) {
    names.push(m[1]);
  }
  for (const m of js.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const spec of m[1].split(',')) {
      // exported identifier is the part after `as` (or the bare name when there's no alias)
      const name = spec
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.push(name);
    }
  }
  if (/\bexport\s+default\b/.test(js)) names.push('default');
  return names;
}

describe('native-types stays types-only (detect-changes soundness guard)', () => {
  it('should export no runtime values beyond the allowlisted version constant', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(SRC)) {
      if (!/\.[cm]?tsx?$/.test(file)) continue; // .ts / .tsx / .mts / .cts
      for (const name of runtimeExports(readFileSync(join(SRC, file), 'utf8'))) {
        if (!ALLOWED_RUNTIME_EXPORTS.has(name)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('should still export the version constant the allowlist expects (keeps the guard honest)', () => {
    const index = readFileSync(join(SRC, 'index.ts'), 'utf8');
    expect(runtimeExports(index)).toContain('__nativeTypesVersion');
  });
});
