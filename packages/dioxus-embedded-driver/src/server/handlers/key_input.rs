//! Key events and their default actions. Synthetic key events have none, so after an uncanceled
//! keydown the driver types, deletes, breaks the line or moves focus itself.

use std::collections::BTreeSet;

use super::actions::{
  is_skipped_key, map_special_key, regular_key, single_char, us_keyboard_key,
  Modifiers as ModifierState,
};
use super::element::ELEMENT_EVENTS_JS;

// The non-test functions below `key_script` are copies of tauri-plugin-wdio-webdriver's
// key_input.rs, since a published crate can only include its own files.
// test/scripts/key-tables.spec.ts checks the copies match.

/// JS dispatching one keydown or keyup of a WebDriver key value and running its default action,
/// picking the script as the Tauri driver's `dispatch_key_event` does.
pub(super) fn key_script(key: &str, is_down: bool, modifiers: &ModifierState) -> String {
  match map_special_key(key) {
    Some((js_key, js_code, key_code)) if is_printable_key(js_key) => {
      build_printable_key_script(js_key, js_code, key_code, is_down, modifiers)
    }
    Some((js_key, js_code, key_code)) => {
      build_special_key_script(js_key, js_code, key_code, is_down, modifiers)
    }
    None => build_regular_key_script(key, is_down, modifiers),
  }
}

/// Whether a normalized key value types a character: Space, `;`, `=` and the numpad digits and
/// operators.
fn is_printable_key(js_key: &str) -> bool {
  single_char(js_key).is_some()
}

/// `text` as a US keyboard types it with Shift held: `a1;` is `A!:`.
fn shift_text(text: &str) -> String {
  text.chars().map(shifted_char).collect()
}

/// What `ch`'s key types with Shift on a US keyboard: the shifted row with the same `code`, or `ch`
/// itself if it already takes Shift, Shift doesn't change it (Space) or it has no key (`é`). The
/// search covers printable ASCII, where every shifted row is.
fn shifted_char(ch: char) -> char {
  let Some((code, _, false)) = us_keyboard_key(ch) else {
    return ch;
  };
  (' '..='~')
    .find(|&other| {
      us_keyboard_key(other).is_some_and(|(other_code, _, shifted)| shifted && other_code == code)
    })
    .unwrap_or(ch)
}

/// A JS string literal for `text` that is safe to splice into a script.
fn js_string(text: &str) -> String {
  serde_json::Value::from(text).to_string()
}

/// JS binding `var` to the focused element, looking through open shadow roots.
fn deep_active_element_js(var: &str) -> String {
  format!(
    r"var {var} = document.activeElement || document.body;
                while ({var}.shadowRoot && {var}.shadowRoot.activeElement) {{
                    {var} = {var}.shadowRoot.activeElement;
                }}"
  )
}

/// `element-events.js`'s text field types, for scripts that don't paste that file.
fn text_field_types_js() -> &'static str {
  const DECLARATION: &str = "const WDIO_TEXT_FIELD_TYPES = ";
  let start =
    ELEMENT_EVENTS_JS.find(DECLARATION).expect("element-events.js declares WDIO_TEXT_FIELD_TYPES")
      + DECLARATION.len();
  let end = start + ELEMENT_EVENTS_JS[start..].find(';').expect("the declaration ends with a ;");
  &ELEMENT_EVENTS_JS[start..end]
}

/// JS expression that is true when `el` takes typed text: a textarea or a text-like input.
fn is_text_field_js(el: &str) -> String {
  let types = text_field_types_js();
  format!(
    "({el}.tagName === 'TEXTAREA' || ({el}.tagName === 'INPUT' && {types}.indexOf({el}.type) !== -1))"
  )
}

/// JS expression that is true when typing may change `el`'s value: a text field that is neither
/// read-only nor disabled.
fn is_editable_text_field_js(el: &str) -> String {
  let text_field = is_text_field_js(el);
  format!("({text_field} && !{el}.readOnly && !{el}.disabled)")
}

/// JS dispatching a special-key `KeyboardEvent`. Synthetic events have no default action, so
/// unless a handler cancels the keydown, the script performs the key's action itself.
fn build_special_key_script(
  js_key: &str,
  js_code: &str,
  key_code: u32,
  is_down: bool,
  modifiers: &ModifierState,
) -> String {
  let default_action = match js_key {
    _ if !is_down => String::new(),
    "Backspace" | "Delete" => {
      format!("{}\n{}", record_change_js(), delete_js(js_key == "Backspace"))
    }
    "ArrowDown" | "ArrowRight" => radio_step_js(true),
    "ArrowUp" | "ArrowLeft" => radio_step_js(false),
    _ => String::new(),
  };
  let after_dispatch = match js_key {
    _ if !is_down => String::new(),
    "Enter" if !(modifiers.ctrl || modifiers.meta || modifiers.alt) => enter_js(modifiers.shift),
    "Tab" => tab_js(),
    _ => String::new(),
  };
  key_event_script(js_key, js_code, key_code, is_down, modifiers, &after_dispatch, &default_action)
}

/// JS for Tab's default action. `wdioTabKey` reads the keydown's cancellation and modifiers itself.
fn tab_js() -> String {
  format!("{{\n{ELEMENT_EVENTS_JS}\nwdioTabKey(keyEvent);\n}}")
}

/// JS dispatching a synthetic printable-character `KeyboardEvent` plus the insertion or Ctrl/Meta+A
/// select-all an untrusted event can't drive itself, skipped when a handler cancels the keydown.
/// The event carries the character's US-keyboard key, with Shift held if that key needs it.
fn build_regular_key_script(key: &str, is_down: bool, modifiers: &ModifierState) -> String {
  let (code, key_code, shifted) = regular_key(key);
  let modifiers = ModifierState { shift: modifiers.shift || shifted, ..*modifiers };
  build_printable_key_script(key, &code, key_code, is_down, &modifiers)
}

/// [`build_regular_key_script`] with an explicit `keyCode`, for printable special keys that don't
/// share the main key's (Numpad5 is 101, not 53). With Shift held, a key with its main-keyboard
/// `keyCode` sends and types its shifted character, as chromedriver does (`A` for `a`, `+` for
/// `Key.Equals`). A numpad key keeps its own character.
fn build_printable_key_script(
  key: &str,
  code: &str,
  key_code: u32,
  is_down: bool,
  modifiers: &ModifierState,
) -> String {
  let main_keyboard = key_code != 0 && regular_key(key).1 == key_code;
  let key = if modifiers.shift && main_keyboard { shift_text(key) } else { key.to_string() };
  let key = key.as_str();
  let is_select_all = matches!(key, "a" | "A") && (modifiers.ctrl || modifiers.meta);
  let default_action = if !is_down {
    String::new()
  } else if is_select_all {
    select_all_js()
  } else if modifiers.ctrl || modifiers.meta || modifiers.alt {
    String::new()
  } else {
    format!("{}\n{}", record_change_js(), insert_text_js("activeEl", &js_string(key)))
  };
  let after_dispatch = if key == " " { space_js(is_down, modifiers) } else { String::new() };
  key_event_script(key, code, key_code, is_down, modifiers, &after_dispatch, &default_action)
}

/// JS for Space's keydown or keyup, which runs even when canceled, as a cancel stops the click.
fn space_js(is_down: bool, modifiers: &ModifierState) -> String {
  let call = if is_down { "wdioSpaceDown" } else { "wdioSpaceUp" };
  let held = modifiers.ctrl || modifiers.meta || modifiers.alt;
  format!("{{\n{ELEMENT_EVENTS_JS}\n{call}(activeEl, canceled || {held});\n}}")
}

/// JS dispatching one keydown or keyup to the deep focused element, then running `after_dispatch`,
/// which can read `canceled`, and `default_action` unless a handler canceled the event.
fn key_event_script(
  key: &str,
  code: &str,
  key_code: u32,
  is_down: bool,
  modifiers: &ModifierState,
  after_dispatch: &str,
  default_action: &str,
) -> String {
  let active_element = deep_active_element_js("activeEl");
  let event_type = if is_down { "keydown" } else { "keyup" };
  let key = js_string(key);
  let code = js_string(code);
  let ModifierState { ctrl, shift, alt, meta } = *modifiers;
  format!(
    r"(function() {{
                {active_element}
                var keyEvent = new KeyboardEvent('{event_type}', {{
                    key: {key},
                    code: {code},
                    keyCode: {key_code},
                    which: {key_code},
                    ctrlKey: {ctrl},
                    metaKey: {meta},
                    shiftKey: {shift},
                    altKey: {alt},
                    bubbles: true,
                    composed: true,
                    cancelable: true
                }});
                var canceled = !activeEl.dispatchEvent(keyEvent);
                {after_dispatch}
                if (canceled) {{
                    return true;
                }}
                {default_action}
                return true;
            }})()"
  )
}

/// JS for Backspace (`backward`) or Delete in an editable text field: removes the selection, or the
/// character before or after the caret (the end, without a selection API), and fires `input`.
fn delete_js(backward: bool) -> String {
  let text_field = is_editable_text_field_js("activeEl");
  let (edge_check, removed_start, removed_end, input_type) = if backward {
    ("selStart > 0", "selStart - 1", "selStart", "deleteContentBackward")
  } else {
    ("selStart < currentValue.length", "selStart", "selStart + 1", "deleteContentForward")
  };
  format!(
    r"if ({text_field}) {{
                    var currentValue = activeEl.value;
                    var selStart = null;
                    var selEnd = null;
                    try {{
                        selStart = activeEl.selectionStart;
                        selEnd = activeEl.selectionEnd;
                    }} catch (e) {{}}
                    var hasSelectionApi = typeof selStart === 'number' && typeof selEnd === 'number';
                    if (!hasSelectionApi) {{
                        // Inputs without a selection API (email, number) edit at the end, as typing appends.
                        selStart = selEnd = currentValue.length;
                    }}
                    var removeStart = selStart;
                    var removeEnd = selEnd;
                    if (selStart === selEnd) {{
                        removeStart = {edge_check} ? {removed_start} : selStart;
                        removeEnd = {edge_check} ? {removed_end} : selStart;
                    }}
                    if (removeStart !== removeEnd) {{
                        var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                            activeEl.tagName === 'INPUT'
                                ? window.HTMLInputElement.prototype
                                : window.HTMLTextAreaElement.prototype,
                            'value'
                        ).set;
                        nativeInputValueSetter.call(
                            activeEl,
                            currentValue.slice(0, removeStart) + currentValue.slice(removeEnd)
                        );
                        if (hasSelectionApi) {{
                            activeEl.setSelectionRange(removeStart, removeStart);
                        }}
                        activeEl.dispatchEvent(new InputEvent('input', {{
                            bubbles: true,
                            composed: true,
                            cancelable: true,
                            inputType: '{input_type}'
                        }}));
                    }}
                }}"
  )
}

/// JS moving the checked radio to the next (`forward`) or previous button of the focused radio's
/// group, firing `change`.
fn radio_step_js(forward: bool) -> String {
  format!(
    r#"if (activeEl.tagName === 'INPUT' && activeEl.type === 'radio' && activeEl.name) {{
                    var radios = Array.from(activeEl.getRootNode().querySelectorAll(
                        'input[type="radio"][name="' + CSS.escape(activeEl.name) + '"]'
                    ));
                    var currentIndex = radios.indexOf(activeEl);
                    if (currentIndex !== -1 && radios.length > 1) {{
                        var nextIndex = {forward}
                            ? (currentIndex + 1) % radios.length
                            : (currentIndex - 1 + radios.length) % radios.length;
                        var nextRadio = radios[nextIndex];
                        nextRadio.checked = true;
                        nextRadio.focus();
                        nextRadio.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    }}
                }}"#
  )
}

/// JS for Enter's keydown. Unless a handler canceled the key, it acts where focus is after the
/// keydown's handlers.
fn enter_js(shift: bool) -> String {
  let insert_newline = insert_text_js("activeEl", &js_string("\n"));
  let command = if shift { "insertLineBreak" } else { "insertParagraph" };
  format!(
    r"{{
                {ELEMENT_EVENTS_JS}
                if (!canceled) {{
                    activeEl = wdioDeepActiveElement();
                    if (activeEl.tagName === 'TEXTAREA') {{
                        wdioRecordPendingChange(activeEl, activeEl.value);
                        {insert_newline}
                    }} else if (activeEl.isContentEditable) {{
                        document.execCommand('{command}', false, null);
                    }} else {{
                        wdioEnterKey();
                    }}
                }}
                }}"
  )
}

/// JS recording the `change` the focused text field owes before a key edits it, so the field fires
/// `change` when focus leaves it, as in Chrome.
fn record_change_js() -> String {
  let editable = is_editable_text_field_js("activeEl");
  format!(
    r"{{
                {ELEMENT_EVENTS_JS}
                if ({editable}) {{
                    wdioRecordPendingChange(activeEl, activeEl.value);
                }}
                }}"
  )
}

/// JS for Ctrl/Meta+A: selects a text field's value, or everything else.
fn select_all_js() -> String {
  let text_field = is_text_field_js("activeEl");
  format!(
    r"if ({text_field}) {{
                    activeEl.select();
                }} else {{
                    document.execCommand('selectAll', false, null);
                }}"
  )
}

/// JS inserting the string expression `text_js` at `el`'s selection, replacing any selected range,
/// and firing `input` if the value changed. Only editable text fields and contenteditable take text.
fn insert_text_js(el: &str, text_js: &str) -> String {
  let text_field = is_editable_text_field_js(el);
  format!(
    r"var insertedText = {text_js};
                if ({text_field}) {{
                    var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                        {el}.tagName === 'INPUT'
                            ? window.HTMLInputElement.prototype
                            : window.HTMLTextAreaElement.prototype,
                        'value'
                    ).set;
                    var currentValue = {el}.value;
                    var selStart = null;
                    var selEnd = null;
                    try {{
                        selStart = {el}.selectionStart;
                        selEnd = {el}.selectionEnd;
                    }} catch (e) {{}}
                    if (typeof selStart === 'number' && typeof selEnd === 'number') {{
                        nativeInputValueSetter.call(
                            {el},
                            currentValue.slice(0, selStart) + insertedText + currentValue.slice(selEnd)
                        );
                        var caret = selStart + insertedText.length;
                        {el}.setSelectionRange(caret, caret);
                    }} else {{
                        nativeInputValueSetter.call({el}, currentValue + insertedText);
                    }}
                    if ({el}.value !== currentValue) {{
                        {el}.dispatchEvent(new InputEvent('input', {{
                            bubbles: true,
                            composed: true,
                            cancelable: true,
                            inputType: 'insertText',
                            data: insertedText
                        }}));
                    }}
                }} else if ({el}.isContentEditable) {{
                    document.execCommand('insertText', false, insertedText);
                }}"
  )
}

/// The WebDriver null key; in Element Send Keys it releases every held modifier.
const NULL_KEY: &str = "\u{E000}";

/// Whether a WebDriver key value is a left- or right-hand Shift/Control/Alt/Meta.
fn is_modifier_key(key: &str) -> bool {
  matches!(map_special_key(key), Some(("Shift" | "Control" | "Alt" | "Meta", _, _)))
}

/// One segment of an element send-keys request: a run of printable text, or a single special key.
#[derive(Debug, Clone, PartialEq, Eq)]
enum KeySegment {
  Text(String),
  Special(String),
}

/// Split send-keys text into printable runs and individual special keys, preserving order.
fn segment_send_keys(text: &str) -> Vec<KeySegment> {
  let mut segments = Vec::new();
  let mut run = String::new();
  for ch in text.chars() {
    let key = ch.to_string();
    if is_skipped_key(&key) {
      continue;
    }
    if map_special_key(&key).is_some() {
      if !run.is_empty() {
        segments.push(KeySegment::Text(std::mem::take(&mut run)));
      }
      segments.push(KeySegment::Special(key));
    } else {
      run.push(ch);
    }
  }
  if !run.is_empty() {
    segments.push(KeySegment::Text(run));
  }
  segments
}

/// The modifier keys held down. Each key is tracked on its own, so releasing right Control leaves
/// Control set while left Control is still held.
#[derive(Debug, Clone, Default)]
struct HeldModifiers {
  keys: BTreeSet<String>,
}

impl HeldModifiers {
  /// Record a key press; returns whether it newly held a modifier.
  fn press(&mut self, key: &str) -> bool {
    is_modifier_key(key) && self.keys.insert(key.to_string())
  }

  /// Record a key release; returns whether it released a held modifier.
  fn release(&mut self, key: &str) -> bool {
    self.keys.remove(key)
  }

  /// The modifier flags for the keys still held.
  fn state(&self) -> ModifierState {
    let mut state = ModifierState::default();
    for key in &self.keys {
      match map_special_key(key) {
        Some(("Control", _, _)) => state.ctrl = true,
        Some(("Shift", _, _)) => state.shift = true,
        Some(("Alt", _, _)) => state.alt = true,
        Some(("Meta", _, _)) => state.meta = true,
        _ => {}
      }
    }
    state
  }

  /// The held modifier keys in code-point order.
  fn keys(&self) -> Vec<String> {
    self.keys.iter().cloned().collect()
  }
}

/// One step of an element send-keys request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendKeysStep {
  /// Printable text inserted into the element.
  Text(String),
  /// A key event for the focused element, dispatched as the actions path dispatches it.
  Key { value: String, is_down: bool, modifiers: ModifierState },
}

/// Send-keys text as ordered steps: a modifier stays held until it's pressed again, the null key or
/// the end, text typed under Shift alone goes in shifted, and text typed under Control, Alt or Meta
/// is pressed key by key as shortcuts.
pub fn plan_send_keys(text: &str) -> Vec<SendKeysStep> {
  let mut steps = Vec::new();
  let mut held = HeldModifiers::default();

  for segment in segment_send_keys(text) {
    let modifiers = held.state();
    match segment {
      KeySegment::Text(run) if modifiers.ctrl || modifiers.alt || modifiers.meta => {
        for ch in run.chars() {
          push_key_press(&mut steps, &ch.to_string(), modifiers);
        }
      }
      KeySegment::Text(run) if modifiers.shift => push_text(&mut steps, &shift_text(&run)),
      KeySegment::Text(run) => push_text(&mut steps, &run),
      KeySegment::Special(key) if key == NULL_KEY => {
        release_held_modifiers(&mut steps, &mut held);
      }
      KeySegment::Special(key) if is_modifier_key(&key) => {
        let is_down = held.press(&key);
        if !is_down {
          held.release(&key);
        }
        steps.push(SendKeysStep::Key { value: key, is_down, modifiers: held.state() });
      }
      KeySegment::Special(key) => push_key_press(&mut steps, &key, modifiers),
    }
  }
  release_held_modifiers(&mut steps, &mut held);
  steps
}

/// The text a plan types, without its key presses: what a non-typeable form control's value is set to.
pub fn typed_text(steps: &[SendKeysStep]) -> String {
  steps
    .iter()
    .filter_map(|step| match step {
      SendKeysStep::Text(run) => Some(run.as_str()),
      SendKeysStep::Key { .. } => None,
    })
    .collect()
}

fn push_text(steps: &mut Vec<SendKeysStep>, run: &str) {
  if let Some(SendKeysStep::Text(last)) = steps.last_mut() {
    last.push_str(run);
  } else {
    steps.push(SendKeysStep::Text(run.to_string()));
  }
}

fn push_key_press(steps: &mut Vec<SendKeysStep>, value: &str, modifiers: ModifierState) {
  for is_down in [true, false] {
    steps.push(SendKeysStep::Key { value: value.to_string(), is_down, modifiers });
  }
}

/// Key-up every held modifier in code-point order, as the spec's "clear the modifier key state"
/// releases them. Each key-up carries the flags left after its own release.
fn release_held_modifiers(steps: &mut Vec<SendKeysStep>, held: &mut HeldModifiers) {
  for key in held.keys() {
    held.release(&key);
    steps.push(SendKeysStep::Key { value: key, is_down: false, modifiers: held.state() });
  }
}

/// The text to type when a plan presses no keys, so the whole request fits in one script.
pub fn plain_text(steps: &[SendKeysStep]) -> Option<&str> {
  match steps {
    [] => Some(""),
    [SendKeysStep::Text(text)] => Some(text),
    _ => None,
  }
}

/// JS starting send keys: sets a value control's value to `typed`, or focuses the element once,
/// records that a text field owes a `change`, and types `plain` if given. Returns `{ status }` and
/// never throws.
pub fn build_send_keys_start_script(js_var: &str, typed: &str, plain: Option<&str>) -> String {
  let active_element = deep_active_element_js("activeEl");
  let receiver_editable = is_editable_text_field_js("receiver");
  let typed = js_string(typed);
  let finish = match plain {
    None => "return { status: 'focused' };".to_string(),
    Some(text) => {
      let insert_text =
        if text.is_empty() { String::new() } else { insert_text_js("receiver", &js_string(text)) };
      format!(
        r"{insert_text}
                return {{ status: 'done' }};"
      )
    }
  };
  format!(
    r"(function() {{
                {ELEMENT_EVENTS_JS}
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    return {{ status: 'stale' }};
                }}
                if (el.tagName === 'INPUT' && el.type === 'file') {{
                    return {{ status: 'file' }};
                }}
                var valueControlStatus = wdioSetValueControl(el, {typed});
                if (valueControlStatus) {{
                    return {{ status: valueControlStatus }};
                }}
                {active_element}
                var wasFocused = activeEl === el;
                // Text inside a contenteditable is focused through its editing host.
                var focusTarget = el;
                while (focusTarget.isContentEditable && focusTarget.parentElement
                    && focusTarget.parentElement.isContentEditable) {{
                    focusTarget = focusTarget.parentElement;
                }}
                wdioCaretToEnd(el);
                wdioFocus(focusTarget);
                if (!wasFocused && el.isContentEditable) {{
                    try {{
                        var range = document.createRange();
                        range.selectNodeContents(el);
                        range.collapse(false);
                        var selection = window.getSelection();
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }} catch (e) {{}}
                }}
                {active_element}
                // The body, focus-delegating hosts and an editing host holding the element count as focus.
                var focused = el === document.body || el === document.documentElement || activeEl === focusTarget
                    || wdioContains(el, activeEl);
                if (!focused) {{
                    return {{ status: 'unfocused' }};
                }}
                var receiver = activeEl;
                if ({receiver_editable}) {{
                    // A field that focus was delegated to is only known now, so its caret moves after focus.
                    if (receiver !== el) {{
                        wdioCaretToEnd(receiver);
                    }}
                    wdioRecordPendingChange(receiver, receiver.value);
                }}
                {finish}
            }})()"
  )
}

/// JS inserting a printable run at the focused element's selection, as typing does, so text follows
/// focus when a key moves it. Like the field Send Keys focused, the field the text goes into fires
/// `change` when focus leaves it.
pub fn build_insert_run_script(run: &str) -> String {
  let active_element = deep_active_element_js("activeEl");
  let record_change = record_change_js();
  let insert_text = insert_text_js("activeEl", &js_string(run));
  format!(
    r"(function() {{
                {active_element}
                {record_change}
                {insert_text}
                return true;
            }})()"
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  const NONE: ModifierState = ModifierState { ctrl: false, shift: false, alt: false, meta: false };
  const SHIFT: ModifierState = ModifierState { shift: true, ..NONE };
  const CTRL: ModifierState = ModifierState { ctrl: true, ..NONE };
  const ALT: ModifierState = ModifierState { alt: true, ..NONE };
  const META: ModifierState = ModifierState { meta: true, ..NONE };

  const DISPATCH: &str = "var canceled = !activeEl.dispatchEvent(keyEvent);";
  const GUARD: &str = "if (canceled) {";

  fn down(key: &str, modifiers: ModifierState) -> String {
    key_script(key, true, &modifiers)
  }

  /// The script after the guard that skips the default action of a canceled keydown.
  fn default_action(script: &str) -> &str {
    &script[script.find(GUARD).unwrap_or_else(|| panic!("no guard in {script}"))..]
  }

  #[test]
  fn keys_type_their_character_after_an_uncanceled_keydown() {
    for (value, typed, shifted) in [
      ("a", "a", "A"),
      ("A", "A", "A"),
      ("'", "'", "\""),
      (" ", " ", " "),
      ("\u{E00D}", " ", " "),
      ("\u{E01B}", "1", "1"),
    ] {
      for (modifiers, typed) in [(NONE, typed), (SHIFT, shifted)] {
        let script = down(value, modifiers);
        let action = default_action(&script);
        assert!(action.contains(&format!("var insertedText = {};", js_string(typed))), "{script}");
        assert!(action.contains("inputType: 'insertText'"), "{script}");
        assert!(action.contains("document.execCommand('insertText', false, insertedText)"));
      }
      assert!(!key_script(value, false, &NONE).contains("insertedText"), "{value:?}");
    }
  }

  #[test]
  fn keys_type_nothing_while_control_alt_or_meta_is_held() {
    for modifiers in [CTRL, ALT, META] {
      assert!(!down("x", modifiers).contains("insertedText"));
      assert!(!down("\u{E00D}", modifiers).contains("insertedText"));
    }
  }

  #[test]
  fn control_or_meta_a_selects_all() {
    for modifiers in [CTRL, META] {
      for value in ["a", "A"] {
        let script = down(value, modifiers);
        let action = default_action(&script);
        assert!(action.contains(&format!("if ({}) {{", is_text_field_js("activeEl"))));
        assert!(action.contains("activeEl.select();"));
        assert!(action.contains("document.execCommand('selectAll', false, null);"));
        assert!(!script.contains("insertedText"));
      }
    }
    assert!(!down("a", ALT).contains("activeEl.select()"));
  }

  #[test]
  fn backspace_and_delete_edit_editable_text_fields() {
    for (value, input_type) in [
      ("\u{E003}", "deleteContentBackward"),
      ("\u{8}", "deleteContentBackward"),
      ("\u{E017}", "deleteContentForward"),
      ("\u{E05D}", "deleteContentForward"),
    ] {
      let script = down(value, NONE);
      let action = default_action(&script);
      assert!(action.contains(&format!("if ({}) {{", is_editable_text_field_js("activeEl"))));
      assert!(action.contains(&format!("inputType: '{input_type}'")), "{value:?}");
      // Inputs without a selection API (email, number) edit at the end.
      assert!(action.contains("selStart = selEnd = currentValue.length;"));
      assert!(!key_script(value, false, &NONE).contains(input_type));
    }
  }

  #[test]
  fn enter_breaks_the_line_or_runs_the_shared_enter_key_action_where_focus_is() {
    for value in ["\u{E007}", "\u{E006}", "\n"] {
      let script = down(value, NONE);
      let dispatch = script.find(DISPATCH).unwrap();
      let helpers = script.find(&format!("{{\n                {ELEMENT_EVENTS_JS}")).unwrap();
      let action = &script[helpers + ELEMENT_EVENTS_JS.len()..];
      let uncanceled = action.find("if (!canceled) {").unwrap();
      let refocus = action.find("activeEl = wdioDeepActiveElement();").unwrap();
      let textarea = action.find("if (activeEl.tagName === 'TEXTAREA') {").unwrap();
      let newline = action.find(&format!("var insertedText = {};", js_string("\n"))).unwrap();
      let editor = action.find("} else if (activeEl.isContentEditable) {").unwrap();
      let paragraph = action.find("document.execCommand('insertParagraph', false, null);").unwrap();
      let enter_key = action.find("wdioEnterKey();").unwrap();
      let guard = action.find(GUARD).unwrap();
      assert!(dispatch < helpers, "{script}");
      assert!(uncanceled < refocus && refocus < textarea, "{script}");
      assert!(textarea < newline && newline < editor && editor < paragraph, "{script}");
      assert!(paragraph < enter_key && enter_key < guard, "{script}");
    }
    assert!(
      down("\u{E007}", SHIFT).contains("document.execCommand('insertLineBreak', false, null);")
    );
    for script in [
      key_script("\u{E007}", false, &NONE),
      down("\u{E007}", CTRL),
      down("\u{E007}", ALT),
      down("\u{E007}", META),
    ] {
      assert!(!script.contains("insertedText") && !script.contains("insertParagraph"));
      assert!(!script.contains("wdio"), "{script}");
    }
  }

  #[test]
  fn arrow_keys_step_the_focused_radio_group() {
    for (value, forward) in [
      ("\u{E015}", true),
      ("\u{E014}", true),
      ("\u{E013}", false),
      ("\u{E012}", false),
      ("\u{E05B}", true),
    ] {
      let script = down(value, NONE);
      let action = default_action(&script);
      assert!(action.contains("if (activeEl.tagName === 'INPUT' && activeEl.type === 'radio'"));
      assert!(action.contains("CSS.escape(activeEl.name)"));
      assert!(action.contains(&format!("var nextIndex = {forward}")), "{value:?}");
    }
    assert!(!key_script("\u{E015}", false, &NONE).contains("nextRadio"));
  }

  #[test]
  fn space_presses_and_releases_a_button_whether_or_not_the_event_was_canceled() {
    for (is_down, call) in [(true, "wdioSpaceDown"), (false, "wdioSpaceUp")] {
      for value in ["\u{E00D}", " "] {
        let script = key_script(value, is_down, &SHIFT);
        let dispatch = script.find(DISPATCH).unwrap();
        let space = script.find(&format!("{call}(activeEl, canceled || false);")).unwrap();
        let guard = script.find(GUARD).unwrap();
        assert!(dispatch < space && space < guard, "{script}");
        assert!(script.contains(ELEMENT_EVENTS_JS), "{script}");
      }
      for held in [CTRL, ALT, META] {
        let script = key_script(" ", is_down, &held);
        assert!(script.contains(&format!("{call}(activeEl, canceled || true);")), "{script}");
      }
    }
    assert!(!down("x", NONE).contains("wdioSpaceDown(activeEl"));
  }

  #[test]
  fn default_actions_wait_for_an_uncanceled_keydown() {
    for (script, side_effect) in [
      (down(" ", NONE), "var insertedText"),
      (down("x", NONE), "var insertedText"),
      (down("a", CTRL), "activeEl.select()"),
      (down("\u{E003}", NONE), "nativeInputValueSetter"),
      (down("\u{E017}", NONE), "nativeInputValueSetter"),
      (down("\u{E015}", NONE), "nextRadio.checked"),
    ] {
      let dispatch = script.find(DISPATCH).unwrap();
      let guard = script.find(GUARD).unwrap();
      let effect = script.find(side_effect).unwrap();
      assert!(dispatch < guard && guard < effect, "{script}");
      assert_eq!(script.matches("dispatchEvent(keyEvent)").count(), 1, "{script}");
    }
  }

  #[test]
  fn key_and_input_events_go_to_the_deep_focused_element_and_cross_shadow_boundaries() {
    for script in [down("\u{E003}", NONE), down("x", NONE), down(" ", NONE)] {
      assert!(script.contains("activeEl.shadowRoot.activeElement"), "{script}");
      let script = script.replace(ELEMENT_EVENTS_JS, "");
      let keyboard = script.find("new KeyboardEvent(").unwrap();
      let input = script.find("new InputEvent('input'").unwrap();
      assert!(script[keyboard..].contains("composed: true"));
      assert!(script[input..].contains("composed: true"));
    }
  }

  #[test]
  fn typing_skips_read_only_and_disabled_fields() {
    let editable = is_editable_text_field_js("activeEl");
    assert!(editable.contains("!activeEl.readOnly && !activeEl.disabled"));
    assert!(is_text_field_js("el").contains(
      "['text', 'search', 'url', 'tel', 'email', 'password', 'number'].indexOf(el.type)"
    ));
    for script in
      [down("x", NONE), down("\u{E007}", NONE), down("\u{E003}", NONE), down("\u{E017}", NONE)]
    {
      assert!(script.contains(&format!("if ({editable})")), "{script}");
    }
  }

  #[test]
  fn key_text_is_spliced_as_escaped_literals() {
    for key in ["\"", "\\"] {
      let script = down(key, NONE);
      assert!(script.contains(&format!("key: {}", js_string(key))), "{key}");
      assert!(script.contains(&format!("var insertedText = {}", js_string(key))), "{key}");
    }
    let literal = js_string("a'\"\\\n");
    assert!(!literal.contains('\n'));
    assert_eq!(serde_json::from_str::<String>(&literal).unwrap(), "a'\"\\\n");
  }

  const ENTER_KEY: &str = "\u{E007}";
  const SPACE_KEY: &str = "\u{E00D}";
  const BACKSPACE_KEY: &str = "\u{E003}";
  const PAGE_DOWN_KEY: &str = "\u{E00F}";
  const SHIFT_KEY: &str = "\u{E008}";
  const CONTROL_KEY: &str = "\u{E009}";
  const CONTROL_RIGHT_KEY: &str = "\u{E051}";
  const ALT_KEY: &str = "\u{E00A}";

  fn key(value: &str, is_down: bool, modifiers: ModifierState) -> SendKeysStep {
    SendKeysStep::Key { value: value.to_string(), is_down, modifiers }
  }

  fn text(run: &str) -> SendKeysStep {
    SendKeysStep::Text(run.to_string())
  }

  /// The script after the shared helpers, so a test can't match their definitions.
  fn after_helpers(script: &str) -> &str {
    &script[script.find(ELEMENT_EVENTS_JS).unwrap() + ELEMENT_EVENTS_JS.len()..]
  }

  #[test]
  fn send_keys_types_plain_text_in_one_step() {
    assert_eq!(plan_send_keys("hello"), vec![text("hello")]);
    assert_eq!(plan_send_keys(""), vec![]);
    assert_eq!(plain_text(&plan_send_keys("hello")), Some("hello"));
    assert_eq!(plain_text(&plan_send_keys("")), Some(""));
  }

  #[test]
  fn send_keys_presses_special_keys_newlines_and_backspaces_between_text_runs() {
    let steps = plan_send_keys(&format!("x{ENTER_KEY}a\r\nb\u{8}{SPACE_KEY}c{PAGE_DOWN_KEY}"));
    assert_eq!(
      steps,
      vec![
        text("x"),
        key(ENTER_KEY, true, NONE),
        key(ENTER_KEY, false, NONE),
        text("a"),
        key("\n", true, NONE),
        key("\n", false, NONE),
        text("b"),
        key("\u{8}", true, NONE),
        key("\u{8}", false, NONE),
        key(SPACE_KEY, true, NONE),
        key(SPACE_KEY, false, NONE),
        text("c"),
        key(PAGE_DOWN_KEY, true, NONE),
        key(PAGE_DOWN_KEY, false, NONE),
      ]
    );
    assert_eq!(plain_text(&steps), None);
    assert_eq!(typed_text(&steps), "xabc");
  }

  #[test]
  fn send_keys_never_types_a_special_key() {
    let everything: String = ('\u{E000}'..='\u{E05D}').flat_map(|ch| ['x', ch]).collect();
    for step in plan_send_keys(&everything) {
      if let SendKeysStep::Text(run) = step {
        assert!(run.chars().all(|ch| ch.eq_ignore_ascii_case(&'x')), "{run:?}");
      }
    }
  }

  #[test]
  fn send_keys_holds_modifiers_until_the_end() {
    assert_eq!(
      plan_send_keys(&format!("{SHIFT_KEY}ab{ENTER_KEY}")),
      vec![
        key(SHIFT_KEY, true, SHIFT),
        text("AB"),
        key(ENTER_KEY, true, SHIFT),
        key(ENTER_KEY, false, SHIFT),
        key(SHIFT_KEY, false, NONE),
      ]
    );
  }

  #[test]
  fn send_keys_presses_text_typed_under_control_as_shortcuts_until_the_null_key() {
    assert_eq!(
      plan_send_keys(&format!("{CONTROL_KEY}a{BACKSPACE_KEY}{NULL_KEY}b")),
      vec![
        key(CONTROL_KEY, true, CTRL),
        key("a", true, CTRL),
        key("a", false, CTRL),
        key(BACKSPACE_KEY, true, CTRL),
        key(BACKSPACE_KEY, false, CTRL),
        key(CONTROL_KEY, false, NONE),
        text("b"),
      ]
    );
    assert_eq!(plan_send_keys(&format!("a{NULL_KEY}b")), vec![text("ab")]);
    assert_eq!(plan_send_keys(NULL_KEY), vec![]);
  }

  #[test]
  fn send_keys_toggles_a_repeated_modifier_and_releases_in_code_point_order() {
    let alt_shift = ModifierState { alt: true, ..SHIFT };
    let ctrl_shift = ModifierState { ctrl: true, ..SHIFT };
    assert_eq!(
      plan_send_keys(&format!("{ALT_KEY}{SHIFT_KEY}{ALT_KEY}{CONTROL_KEY}")),
      vec![
        key(ALT_KEY, true, ALT),
        key(SHIFT_KEY, true, alt_shift),
        key(ALT_KEY, false, SHIFT),
        key(CONTROL_KEY, true, ctrl_shift),
        key(SHIFT_KEY, false, CTRL),
        key(CONTROL_KEY, false, NONE),
      ]
    );
  }

  #[test]
  fn send_keys_keeps_control_while_the_other_hand_holds_it() {
    let steps = plan_send_keys(&format!("{CONTROL_KEY}{CONTROL_RIGHT_KEY}a"));
    assert_eq!(steps[2], key("a", true, CTRL));
    assert_eq!(steps[4..], [key(CONTROL_KEY, false, CTRL), key(CONTROL_RIGHT_KEY, false, NONE)]);
  }

  #[test]
  fn send_keys_start_script_sets_a_value_control_before_focusing() {
    let script = build_send_keys_start_script("__wdio_elem_abc", "2026-10-21", Some("2026-10-21"));
    let body = after_helpers(&script);
    let stale = body.find("return { status: 'stale' };").unwrap();
    let file = body.find("el.type === 'file'").unwrap();
    let set = body.find(&format!("wdioSetValueControl(el, {});", js_string("2026-10-21"))).unwrap();
    let focus = body.find("wdioFocus(focusTarget);").unwrap();
    assert!(stale < file && file < set && set < focus, "{body}");
    assert!(!body.contains("throw"));
  }

  #[test]
  fn send_keys_start_script_types_only_into_an_editable_text_field_or_editor() {
    let script = build_send_keys_start_script("__wdio_elem_abc", "x", Some("x"));
    let body = after_helpers(&script);
    let focus = body.find("wdioFocus(focusTarget);").unwrap();
    let unfocused = body.find("return { status: 'unfocused' };").unwrap();
    let record = body.find("wdioRecordPendingChange(receiver, receiver.value);").unwrap();
    let insert = body.find("var insertedText = \"x\";").unwrap();
    assert!(focus < unfocused && unfocused < record && record < insert, "{body}");
    let typed = &body[insert..];
    assert!(typed.contains(&format!("if ({}) {{", is_editable_text_field_js("receiver"))));
    assert!(typed.contains("} else if (receiver.isContentEditable) {"));
    assert!(!body.contains("new Event('change'"));
    assert!(body.contains("return { status: 'done' };"));
  }

  #[test]
  fn send_keys_start_script_leaves_the_steps_for_later_scripts_when_it_presses_keys() {
    let script = build_send_keys_start_script("__wdio_elem_abc", "x", None);
    let body = after_helpers(&script);
    assert!(body.contains("return { status: 'focused' };"));
    assert!(!body.contains("insertedText"));
    let run = build_insert_run_script("x");
    assert!(run.contains("var activeEl = document.activeElement || document.body;"));
    let insert = insert_text_js("activeEl", &js_string("x"));
    assert!(insert.contains(&format!("if ({}) {{", is_editable_text_field_js("activeEl"))));
    assert!(run.contains(&insert));
    assert!(run.contains("inputType: 'insertText'"));
  }

  #[test]
  fn tab_runs_the_shared_tab_key_action_after_its_keydown() {
    for value in ["\u{E004}", "\t"] {
      for modifiers in [NONE, SHIFT, CTRL] {
        let script = down(value, modifiers);
        let dispatch = script.find(DISPATCH).unwrap();
        let tab = script.find("wdioTabKey(keyEvent);").unwrap();
        let guard = script.find(GUARD).unwrap();
        assert!(dispatch < tab && tab < guard, "{script}");
        assert!(script.contains(&format!("{{\n{ELEMENT_EVENTS_JS}\nwdioTabKey(")), "{script}");
      }
    }
    for script in [key_script("\u{E004}", false, &NONE), down(ENTER_KEY, NONE)] {
      assert!(!script.contains("wdioTabKey(keyEvent)"), "{script}");
    }
  }

  #[test]
  fn send_keys_presses_tab_between_text_runs() {
    assert_eq!(
      plan_send_keys("a\tb"),
      vec![text("a"), key("\t", true, NONE), key("\t", false, NONE), text("b")]
    );
  }

  #[test]
  fn send_keys_text_run_records_the_change_its_field_owes_before_typing() {
    let script = build_insert_run_script("hi");
    let focused = script.find("var activeEl = document.activeElement || document.body;").unwrap();
    let record = script.find(&record_change_js()).unwrap();
    let insert = script.find("var insertedText = \"hi\"").unwrap();
    assert!(focused < record && record < insert, "{script}");
  }

  #[test]
  fn key_actions_record_the_change_a_field_owes_before_editing_it() {
    let record = record_change_js();
    assert!(record.contains(&format!("if ({})", is_editable_text_field_js("activeEl"))));
    assert!(record.contains("wdioRecordPendingChange(activeEl, activeEl.value);"));
    for (key, edit) in [
      ("x", "var insertedText"),
      ("\u{E003}", "var currentValue"),
      ("\u{E017}", "var currentValue"),
    ] {
      let script = down(key, NONE);
      let guard = script.find(GUARD).unwrap();
      let recorded = script.find(&record).unwrap();
      assert!(guard < recorded && script[recorded + record.len()..].contains(edit), "{script}");
    }
    let enter = down("\u{E007}", NONE);
    let textarea =
      after_helpers(&enter).split("if (activeEl.tagName === 'TEXTAREA') {").nth(1).unwrap();
    let newline = textarea.find("var insertedText").unwrap();
    assert!(textarea[..newline].contains("wdioRecordPendingChange(activeEl, activeEl.value);"));
    for script in [key_script("x", false, &NONE), down("x", CTRL), down("a", CTRL)] {
      assert!(!script.contains(&record), "{script}");
    }
  }
}
