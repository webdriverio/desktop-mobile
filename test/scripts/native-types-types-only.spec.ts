import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Soundness guard for scripts/detect-changes.ts: it classifies `native-types` as a TYPES_ONLY
// package, so a change to it skips every per-service E2E (a type change is erased at compile time
// and can only break compilation, which the always-on build + unit jobs catch). That holds only
// while native-types ships no runtime code beyond an inert version constant. This test fails the
// moment a real runtime export lands — at which point either restore types-only, or remove
// native-types from TYPES_ONLY_PACKAGES so its changes run the full matrix again.

const SRC = new URL('../../packages/native-types/src', import.meta.url).pathname;
const ALLOWED_RUNTIME_EXPORTS = new Set(['__nativeTypesVersion']);

/** Lines that introduce a runtime (non-erased) binding — everything `export type`/`interface` is erased. */
function runtimeExportLines(source: string): string[] {
  const offenders: string[] = [];
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('export ') && line !== 'export{') continue;
    if (/^export\s+(type|interface)\b/.test(line)) continue; // `export type …`, `export type { … }`, `export interface …`
    const named = line.match(/^export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class|enum)\s+([\w$]+)/);
    if (named && ALLOWED_RUNTIME_EXPORTS.has(named[1])) continue; // allowlisted inert constant
    offenders.push(line);
  }
  return offenders;
}

describe('native-types stays types-only (detect-changes soundness guard)', () => {
  it('should export no runtime values beyond the allowlisted version constant', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(SRC)) {
      if (!file.endsWith('.ts')) continue;
      for (const line of runtimeExportLines(readFileSync(join(SRC, file), 'utf8'))) {
        offenders.push(`${file}: ${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('should still export the version constant the allowlist expects (keeps the guard honest)', () => {
    const index = readFileSync(join(SRC, 'index.ts'), 'utf8');
    expect(index).toMatch(/export\s+const\s+__nativeTypesVersion\b/);
  });
});
