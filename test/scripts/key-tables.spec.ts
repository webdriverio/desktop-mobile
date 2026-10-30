import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../', import.meta.url);
const TAURI_COPY = 'packages/tauri-plugin-webdriver/src/platform/key_input.rs';
const DIOXUS_COPIES = {
  'packages/dioxus-embedded-driver/src/server/handlers/actions.rs': [
    'map_special_key',
    'regular_key',
    'is_skipped_key',
    'single_char',
    'us_keyboard_key',
  ],
  'packages/dioxus-embedded-driver/src/server/handlers/key_input.rs': [
    'is_printable_key',
    'js_string',
    'deep_active_element_js',
    'text_field_types_js',
    'is_text_field_js',
    'is_editable_text_field_js',
    'build_special_key_script',
    'build_regular_key_script',
    'build_printable_key_script',
    'space_js',
    'key_event_script',
    'delete_js',
    'radio_step_js',
    'enter_js',
    'select_all_js',
    'insert_text_js',
  ],
};
const SHARED_FUNCTIONS = Object.entries(DIOXUS_COPIES).flatMap(([dioxusCopy, names]) =>
  names.map((name) => ({ name, dioxusCopy })),
);

// The copies may differ in visibility and doc comments, so compare from `fn` to the closing brace.
function functionSource(path: string, name: string) {
  const source = readFileSync(new URL(path, REPO_ROOT), 'utf8');
  return source.match(new RegExp(`^(?:pub(?:\\([a-z]+\\))? )?(fn ${name}\\b[\\s\\S]*?^\\})$`, 'm'))?.[1];
}

describe('embedded driver key input', () => {
  it.each(SHARED_FUNCTIONS)('should define $name the same in both embedded driver crates', ({ name, dioxusCopy }) => {
    const tauri = functionSource(TAURI_COPY, name);
    expect(tauri, `${name} not found in ${TAURI_COPY}`).toMatch(/^fn /);
    expect(functionSource(dioxusCopy, name), `copy ${name} from ${TAURI_COPY} into ${dioxusCopy}`).toBe(tauri);
  });
});
