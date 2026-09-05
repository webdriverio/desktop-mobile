//! Keyboard input mapping — shared, platform-agnostic building blocks.
//!
//! The `build_*_script` helpers dispatch synthetic, untrusted `KeyboardEvent`s; Blink/WebView2
//! refuses those at its trusted-input gates (CloseWatcher / `<dialog>` Escape, popups, fullscreen),
//! so the Windows executor instead maps keys to CDP `Input.dispatchKeyEvent` params
//! ([`to_cdp_key_event`]), which arrive trusted.

use super::executor::ModifierState;

/// Maps a WebDriver special-key value to `(key, code, keyCode)`.
pub fn map_special_key(key: &str) -> Option<(&'static str, &'static str, u32)> {
    let mapped = match key {
        "\u{E007}" => ("Enter", "Enter", 13),
        "\u{E003}" => ("Backspace", "Backspace", 8),
        "\u{E004}" => ("Tab", "Tab", 9),
        "\u{E006}" => ("Enter", "NumpadEnter", 13),
        "\u{E00C}" => ("Escape", "Escape", 27),
        "\u{E00D}" => (" ", "Space", 32),
        "\u{E012}" => ("ArrowLeft", "ArrowLeft", 37),
        "\u{E013}" => ("ArrowUp", "ArrowUp", 38),
        "\u{E014}" => ("ArrowRight", "ArrowRight", 39),
        "\u{E015}" => ("ArrowDown", "ArrowDown", 40),
        "\u{E017}" => ("Delete", "Delete", 46),
        "\u{E031}" => ("F1", "F1", 112),
        "\u{E032}" => ("F2", "F2", 113),
        "\u{E033}" => ("F3", "F3", 114),
        "\u{E034}" => ("F4", "F4", 115),
        "\u{E035}" => ("F5", "F5", 116),
        "\u{E036}" => ("F6", "F6", 117),
        "\u{E037}" => ("F7", "F7", 118),
        "\u{E038}" => ("F8", "F8", 119),
        "\u{E039}" => ("F9", "F9", 120),
        "\u{E03A}" => ("F10", "F10", 121),
        "\u{E03B}" => ("F11", "F11", 122),
        "\u{E03C}" => ("F12", "F12", 123),
        "\u{E008}" => ("Shift", "ShiftLeft", 16),
        "\u{E009}" => ("Control", "ControlLeft", 17),
        "\u{E00A}" => ("Alt", "AltLeft", 18),
        "\u{E03D}" => ("Meta", "MetaLeft", 91),
        _ => return None, // printable character
    };
    Some(mapped)
}

/// The `KeyboardEvent.code` for a printable character.
pub fn regular_key_code_for(key: &str) -> String {
    let ch = key.chars().next().unwrap_or(' ');
    let upper = ch.to_ascii_uppercase();
    if ch.is_ascii_alphabetic() {
        format!("Key{upper}")
    } else if ch.is_ascii_digit() {
        format!("Digit{ch}")
    } else {
        key.to_string()
    }
}

/// JS dispatching a synthetic special-key `KeyboardEvent` plus the value/selection/radio
/// side-effects an untrusted event can't drive itself.
pub fn build_special_key_script(js_key: &str, js_code: &str, key_code: u32, is_down: bool) -> String {
    let event_type = if is_down { "keydown" } else { "keyup" };

    // For special keys that modify input (Backspace, Delete), handle value changes
    if is_down && (js_key == "Backspace" || js_key == "Delete") {
        format!(
            r"(function() {{
                    var activeEl = document.activeElement || document.body;

                    // Dispatch keydown event
                    var keydownEvent = new KeyboardEvent('keydown', {{
                        key: '{js_key}',
                        code: '{js_code}',
                        keyCode: {key_code},
                        which: {key_code},
                        bubbles: true,
                        cancelable: true
                    }});
                    activeEl.dispatchEvent(keydownEvent);

                    // If active element is an input or textarea, handle deletion
                    if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {{
                        var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                            activeEl.tagName === 'INPUT'
                                ? window.HTMLInputElement.prototype
                                : window.HTMLTextAreaElement.prototype,
                            'value'
                        ).set;

                        var currentValue = activeEl.value;
                        var selStart = activeEl.selectionStart;
                        var selEnd = activeEl.selectionEnd;
                        var newValue;
                        var inputType;

                        // Check if there's a selection
                        if (selStart !== selEnd) {{
                            // Delete selection
                            newValue = currentValue.slice(0, selStart) + currentValue.slice(selEnd);
                            inputType = 'deleteContentBackward';
                            // Set cursor position after deletion
                            nativeInputValueSetter.call(activeEl, newValue);
                            activeEl.setSelectionRange(selStart, selStart);
                        }} else if ('{js_key}' === 'Backspace' && selStart > 0) {{
                            newValue = currentValue.slice(0, selStart - 1) + currentValue.slice(selStart);
                            inputType = 'deleteContentBackward';
                            nativeInputValueSetter.call(activeEl, newValue);
                            activeEl.setSelectionRange(selStart - 1, selStart - 1);
                        }} else if ('{js_key}' === 'Delete' && selStart < currentValue.length) {{
                            newValue = currentValue.slice(0, selStart) + currentValue.slice(selStart + 1);
                            inputType = 'deleteContentForward';
                            nativeInputValueSetter.call(activeEl, newValue);
                            activeEl.setSelectionRange(selStart, selStart);
                        }} else {{
                            return true; // Nothing to delete
                        }}

                        // Dispatch input event
                        var inputEvent = new InputEvent('input', {{
                            bubbles: true,
                            cancelable: true,
                            inputType: inputType
                        }});
                        activeEl.dispatchEvent(inputEvent);
                    }}

                    return true;
                }})()"
        )
    } else if is_down
        && (js_key == "ArrowDown" || js_key == "ArrowUp" || js_key == "ArrowLeft" || js_key == "ArrowRight")
    {
        // Handle arrow keys on radio buttons for navigation
        let go_forward = js_key == "ArrowDown" || js_key == "ArrowRight";
        format!(
            r#"(function() {{
                    var activeEl = document.activeElement || document.body;

                    // Dispatch keydown event first
                    var keydownEvent = new KeyboardEvent('keydown', {{
                        key: '{js_key}',
                        code: '{js_code}',
                        keyCode: {key_code},
                        which: {key_code},
                        bubbles: true,
                        cancelable: true
                    }});
                    activeEl.dispatchEvent(keydownEvent);

                    // If active element is a radio button, handle navigation
                    if (activeEl.tagName === 'INPUT' && activeEl.type === 'radio' && activeEl.name) {{
                        var name = activeEl.name;
                        var radios = Array.from(document.querySelectorAll("input[type='radio'][name='" + name + "']"));
                        var currentIndex = radios.indexOf(activeEl);

                        if (currentIndex !== -1 && radios.length > 1) {{
                            var nextIndex;
                            if ({go_forward}) {{
                                // ArrowDown/ArrowRight - go to next
                                nextIndex = (currentIndex + 1) % radios.length;
                            }} else {{
                                // ArrowUp/ArrowLeft - go to previous
                                nextIndex = (currentIndex - 1 + radios.length) % radios.length;
                            }}

                            var nextRadio = radios[nextIndex];
                            nextRadio.checked = true;
                            nextRadio.focus();

                            // Dispatch change event
                            var changeEvent = new Event('change', {{ bubbles: true }});
                            nextRadio.dispatchEvent(changeEvent);
                        }}
                    }}

                    return true;
                }})()"#
        )
    } else {
        format!(
            r"(function() {{
                    var event = new KeyboardEvent('{event_type}', {{
                        key: '{js_key}',
                        code: '{js_code}',
                        keyCode: {key_code},
                        which: {key_code},
                        bubbles: true,
                        cancelable: true
                    }});
                    var activeEl = document.activeElement || document.body;
                    activeEl.dispatchEvent(event);
                    return true;
                }})()"
        )
    }
}

/// JS dispatching a synthetic printable-character `KeyboardEvent` plus the input-value mutation
/// and Ctrl/Meta+A select-all an untrusted event can't drive itself.
pub fn build_regular_key_script(key: &str, code: &str, is_down: bool, modifiers: &ModifierState) -> String {
    let ch = key.chars().next().unwrap_or(' ');
    let key_code = ch as u32;
    let event_type = if is_down { "keydown" } else { "keyup" };

    let escaped_key = key.replace('\\', "\\\\").replace('\'', "\\'");
    let escaped_code = code.replace('\\', "\\\\").replace('\'', "\\'");

    let ctrl_key = modifiers.ctrl;
    let meta_key = modifiers.meta;
    let shift_key = modifiers.shift;
    let alt_key = modifiers.alt;

    // Check for Ctrl+A or Meta+A (select all)
    let is_select_all = is_down && (ch == 'a' || ch == 'A') && (ctrl_key || meta_key);

    if is_select_all {
        // Handle Ctrl+A / Meta+A: select all text
        format!(
            r"(function() {{
                    var activeEl = document.activeElement || document.body;

                    // Dispatch keydown event with modifiers
                    var keydownEvent = new KeyboardEvent('keydown', {{
                        key: '{escaped_key}',
                        code: '{escaped_code}',
                        keyCode: {key_code},
                        which: {key_code},
                        ctrlKey: {ctrl_key},
                        metaKey: {meta_key},
                        shiftKey: {shift_key},
                        altKey: {alt_key},
                        bubbles: true,
                        cancelable: true
                    }});
                    activeEl.dispatchEvent(keydownEvent);

                    // Select all text in input/textarea
                    if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {{
                        activeEl.select();
                    }} else {{
                        document.execCommand('selectAll', false, null);
                    }}

                    return true;
                }})()"
        )
    } else if is_down {
        // For keydown events on printable characters, update input value
        format!(
            r"(function() {{
                    var activeEl = document.activeElement || document.body;

                    // Dispatch keydown event with modifiers
                    var keydownEvent = new KeyboardEvent('keydown', {{
                        key: '{escaped_key}',
                        code: '{escaped_code}',
                        keyCode: {key_code},
                        which: {key_code},
                        ctrlKey: {ctrl_key},
                        metaKey: {meta_key},
                        shiftKey: {shift_key},
                        altKey: {alt_key},
                        bubbles: true,
                        cancelable: true
                    }});
                    activeEl.dispatchEvent(keydownEvent);

                    // If active element is an input or textarea, update value and dispatch input event
                    // Only do this for non-modifier key combos
                    if (!{ctrl_key} && !{meta_key} && !{alt_key}) {{
                        if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {{
                            var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                                activeEl.tagName === 'INPUT'
                                    ? window.HTMLInputElement.prototype
                                    : window.HTMLTextAreaElement.prototype,
                                'value'
                            ).set;

                            var newValue = activeEl.value + '{escaped_key}';
                            nativeInputValueSetter.call(activeEl, newValue);

                            // Dispatch input event
                            var inputEvent = new InputEvent('input', {{
                                bubbles: true,
                                cancelable: true,
                                inputType: 'insertText',
                                data: '{escaped_key}'
                            }});
                            activeEl.dispatchEvent(inputEvent);
                        }}
                    }}

                    return true;
                }})()"
        )
    } else {
        format!(
            r"(function() {{
                    var activeEl = document.activeElement || document.body;
                    var event = new KeyboardEvent('{event_type}', {{
                        key: '{escaped_key}',
                        code: '{escaped_code}',
                        keyCode: {key_code},
                        which: {key_code},
                        ctrlKey: {ctrl_key},
                        metaKey: {meta_key},
                        shiftKey: {shift_key},
                        altKey: {alt_key},
                        bubbles: true,
                        cancelable: true
                    }});
                    activeEl.dispatchEvent(event);
                    return true;
                }})()"
        )
    }
}

/// JS that focuses an element and appends `text` (inputs/textareas/contenteditable).
pub fn build_send_keys_script(js_var: &str, text: &str) -> String {
    let escaped = text.replace('\\', "\\\\").replace('`', "\\`").replace('$', "\\$");
    format!(
        r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}
                el.focus();

                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {{
                    var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                        el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype,
                        'value'
                    ).set;

                    var newValue = el.value + `{escaped}`;
                    nativeInputValueSetter.call(el, newValue);

                    var inputEvent = new InputEvent('input', {{
                        bubbles: true,
                        cancelable: true,
                        inputType: 'insertText',
                        data: `{escaped}`
                    }});
                    el.dispatchEvent(inputEvent);

                    var changeEvent = new Event('change', {{ bubbles: true }});
                    el.dispatchEvent(changeEvent);
                }} else if (el.isContentEditable) {{
                    document.execCommand('insertText', false, `{escaped}`);
                }}
                return true;
            }})()"
    )
}

// =============================================================================
// CDP (Chrome DevTools Protocol) key mapping — Windows/WebView2 trusted input.
//
// Gated to Windows and test builds so the pure mapping is unit-tested on every OS without
// producing dead-code warnings where WebView2 CDP is unavailable.
// =============================================================================

/// A resolved `Input.dispatchKeyEvent` parameter set.
#[cfg(any(target_os = "windows", test))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CdpKeyEvent {
    pub event_type: &'static str,
    pub key: String,
    pub code: String,
    /// Also sent as `nativeVirtualKeyCode`.
    pub windows_virtual_key_code: u32,
    /// CDP modifier bitmask (Alt=1, Ctrl=2, Meta=4, Shift=8).
    pub modifiers: u32,
    /// The character the key inserts, set only when it produces one (`None` for control/navigation
    /// keys and key-up); its presence is what makes the renderer insert the character.
    pub text: Option<String>,
}

#[cfg(any(target_os = "windows", test))]
impl CdpKeyEvent {
    /// Serialize to the JSON parameters object for `Input.dispatchKeyEvent`.
    pub fn to_params_json(&self) -> String {
        let mut params = serde_json::json!({
            "type": self.event_type,
            "key": self.key,
            "code": self.code,
            "windowsVirtualKeyCode": self.windows_virtual_key_code,
            "nativeVirtualKeyCode": self.windows_virtual_key_code,
            "modifiers": self.modifiers,
        });
        if let Some(text) = &self.text {
            params["text"] = serde_json::Value::String(text.clone());
            params["unmodifiedText"] = serde_json::Value::String(text.clone());
        }
        params.to_string()
    }
}

/// CDP modifier bitmask for the current modifier state.
#[cfg(any(target_os = "windows", test))]
pub fn cdp_modifiers(modifiers: &ModifierState) -> u32 {
    let mut bits = 0;
    if modifiers.alt {
        bits |= 1;
    }
    if modifiers.ctrl {
        bits |= 2;
    }
    if modifiers.meta {
        bits |= 4;
    }
    if modifiers.shift {
        bits |= 8;
    }
    bits
}

/// Virtual key code for a printable character; non-alphanumerics carry 0 and rely on `text`.
#[cfg(any(target_os = "windows", test))]
fn printable_virtual_key_code(ch: char) -> u32 {
    if ch.is_ascii_alphabetic() {
        ch.to_ascii_uppercase() as u32
    } else if ch.is_ascii_digit() {
        ch as u32
    } else {
        0
    }
}

/// Resolve a WebDriver key value + modifier state into an `Input.dispatchKeyEvent` parameter set.
#[cfg(any(target_os = "windows", test))]
pub fn to_cdp_key_event(key: &str, is_down: bool, modifiers: &ModifierState) -> CdpKeyEvent {
    let event_type = if is_down { "keyDown" } else { "keyUp" };
    let cdp_mods = cdp_modifiers(modifiers);

    if let Some((js_key, js_code, key_code)) = map_special_key(key) {
        // Enter/Space produce a character; other special keys don't.
        let text = if is_down {
            match js_key {
                "Enter" => Some("\r".to_string()),
                " " => Some(" ".to_string()),
                _ => None,
            }
        } else {
            None
        };
        CdpKeyEvent {
            event_type,
            key: js_key.to_string(),
            code: js_code.to_string(),
            windows_virtual_key_code: key_code,
            modifiers: cdp_mods,
            text,
        }
    } else {
        let ch = key.chars().next().unwrap_or(' ');
        // No text under a Ctrl/Alt/Meta chord (a shortcut, not typing); Shift still types.
        let text = if is_down && !modifiers.ctrl && !modifiers.alt && !modifiers.meta {
            Some(key.to_string())
        } else {
            None
        };
        CdpKeyEvent {
            event_type,
            key: key.to_string(),
            code: regular_key_code_for(key),
            windows_virtual_key_code: printable_virtual_key_code(ch),
            modifiers: cdp_mods,
            text,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const ESCAPE: &str = "\u{E00C}";
    const ENTER: &str = "\u{E007}";
    const SPACE: &str = "\u{E00D}";
    const ARROW_DOWN: &str = "\u{E015}";
    const CONTROL: &str = "\u{E009}";

    fn mods(ctrl: bool, shift: bool, alt: bool, meta: bool) -> ModifierState {
        ModifierState { ctrl, shift, alt, meta }
    }

    #[test]
    fn map_special_key_maps_control_block_and_rejects_printables() {
        assert_eq!(map_special_key(ESCAPE), Some(("Escape", "Escape", 27)));
        assert_eq!(map_special_key(ENTER), Some(("Enter", "Enter", 13)));
        assert_eq!(map_special_key(ARROW_DOWN), Some(("ArrowDown", "ArrowDown", 40)));
        assert_eq!(map_special_key("a"), None);
        assert_eq!(map_special_key("5"), None);
    }

    #[test]
    fn regular_key_code_for_derives_code() {
        assert_eq!(regular_key_code_for("a"), "KeyA");
        assert_eq!(regular_key_code_for("A"), "KeyA");
        assert_eq!(regular_key_code_for("5"), "Digit5");
        assert_eq!(regular_key_code_for("!"), "!");
    }

    #[test]
    fn cdp_modifiers_bitmask() {
        assert_eq!(cdp_modifiers(&mods(false, false, false, false)), 0);
        assert_eq!(cdp_modifiers(&mods(true, false, false, false)), 2); // ctrl
        assert_eq!(cdp_modifiers(&mods(false, true, false, false)), 8); // shift
        assert_eq!(cdp_modifiers(&mods(true, true, false, false)), 10); // ctrl+shift
        assert_eq!(cdp_modifiers(&mods(true, true, true, true)), 15); // all
    }

    #[test]
    fn escape_maps_to_trusted_keydown_without_text() {
        let ev = to_cdp_key_event(ESCAPE, true, &mods(false, false, false, false));
        assert_eq!(ev.event_type, "keyDown");
        assert_eq!(ev.key, "Escape");
        assert_eq!(ev.code, "Escape");
        assert_eq!(ev.windows_virtual_key_code, 27);
        assert_eq!(ev.text, None);
    }

    #[test]
    fn escape_keyup_is_keyup() {
        let ev = to_cdp_key_event(ESCAPE, false, &mods(false, false, false, false));
        assert_eq!(ev.event_type, "keyUp");
        assert_eq!(ev.text, None);
    }

    #[test]
    fn printable_char_carries_text_and_vk() {
        let ev = to_cdp_key_event("a", true, &mods(false, false, false, false));
        assert_eq!(ev.key, "a");
        assert_eq!(ev.code, "KeyA");
        assert_eq!(ev.windows_virtual_key_code, 65);
        assert_eq!(ev.text.as_deref(), Some("a"));

        let digit = to_cdp_key_event("5", true, &mods(false, false, false, false));
        assert_eq!(digit.code, "Digit5");
        assert_eq!(digit.windows_virtual_key_code, 53);
        assert_eq!(digit.text.as_deref(), Some("5"));
    }

    #[test]
    fn printable_char_under_ctrl_chord_has_no_text() {
        let ev = to_cdp_key_event("a", true, &mods(true, false, false, false));
        assert_eq!(ev.text, None);
        assert_eq!(ev.modifiers, 2);
    }

    #[test]
    fn printable_char_with_shift_still_types() {
        let ev = to_cdp_key_event("A", true, &mods(false, true, false, false));
        assert_eq!(ev.text.as_deref(), Some("A"));
        assert_eq!(ev.modifiers, 8);
    }

    #[test]
    fn enter_and_space_carry_their_text() {
        assert_eq!(
            to_cdp_key_event(ENTER, true, &mods(false, false, false, false)).text.as_deref(),
            Some("\r")
        );
        let space = to_cdp_key_event(SPACE, true, &mods(false, false, false, false));
        assert_eq!(space.key, " ");
        assert_eq!(space.code, "Space");
        assert_eq!(space.text.as_deref(), Some(" "));
    }

    #[test]
    fn to_params_json_shape() {
        let ev = to_cdp_key_event("a", true, &mods(false, false, false, false));
        let v: Value = serde_json::from_str(&ev.to_params_json()).expect("valid json");
        assert_eq!(v["type"], "keyDown");
        assert_eq!(v["key"], "a");
        assert_eq!(v["code"], "KeyA");
        assert_eq!(v["windowsVirtualKeyCode"], 65);
        assert_eq!(v["nativeVirtualKeyCode"], 65);
        assert_eq!(v["modifiers"], 0);
        assert_eq!(v["text"], "a");
        assert_eq!(v["unmodifiedText"], "a");

        // A pure control key omits the text fields entirely.
        let esc = to_cdp_key_event(ESCAPE, true, &mods(false, false, false, false));
        let ev: Value = serde_json::from_str(&esc.to_params_json()).expect("valid json");
        assert!(ev.get("text").is_none());
        assert!(ev.get("unmodifiedText").is_none());
    }

    #[test]
    fn build_special_key_script_dispatches_keyboard_event() {
        let script = build_special_key_script("Escape", "Escape", 27, true);
        assert!(script.contains("new KeyboardEvent('keydown'"));
        assert!(script.contains("key: 'Escape'"));
        assert!(script.contains("keyCode: 27"));

        let up = build_special_key_script("Escape", "Escape", 27, false);
        assert!(up.contains("new KeyboardEvent('keyup'"));
    }

    #[test]
    fn build_regular_key_script_carries_modifiers_and_value_mutation() {
        let script = build_regular_key_script("a", "KeyA", true, &mods(false, false, false, false));
        assert!(script.contains("key: 'a'"));
        assert!(script.contains("inputType: 'insertText'"));

        // Ctrl+A select-all branch.
        let select_all = build_regular_key_script("a", "KeyA", true, &mods(true, false, false, false));
        assert!(select_all.contains("activeEl.select()"));
    }

    #[test]
    fn build_send_keys_script_focuses_and_inserts() {
        let script = build_send_keys_script("__wd_el_abc", "hi");
        assert!(script.contains("window.__wd_el_abc"));
        assert!(script.contains("el.focus()"));
        assert!(script.contains("`hi`"));
    }

    #[test]
    fn control_modifier_key_maps() {
        let ev = to_cdp_key_event(CONTROL, true, &mods(false, false, false, false));
        assert_eq!(ev.key, "Control");
        assert_eq!(ev.code, "ControlLeft");
        assert_eq!(ev.windows_virtual_key_code, 17);
    }
}
