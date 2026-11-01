import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../', import.meta.url);
const TAURI_COPY = 'packages/tauri-plugin-webdriver/src/platform/key_input.rs';
const DIOXUS_COPIES = {
  'packages/dioxus-embedded-driver/src/server/handlers/actions.rs': [
    'fn map_special_key',
    'fn regular_key',
    'fn is_skipped_key',
    'fn single_char',
    'fn us_keyboard_key',
  ],
  'packages/dioxus-embedded-driver/src/server/handlers/key_input.rs': [
    'fn is_printable_key',
    'fn shift_text',
    'fn shifted_char',
    'fn js_string',
    'fn deep_active_element_js',
    'fn text_field_types_js',
    'fn is_text_field_js',
    'fn is_editable_text_field_js',
    'fn build_special_key_script',
    'fn tab_js',
    'fn build_regular_key_script',
    'fn build_printable_key_script',
    'fn space_js',
    'fn key_event_script',
    'fn delete_js',
    'fn radio_step_js',
    'fn enter_js',
    'fn record_change_js',
    'fn select_all_js',
    'fn insert_text_js',
    'const NULL_KEY',
    'fn is_modifier_key',
    'enum KeySegment',
    'fn segment_send_keys',
    'struct HeldModifiers',
    'HeldModifiers::press',
    'HeldModifiers::release',
    'HeldModifiers::state',
    'HeldModifiers::keys',
    'enum SendKeysStep',
    'fn plan_send_keys',
    'fn typed_text',
    'fn push_text',
    'fn push_key_press',
    'fn release_held_modifiers',
    'fn plain_text',
    'fn build_send_keys_start_script',
    'fn build_insert_run_script',
  ],
};
const SHARED_ITEMS = Object.entries(DIOXUS_COPIES).flatMap(([dioxusCopy, items]) =>
  items.map((item) => ({ item, dioxusCopy })),
);

const VISIBILITY = '(?:pub(?:\\([a-z]+\\))? )?';

// The copies may differ in visibility, attributes and doc comments, so compare from the keyword to
// the closing brace, or to the semicolon for a const. `Type::method` is a method in `impl Type`.
function itemSource(path: string, item: string) {
  const source = readFileSync(new URL(path, REPO_ROOT), 'utf8');
  const [type, method] = item.split('::');
  if (method) {
    const impl = source.match(new RegExp(`^impl ${type} \\{[\\s\\S]*?^\\}$`, 'm'))?.[0];
    return impl?.match(new RegExp(`^  ${VISIBILITY}(fn ${method}\\b[\\s\\S]*?^  \\})$`, 'm'))?.[1];
  }
  const end = item.startsWith('const ') ? '.*;' : '[\\s\\S]*?^\\}';
  return source.match(new RegExp(`^${VISIBILITY}(${item}\\b${end})$`, 'm'))?.[1];
}

describe('embedded driver key input', () => {
  it.each(SHARED_ITEMS)('should define $item the same in both embedded driver crates', ({ item, dioxusCopy }) => {
    const tauri = itemSource(TAURI_COPY, item);
    expect(tauri, `${item} not found in ${TAURI_COPY}`).toBeDefined();
    expect(itemSource(dioxusCopy, item), `copy ${item} from ${TAURI_COPY} into ${dioxusCopy}`).toBe(tauri);
  });
});
