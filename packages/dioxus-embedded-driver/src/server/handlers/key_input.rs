//! Key events and the default actions a browser runs for them. Synthetic key events have no
//! default action, so after an uncancelled keydown the driver types, deletes or breaks the line
//! itself, as the Tauri embedded driver does.

use super::actions::{map_special_key, regular_key, single_char, Modifiers as ModifierState};
use super::element::ELEMENT_EVENTS_JS;

// The functions below `key_script` are copies of tauri-plugin-wdio-webdriver's key_input.rs, since
// a published crate can only include its own files. test/scripts/key-tables.spec.ts checks the
// copies match.

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

/// A JS string literal for `text` that is safe to splice into a script.
pub(super) fn js_string(text: &str) -> String {
  serde_json::Value::from(text).to_string()
}

/// JS binding `var` to the focused element, looking through open shadow roots, or to null in an
/// empty document.
fn deep_active_element_js(var: &str) -> String {
  format!(
    r"var {var} = document.activeElement || document.body;
                while ({var} && {var}.shadowRoot && {var}.shadowRoot.activeElement) {{
                    {var} = {var}.shadowRoot.activeElement;
                }}"
  )
}

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
    "Backspace" | "Delete" => delete_js(js_key == "Backspace"),
    "ArrowDown" | "ArrowRight" => radio_step_js(true),
    "ArrowUp" | "ArrowLeft" => radio_step_js(false),
    "Enter" if !(modifiers.ctrl || modifiers.meta || modifiers.alt) => enter_js(modifiers.shift),
    _ => String::new(),
  };
  key_event_script(js_key, js_code, key_code, is_down, modifiers, "", &default_action)
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
/// share the main key's (Numpad5 is 101, not 53).
fn build_printable_key_script(
  key: &str,
  code: &str,
  key_code: u32,
  is_down: bool,
  modifiers: &ModifierState,
) -> String {
  let is_select_all = matches!(key, "a" | "A") && (modifiers.ctrl || modifiers.meta);
  let default_action = if !is_down {
    String::new()
  } else if is_select_all {
    select_all_js()
  } else if modifiers.ctrl || modifiers.meta || modifiers.alt {
    String::new()
  } else {
    insert_text_js("activeEl", &js_string(key))
  };
  let after_dispatch = if key == " " { space_js(is_down, modifiers) } else { String::new() };
  key_event_script(key, code, key_code, is_down, modifiers, &after_dispatch, &default_action)
}

/// JS for Space on a button, which clicks it after the keyup, as in a browser. It runs whether or
/// not a handler canceled the event, as a canceled keydown or keyup stops the click.
fn space_js(is_down: bool, modifiers: &ModifierState) -> String {
  let call = if is_down { "wdioSpaceDown" } else { "wdioSpaceUp" };
  let held = modifiers.ctrl || modifiers.meta || modifiers.alt;
  format!("{{\n{ELEMENT_EVENTS_JS}\n{call}(activeEl, canceled || {held});\n}}")
}

/// JS dispatching one keydown or keyup to the deep focused element, then running `after_dispatch`,
/// which can read whether a handler canceled the event from `canceled`, and `default_action` unless
/// one did. A handler can move focus, and as a browser types where focus went, `default_action`
/// gets the element focused after the dispatch as `activeEl` and the event's target as `keyTarget`.
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
  let default_action = if default_action.is_empty() {
    String::new()
  } else {
    format!(
      r"var keyTarget = activeEl;
                {active_element}
                if (!activeEl) {{
                    return true;
                }}
                {default_action}"
    )
  };
  format!(
    r"(function() {{
                {active_element}
                if (!activeEl) {{
                    return true;
                }}
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

/// JS moving the checked radio to the next (`forward`) or previous button in the group of the radio
/// the keydown went to, which a browser steps even if a handler moved focus. Fires `change`.
fn radio_step_js(forward: bool) -> String {
  format!(
    r#"if (keyTarget.tagName === 'INPUT' && keyTarget.type === 'radio' && keyTarget.name) {{
                    var radios = Array.from(keyTarget.getRootNode().querySelectorAll(
                        'input[type="radio"][name="' + CSS.escape(keyTarget.name) + '"]'
                    ));
                    var currentIndex = radios.indexOf(keyTarget);
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

/// JS for Enter's default action: a line break in a textarea or contenteditable, a click on a
/// button, or an input's `change` and form submission.
fn enter_js(shift: bool) -> String {
  let insert_newline = insert_text_js("activeEl", &js_string("\n"));
  let command = if shift { "insertLineBreak" } else { "insertParagraph" };
  format!(
    r"if (activeEl.tagName === 'TEXTAREA') {{
                    {insert_newline}
                }} else if (activeEl.isContentEditable) {{
                    document.execCommand('{command}', false, null);
                }} else {{
                    {ELEMENT_EVENTS_JS}
                    wdioEnterKey();
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
    for (value, typed) in
      [("a", "a"), ("A", "A"), ("'", "'"), (" ", " "), ("\u{E00D}", " "), ("\u{E01B}", "1")]
    {
      for modifiers in [NONE, SHIFT] {
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
  fn enter_breaks_lines_in_textareas_and_editors_and_runs_the_shared_enter_key_action_elsewhere() {
    for value in ["\u{E007}", "\u{E006}", "\n"] {
      let script = down(value, NONE);
      let action = default_action(&script);
      let textarea = action.find("if (activeEl.tagName === 'TEXTAREA') {").unwrap();
      let newline = action.find(&format!("var insertedText = {};", js_string("\n"))).unwrap();
      let editor = action.find("} else if (activeEl.isContentEditable) {").unwrap();
      let paragraph = action.find("document.execCommand('insertParagraph', false, null);").unwrap();
      let helpers = action.find(ELEMENT_EVENTS_JS).unwrap();
      let enter_key = action.find("wdioEnterKey();").unwrap();
      assert!(textarea < newline && newline < editor && editor < paragraph, "{script}");
      assert!(paragraph < helpers && helpers < enter_key, "{script}");
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
      assert!(!script.contains("wdioEnterKey"), "{script}");
    }
  }

  #[test]
  fn arrow_keys_step_the_radio_group_the_keydown_went_to() {
    for (value, forward) in [
      ("\u{E015}", true),
      ("\u{E014}", true),
      ("\u{E013}", false),
      ("\u{E012}", false),
      ("\u{E05B}", true),
    ] {
      let script = down(value, NONE);
      let action = default_action(&script);
      assert!(action.contains("if (keyTarget.tagName === 'INPUT' && keyTarget.type === 'radio'"));
      assert!(action.contains("CSS.escape(keyTarget.name)"));
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
        // A block keeps the helpers' declarations out of the default action's scope.
        assert!(script.contains(&format!("{{\n{ELEMENT_EVENTS_JS}\n{call}(")), "{script}");
      }
      for held in [CTRL, ALT, META] {
        let script = key_script(" ", is_down, &held);
        assert!(script.contains(&format!("{call}(activeEl, canceled || true);")), "{script}");
      }
    }
    assert!(!down("x", NONE).contains("wdioSpace"));
  }

  #[test]
  fn default_actions_go_to_the_element_focused_after_an_uncanceled_keydown() {
    for (script, side_effect) in [
      (down("x", NONE), "var insertedText"),
      (down("a", CTRL), "activeEl.select()"),
      (down("\u{E003}", NONE), "nativeInputValueSetter"),
      (down("\u{E017}", NONE), "nativeInputValueSetter"),
      (down("\u{E015}", NONE), "nextRadio.checked"),
      (down("\u{E007}", NONE), "insertParagraph"),
    ] {
      let script = script.replacen(ELEMENT_EVENTS_JS, "", 1);
      let dispatch = script.find(DISPATCH).unwrap();
      let guard = script.find(GUARD).unwrap();
      let target = script.find("var keyTarget = activeEl;").unwrap();
      let refocus = script.rfind("var activeEl = document.activeElement").unwrap();
      let effect = script.find(side_effect).unwrap();
      assert!(dispatch < guard && guard < target, "{script}");
      assert!(target < refocus && refocus < effect, "{script}");
      assert_eq!(script.matches("dispatchEvent(keyEvent)").count(), 1, "{script}");
    }
    let page_down = down("\u{E00F}", NONE);
    assert_eq!(page_down.matches("var activeEl = ").count(), 1, "{page_down}");
    assert!(!page_down.contains("keyTarget"));
  }

  #[test]
  fn key_and_input_events_go_to_the_deep_focused_element_and_cross_shadow_boundaries() {
    for script in [down("\u{E003}", NONE), down("x", NONE), down(" ", NONE)] {
      assert!(script.contains("activeEl.shadowRoot.activeElement"), "{script}");
      let script = script.replacen(ELEMENT_EVENTS_JS, "", 1);
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
}
