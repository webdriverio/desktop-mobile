import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../', import.meta.url);
const TAURI_COPY = 'packages/tauri-plugin-webdriver/src/platform/key_input.rs';
const DIOXUS_COPY = 'packages/dioxus-embedded-driver/src/server/handlers/actions.rs';
const SHARED_FUNCTIONS = ['map_special_key', 'regular_key', 'is_skipped_key', 'single_char', 'us_keyboard_key'];

// The copies may differ in visibility and doc comments, so compare from `fn` to the closing brace.
function functionSource(path: string, name: string) {
  const source = readFileSync(new URL(path, REPO_ROOT), 'utf8');
  return source.match(new RegExp(`^(?:pub(?:\\([a-z]+\\))? )?(fn ${name}\\b[\\s\\S]*?^\\})$`, 'm'))?.[1];
}

describe('embedded driver key tables', () => {
  it.each(SHARED_FUNCTIONS)('should define %s the same in both embedded driver crates', (name) => {
    const tauri = functionSource(TAURI_COPY, name);
    expect(tauri, `${name} not found in ${TAURI_COPY}`).toMatch(/^fn /);
    expect(functionSource(DIOXUS_COPY, name), `copy ${name} from ${TAURI_COPY} into ${DIOXUS_COPY}`).toBe(tauri);
  });
});
