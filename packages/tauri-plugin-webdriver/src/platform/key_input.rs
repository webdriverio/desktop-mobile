//! Keyboard input mapping — shared, platform-agnostic building blocks.

use std::collections::BTreeSet;

use super::executor::ModifierState;

/// The WebDriver null key; in Element Send Keys it releases every held modifier.
pub const NULL_KEY: &str = "\u{E000}";

/// Maps every WebDriver special-key value (U+E000–U+E05D) to `(key, code, keyCode)` per the W3C
/// tables and a US keyboard, so none is ever typed as text.
pub fn map_special_key(key: &str) -> Option<(&'static str, &'static str, u32)> {
    let mut chars = key.chars();
    let (Some(ch), None) = (chars.next(), chars.next()) else {
        return None;
    };
    let mapped = match ch {
        '\u{E000}' => ("Unidentified", "", 0),
        '\u{E001}' => ("Cancel", "", 3),
        '\u{E002}' => ("Help", "Help", 47),
        '\u{E003}' => ("Backspace", "Backspace", 8),
        '\u{E004}' => ("Tab", "Tab", 9),
        '\u{E005}' => ("Clear", "", 12),
        // The spec's code table puts the main Enter key on U+E006 ("Return") and NumpadEnter on
        // U+E007, but clients send U+E007 for Enter, so it keeps the main key's code.
        '\u{E006}' => ("Enter", "NumpadEnter", 13),
        '\u{E007}' => ("Enter", "Enter", 13),
        '\u{E008}' => ("Shift", "ShiftLeft", 16),
        '\u{E009}' => ("Control", "ControlLeft", 17),
        '\u{E00A}' => ("Alt", "AltLeft", 18),
        '\u{E00B}' => ("Pause", "Pause", 19),
        '\u{E00C}' => ("Escape", "Escape", 27),
        '\u{E00D}' => (" ", "Space", 32),
        '\u{E00E}' => ("PageUp", "PageUp", 33),
        '\u{E00F}' => ("PageDown", "PageDown", 34),
        '\u{E010}' => ("End", "End", 35),
        '\u{E011}' => ("Home", "Home", 36),
        '\u{E012}' => ("ArrowLeft", "ArrowLeft", 37),
        '\u{E013}' => ("ArrowUp", "ArrowUp", 38),
        '\u{E014}' => ("ArrowRight", "ArrowRight", 39),
        '\u{E015}' => ("ArrowDown", "ArrowDown", 40),
        '\u{E016}' => ("Insert", "Insert", 45),
        '\u{E017}' => ("Delete", "Delete", 46),
        // The spec's code table has no row for U+E018; this is the US-layout `;` key.
        '\u{E018}' => (";", "Semicolon", 186),
        '\u{E019}' => ("=", "NumpadEqual", 187),
        '\u{E01A}' => ("0", "Numpad0", 96),
        '\u{E01B}' => ("1", "Numpad1", 97),
        '\u{E01C}' => ("2", "Numpad2", 98),
        '\u{E01D}' => ("3", "Numpad3", 99),
        '\u{E01E}' => ("4", "Numpad4", 100),
        '\u{E01F}' => ("5", "Numpad5", 101),
        '\u{E020}' => ("6", "Numpad6", 102),
        '\u{E021}' => ("7", "Numpad7", 103),
        '\u{E022}' => ("8", "Numpad8", 104),
        '\u{E023}' => ("9", "Numpad9", 105),
        '\u{E024}' => ("*", "NumpadMultiply", 106),
        '\u{E025}' => ("+", "NumpadAdd", 107),
        '\u{E026}' => (",", "NumpadComma", 108),
        '\u{E027}' => ("-", "NumpadSubtract", 109),
        '\u{E028}' => (".", "NumpadDecimal", 110),
        '\u{E029}' => ("/", "NumpadDivide", 111),
        '\u{E031}' => ("F1", "F1", 112),
        '\u{E032}' => ("F2", "F2", 113),
        '\u{E033}' => ("F3", "F3", 114),
        '\u{E034}' => ("F4", "F4", 115),
        '\u{E035}' => ("F5", "F5", 116),
        '\u{E036}' => ("F6", "F6", 117),
        '\u{E037}' => ("F7", "F7", 118),
        '\u{E038}' => ("F8", "F8", 119),
        '\u{E039}' => ("F9", "F9", 120),
        '\u{E03A}' => ("F10", "F10", 121),
        '\u{E03B}' => ("F11", "F11", 122),
        '\u{E03C}' => ("F12", "F12", 123),
        '\u{E03D}' => ("Meta", "MetaLeft", 91),
        '\u{E040}' => ("ZenkakuHankaku", "", 0),
        '\u{E050}' => ("Shift", "ShiftRight", 16),
        '\u{E051}' => ("Control", "ControlRight", 17),
        '\u{E052}' => ("Alt", "AltRight", 18),
        '\u{E053}' => ("Meta", "MetaRight", 92),
        '\u{E054}' => ("PageUp", "Numpad9", 33),
        '\u{E055}' => ("PageDown", "Numpad3", 34),
        '\u{E056}' => ("End", "Numpad1", 35),
        '\u{E057}' => ("Home", "Numpad7", 36),
        '\u{E058}' => ("ArrowLeft", "Numpad4", 37),
        '\u{E059}' => ("ArrowUp", "Numpad8", 38),
        '\u{E05A}' => ("ArrowRight", "Numpad6", 39),
        '\u{E05B}' => ("ArrowDown", "Numpad2", 40),
        '\u{E05C}' => ("Insert", "Numpad0", 45),
        '\u{E05D}' => ("Delete", "NumpadDecimal", 46),
        // Code points the spec leaves unassigned still dispatch as a key rather than as text.
        '\u{E000}'..='\u{E05D}' => ("Unidentified", "", 0),
        _ => return None, // printable character
    };
    Some(mapped)
}

/// Whether a normalized key value types a character: Space, `;`, `=` and the numpad digits and
/// operators.
pub fn is_printable_key(js_key: &str) -> bool {
    js_key.chars().count() == 1
}

/// Whether a WebDriver key value is a left- or right-hand Shift/Control/Alt/Meta.
pub fn is_modifier_key(key: &str) -> bool {
    matches!(
        map_special_key(key),
        Some(("Shift" | "Control" | "Alt" | "Meta", _, _))
    )
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

/// A JS string literal for `text` that is safe to splice into a script.
pub fn js_string(text: &str) -> String {
    serde_json::Value::from(text).to_string()
}

/// JS binding `var` to the focused element, looking through open shadow roots.
pub fn deep_active_element_js(var: &str) -> String {
    format!(
        r"var {var} = document.activeElement || document.body;
                while ({var}.shadowRoot && {var}.shadowRoot.activeElement) {{
                    {var} = {var}.shadowRoot.activeElement;
                }}"
    )
}

/// JS expression that is true when `el` takes typed text: a textarea or a text-like input.
pub fn is_text_field_js(el: &str) -> String {
    format!(
        "({el}.tagName === 'TEXTAREA' || ({el}.tagName === 'INPUT' && \
         ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].indexOf({el}.type) !== -1))"
    )
}

/// JS expression that is true when typing may change `el`'s value: a text field that is neither
/// read-only nor disabled.
pub fn is_editable_text_field_js(el: &str) -> String {
    let text_field = is_text_field_js(el);
    format!("({text_field} && !{el}.readOnly && !{el}.disabled)")
}

/// JS expression that is true when `el` is a non-typeable form control whose value Send Keys sets
/// directly (W3C), such as a date or colour input.
pub fn is_value_control_js(el: &str) -> String {
    format!(
        "({el}.tagName === 'INPUT' && \
         ['color', 'date', 'datetime-local', 'month', 'range', 'time', 'week'].indexOf({el}.type) !== -1)"
    )
}

/// JS dispatching a synthetic special-key `KeyboardEvent` plus the editing, radio and line-break
/// side-effects an untrusted event can't drive itself, skipped when a handler cancels the keydown.
pub fn build_special_key_script(
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
        "Enter" if !(modifiers.ctrl || modifiers.meta || modifiers.alt) => {
            line_break_js(modifiers.shift)
        }
        _ => String::new(),
    };
    key_event_script(
        js_key,
        js_code,
        key_code,
        is_down,
        modifiers,
        &default_action,
    )
}

/// JS dispatching a synthetic printable-character `KeyboardEvent` plus the insertion or Ctrl/Meta+A
/// select-all an untrusted event can't drive itself, skipped when a handler cancels the keydown.
pub fn build_regular_key_script(
    key: &str,
    code: &str,
    is_down: bool,
    modifiers: &ModifierState,
) -> String {
    let ch = key.chars().next().unwrap_or(' ');
    build_printable_key_script(key, code, ch as u32, is_down, modifiers)
}

/// [`build_regular_key_script`] with an explicit `keyCode`, for printable special keys whose
/// legacy code differs from the character's (e.g. Numpad5 is 101, not 53).
pub fn build_printable_key_script(
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
    key_event_script(key, code, key_code, is_down, modifiers, &default_action)
}

/// JS dispatching one keydown or keyup to the deep focused element, then running `default_action`
/// unless a handler canceled the event.
fn key_event_script(
    key: &str,
    code: &str,
    key_code: u32,
    is_down: bool,
    modifiers: &ModifierState,
    default_action: &str,
) -> String {
    let active_element = deep_active_element_js("activeEl");
    let event_type = if is_down { "keydown" } else { "keyup" };
    let key = js_string(key);
    let code = js_string(code);
    let ModifierState {
        ctrl,
        shift,
        alt,
        meta,
    } = *modifiers;
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
                if (!activeEl.dispatchEvent(keyEvent)) {{
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
        (
            "selStart > 0",
            "selStart - 1",
            "selStart",
            "deleteContentBackward",
        )
    } else {
        (
            "selStart < currentValue.length",
            "selStart",
            "selStart + 1",
            "deleteContentForward",
        )
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

/// JS for Enter: a line break in a textarea or contenteditable (Shift+Enter inserts a `<br>`
/// rather than a new paragraph). Inputs get none.
fn line_break_js(shift: bool) -> String {
    let insert_newline = insert_text_js("activeEl", &js_string("\n"));
    let command = if shift {
        "insertLineBreak"
    } else {
        "insertParagraph"
    };
    format!(
        r"if (activeEl.tagName === 'TEXTAREA') {{
                    {insert_newline}
                }} else if (activeEl.isContentEditable) {{
                    document.execCommand('{command}', false, null);
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

/// One segment of an element send-keys request: a run of printable text, or a single special key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeySegment {
    Text(String),
    Special(String),
}

/// Split send-keys text into printable runs and individual special keys, preserving order.
pub fn segment_send_keys(text: &str) -> Vec<KeySegment> {
    let mut segments = Vec::new();
    let mut run = String::new();
    for ch in text.chars() {
        if map_special_key(&ch.to_string()).is_some() {
            if !run.is_empty() {
                segments.push(KeySegment::Text(std::mem::take(&mut run)));
            }
            segments.push(KeySegment::Special(ch.to_string()));
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
pub struct HeldModifiers {
    keys: BTreeSet<String>,
}

impl HeldModifiers {
    /// The modifiers among `keys`, e.g. a session's keys still pressed from earlier actions.
    pub fn from_keys<'a>(keys: impl IntoIterator<Item = &'a String>) -> Self {
        let mut held = Self::default();
        for key in keys {
            held.press(key);
        }
        held
    }

    /// Record a key press; returns whether it newly held a modifier.
    pub fn press(&mut self, key: &str) -> bool {
        is_modifier_key(key) && self.keys.insert(key.to_string())
    }

    /// Record a key release; returns whether it released a held modifier.
    pub fn release(&mut self, key: &str) -> bool {
        self.keys.remove(key)
    }

    /// The modifier flags for the keys still held.
    pub fn state(&self) -> ModifierState {
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
    pub fn keys(&self) -> Vec<String> {
        self.keys.iter().cloned().collect()
    }
}

/// One step of an element send-keys request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendKeysStep {
    /// Printable text inserted into the element.
    Text(String),
    /// A key event for the focused element, dispatched as the actions path dispatches it.
    Key {
        value: String,
        is_down: bool,
        modifiers: ModifierState,
    },
}

/// Send-keys text as ordered steps: a modifier stays held until it's pressed again, the null key or
/// the end, and text typed under Control, Alt or Meta is pressed key by key as shortcuts.
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
            KeySegment::Text(run) => push_text(&mut steps, &run),
            KeySegment::Special(key) if key == NULL_KEY => {
                release_held_modifiers(&mut steps, &mut held);
            }
            KeySegment::Special(key) if is_modifier_key(&key) => {
                let is_down = held.press(&key);
                if !is_down {
                    held.release(&key);
                }
                steps.push(SendKeysStep::Key {
                    value: key,
                    is_down,
                    modifiers: held.state(),
                });
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
        steps.push(SendKeysStep::Key {
            value: value.to_string(),
            is_down,
            modifiers,
        });
    }
}

/// Key-up every held modifier in code-point order, as the spec's "clear the modifier key state"
/// releases them. Each key-up carries the flags left after its own release.
fn release_held_modifiers(steps: &mut Vec<SendKeysStep>, held: &mut HeldModifiers) {
    for key in held.keys() {
        held.release(&key);
        steps.push(SendKeysStep::Key {
            value: key,
            is_down: false,
            modifiers: held.state(),
        });
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

/// JS starting send keys: sets a value control's value to `typed`, or focuses the element once and,
/// for a `plain` request, types it too. Returns `{ status, value }` and never throws.
pub fn build_send_keys_start_script(js_var: &str, typed: &str, plain: Option<&str>) -> String {
    let active_element = deep_active_element_js("activeEl");
    let text_field = is_text_field_js("el");
    let receiver_text_field = is_text_field_js("receiver");
    let value_control = is_value_control_js("el");
    let typed = js_string(typed);
    let finish = match plain {
        None => format!(
            r"window.{js_var}__receiver = receiver;
                return {{ status: 'focused', value: initialValue }};"
        ),
        Some(text) => {
            let insert_text = if text.is_empty() {
                String::new()
            } else {
                insert_text_js("receiver", &js_string(text))
            };
            format!(
                r"{insert_text}
                if (initialValue !== null && receiver.value !== initialValue) {{
                    receiver.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
                return {{ status: 'done' }};"
            )
        }
    };
    format!(
        r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    return {{ status: 'stale' }};
                }}
                if (el.tagName === 'INPUT' && el.type === 'file') {{
                    return {{ status: 'file' }};
                }}
                var typed = {typed};
                if ({value_control} && typed !== '') {{
                    if (el.readOnly || el.disabled) {{
                        return {{ status: 'immutable' }};
                    }}
                    el.focus();
                    var setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    var previousValue = el.value;
                    setValue.call(el, typed);
                    if (el.value === '') {{
                        setValue.call(el, previousValue);
                        return {{ status: 'invalid' }};
                    }}
                    if (el.value !== previousValue) {{
                        el.dispatchEvent(new Event('input', {{ bubbles: true, composed: true }}));
                        el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    }}
                    return {{ status: 'set' }};
                }}
                {active_element}
                var wasFocused = activeEl === el;
                // Text inside a contenteditable is focused through its editing host.
                var focusTarget = el;
                while (focusTarget.isContentEditable && focusTarget.parentElement
                    && focusTarget.parentElement.isContentEditable) {{
                    focusTarget = focusTarget.parentElement;
                }}
                // Text fields get the caret at the end before focus: typing appends, yet a select-on-focus
                // handler still wins.
                if ({text_field}) {{
                    try {{
                        el.setSelectionRange(el.value.length, el.value.length);
                    }} catch (e) {{}}
                }}
                focusTarget.focus();
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
                var focused = el === document.body || el === document.documentElement || activeEl === focusTarget;
                for (var node = activeEl; node && !focused; node = node.parentNode || node.host) {{
                    focused = node === el;
                }}
                if (!focused) {{
                    return {{ status: 'unfocused' }};
                }}
                var receiver = activeEl;
                // A field that focus was delegated to is only known now, so its caret moves after focus.
                if (receiver !== el && {receiver_text_field}) {{
                    try {{
                        receiver.setSelectionRange(receiver.value.length, receiver.value.length);
                    }} catch (e) {{}}
                }}
                var initialValue = {receiver_text_field} ? receiver.value : null;
                {finish}
            }})()"
    )
}

/// JS inserting a printable run at the focused element's selection, as typing does, so text follows
/// focus when a key moves it.
pub fn build_insert_run_script(run: &str) -> String {
    let active_element = deep_active_element_js("activeEl");
    let insert_text = insert_text_js("activeEl", &js_string(run));
    format!(
        r"(function() {{
                {active_element}
                {insert_text}
                return true;
            }})()"
    )
}

/// JS firing one `change` if the field that received the text no longer holds `initial_value`; it
/// skips a detached field so a retry can't duplicate keystrokes that already committed.
pub fn build_send_keys_change_script(js_var: &str, initial_value: &str) -> String {
    let initial_value = js_string(initial_value);
    format!(
        r"(function() {{
                var el = window.{js_var}__receiver;
                delete window.{js_var}__receiver;
                if (el && el.isConnected && el.value !== {initial_value}) {{
                    el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
                return true;
            }})()"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const ESCAPE: &str = "\u{E00C}";
    const ENTER: &str = "\u{E007}";
    const BACKSPACE: &str = "\u{E003}";
    const PAGE_DOWN: &str = "\u{E00F}";
    const ARROW_DOWN: &str = "\u{E015}";
    const SHIFT: &str = "\u{E008}";
    const CONTROL: &str = "\u{E009}";
    const CONTROL_RIGHT: &str = "\u{E051}";
    const ALT: &str = "\u{E00A}";

    fn special_key_range() -> impl Iterator<Item = char> {
        '\u{E000}'..='\u{E05D}'
    }

    fn mods(ctrl: bool, shift: bool, alt: bool, meta: bool) -> ModifierState {
        ModifierState {
            ctrl,
            shift,
            alt,
            meta,
        }
    }

    fn key(value: &str, is_down: bool, modifiers: ModifierState) -> SendKeysStep {
        SendKeysStep::Key {
            value: value.to_string(),
            is_down,
            modifiers,
        }
    }

    fn text(run: &str) -> SendKeysStep {
        SendKeysStep::Text(run.to_string())
    }

    #[test]
    fn every_special_key_code_point_maps() {
        for ch in special_key_range() {
            assert!(
                map_special_key(&ch.to_string()).is_some(),
                "U+{:04X} has no mapping",
                ch as u32
            );
        }
    }

    #[test]
    fn no_mapping_leaks_a_private_use_character() {
        for ch in special_key_range() {
            let (key, code, _) = map_special_key(&ch.to_string()).unwrap();
            assert!(
                !key.chars()
                    .chain(code.chars())
                    .any(|c| ('\u{E000}'..='\u{E05D}').contains(&c)),
                "U+{:04X} maps to a private-use value",
                ch as u32
            );
        }
    }

    #[test]
    fn map_special_key_maps_the_reported_navigation_keys() {
        assert_eq!(map_special_key("\u{E00E}"), Some(("PageUp", "PageUp", 33)));
        assert_eq!(
            map_special_key(PAGE_DOWN),
            Some(("PageDown", "PageDown", 34))
        );
        assert_eq!(map_special_key("\u{E010}"), Some(("End", "End", 35)));
        assert_eq!(map_special_key("\u{E011}"), Some(("Home", "Home", 36)));
        assert_eq!(map_special_key("\u{E016}"), Some(("Insert", "Insert", 45)));
    }

    #[test]
    fn map_special_key_keeps_the_existing_entries() {
        assert_eq!(map_special_key(ESCAPE), Some(("Escape", "Escape", 27)));
        assert_eq!(map_special_key(ENTER), Some(("Enter", "Enter", 13)));
        assert_eq!(
            map_special_key("\u{E006}"),
            Some(("Enter", "NumpadEnter", 13))
        );
        assert_eq!(map_special_key("\u{E00D}"), Some((" ", "Space", 32)));
        assert_eq!(
            map_special_key(ARROW_DOWN),
            Some(("ArrowDown", "ArrowDown", 40))
        );
        assert_eq!(map_special_key("\u{E03C}"), Some(("F12", "F12", 123)));
        assert_eq!(
            map_special_key(CONTROL),
            Some(("Control", "ControlLeft", 17))
        );
    }

    #[test]
    fn map_special_key_maps_numpad_and_right_hand_keys() {
        assert_eq!(map_special_key("\u{E01A}"), Some(("0", "Numpad0", 96)));
        assert_eq!(map_special_key("\u{E023}"), Some(("9", "Numpad9", 105)));
        assert_eq!(
            map_special_key("\u{E029}"),
            Some(("/", "NumpadDivide", 111))
        );
        assert_eq!(map_special_key("\u{E019}"), Some(("=", "NumpadEqual", 187)));
        assert_eq!(map_special_key("\u{E018}"), Some((";", "Semicolon", 186)));
        assert_eq!(
            map_special_key("\u{E050}"),
            Some(("Shift", "ShiftRight", 16))
        );
        assert_eq!(map_special_key("\u{E053}"), Some(("Meta", "MetaRight", 92)));
        assert_eq!(map_special_key("\u{E054}"), Some(("PageUp", "Numpad9", 33)));
        assert_eq!(
            map_special_key("\u{E05D}"),
            Some(("Delete", "NumpadDecimal", 46))
        );
    }

    #[test]
    fn map_special_key_maps_the_remaining_named_keys() {
        assert_eq!(map_special_key(NULL_KEY), Some(("Unidentified", "", 0)));
        assert_eq!(map_special_key("\u{E001}"), Some(("Cancel", "", 3)));
        assert_eq!(map_special_key("\u{E002}"), Some(("Help", "Help", 47)));
        assert_eq!(map_special_key("\u{E005}"), Some(("Clear", "", 12)));
        assert_eq!(map_special_key("\u{E00B}"), Some(("Pause", "Pause", 19)));
        assert_eq!(map_special_key("\u{E040}"), Some(("ZenkakuHankaku", "", 0)));
    }

    #[test]
    fn unassigned_code_points_map_to_unidentified() {
        for unassigned in ["\u{E02A}", "\u{E030}", "\u{E03E}", "\u{E041}", "\u{E04F}"] {
            assert_eq!(map_special_key(unassigned), Some(("Unidentified", "", 0)));
        }
    }

    #[test]
    fn map_special_key_rejects_everything_outside_the_range() {
        assert_eq!(map_special_key("a"), None);
        assert_eq!(map_special_key("5"), None);
        assert_eq!(map_special_key(""), None);
        assert_eq!(map_special_key("\u{D7FF}"), None);
        assert_eq!(map_special_key("\u{E05E}"), None);
        assert_eq!(map_special_key("\u{F8FF}"), None);
        assert_eq!(map_special_key(&format!("{PAGE_DOWN}{PAGE_DOWN}")), None);
    }

    #[test]
    fn printable_special_keys_are_single_characters() {
        let printable: Vec<char> = special_key_range()
            .filter(|ch| is_printable_key(map_special_key(&ch.to_string()).unwrap().0))
            .collect();
        let expected: Vec<char> = std::iter::once('\u{E00D}')
            .chain('\u{E018}'..='\u{E029}')
            .collect();
        assert_eq!(printable, expected);
    }

    #[test]
    fn is_modifier_key_covers_both_hands() {
        for modifier in [
            SHIFT, CONTROL, ALT, "\u{E03D}", "\u{E050}", "\u{E051}", "\u{E052}", "\u{E053}",
        ] {
            assert!(is_modifier_key(modifier));
        }
        assert!(!is_modifier_key(ENTER));
        assert!(!is_modifier_key("a"));
    }

    #[test]
    fn regular_key_code_for_derives_code() {
        assert_eq!(regular_key_code_for("a"), "KeyA");
        assert_eq!(regular_key_code_for("A"), "KeyA");
        assert_eq!(regular_key_code_for("5"), "Digit5");
        assert_eq!(regular_key_code_for("!"), "!");
    }

    #[test]
    fn build_special_key_script_dispatches_keyboard_event() {
        let none = ModifierState::default();
        let script = build_special_key_script("PageDown", "PageDown", 34, true, &none);
        assert!(script.contains("new KeyboardEvent('keydown'"));
        assert!(script.contains("key: \"PageDown\""));
        assert!(script.contains("keyCode: 34"));
        assert!(script.contains("shiftKey: false"));
        assert_eq!(script.matches("new KeyboardEvent(").count(), 1);

        let up = build_special_key_script("PageDown", "PageDown", 34, false, &none);
        assert!(up.contains("new KeyboardEvent('keyup'"));
    }

    #[test]
    fn build_special_key_script_carries_held_modifiers_on_every_event() {
        let shift = mods(false, true, false, false);
        let ctrl_alt_meta = mods(true, false, true, true);
        for script in [
            build_special_key_script("Enter", "Enter", 13, true, &shift),
            build_special_key_script("Enter", "Enter", 13, false, &shift),
            build_special_key_script("Backspace", "Backspace", 8, true, &shift),
            build_special_key_script("ArrowDown", "ArrowDown", 40, true, &shift),
        ] {
            assert!(script.contains("shiftKey: true"), "{script}");
            assert!(script.contains("ctrlKey: false"), "{script}");
        }
        let chord = build_special_key_script("Home", "Home", 36, true, &ctrl_alt_meta);
        assert!(chord.contains("ctrlKey: true"));
        assert!(chord.contains("altKey: true"));
        assert!(chord.contains("metaKey: true"));
        assert!(chord.contains("shiftKey: false"));
    }

    #[test]
    fn build_regular_key_script_carries_modifiers_and_value_mutation() {
        let script = build_regular_key_script("a", "KeyA", true, &mods(false, false, false, false));
        assert!(script.contains("key: \"a\""));
        assert!(script.contains("keyCode: 97"));
        assert!(script.contains("inputType: 'insertText'"));

        let select_all =
            build_regular_key_script("a", "KeyA", true, &mods(true, false, false, false));
        assert!(select_all.contains("activeEl.select()"));
        assert!(!select_all.contains("insertedText"));
    }

    #[test]
    fn build_printable_key_script_uses_the_given_key_code() {
        let script = build_printable_key_script(
            "5",
            "Numpad5",
            101,
            true,
            &mods(false, false, false, false),
        );
        assert!(script.contains("key: \"5\""));
        assert!(script.contains("code: \"Numpad5\""));
        assert!(script.contains("keyCode: 101"));
        assert!(script.contains("var insertedText = \"5\""));
    }

    #[test]
    fn build_printable_key_script_types_into_contenteditable() {
        let script =
            build_printable_key_script(" ", "Space", 32, true, &mods(false, false, false, false));
        assert!(script.contains("activeEl.isContentEditable"));
        assert!(script.contains("document.execCommand('insertText', false, insertedText)"));
    }

    #[test]
    fn typed_text_replaces_the_selection() {
        let none = mods(false, false, false, false);
        for script in [
            build_printable_key_script("5", "Numpad5", 101, true, &none),
            build_insert_run_script("new"),
        ] {
            assert!(script.contains(
                "currentValue.slice(0, selStart) + insertedText + currentValue.slice(selEnd)"
            ));
            assert!(script.contains("setSelectionRange(caret, caret)"));
            assert!(script.contains("if (activeEl.value !== currentValue)"));
        }
    }

    #[test]
    fn only_text_fields_and_editors_take_typed_text() {
        let field = is_text_field_js("el");
        assert!(field.contains("el.tagName === 'TEXTAREA'"));
        assert!(field.contains(
            "['text', 'search', 'url', 'tel', 'email', 'password', 'number'].indexOf(el.type)"
        ));
        let script = build_insert_run_script("x");
        assert!(script.contains(&format!("if ({})", is_editable_text_field_js("activeEl"))));
        assert!(is_editable_text_field_js("el").contains(&field));
        assert!(!script.contains("el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'"));
    }

    #[test]
    fn js_string_escapes_line_breaks_and_quotes() {
        let text = "a'\"\\\n";
        let literal = js_string(text);
        assert!(literal.starts_with('"') && literal.ends_with('"'));
        assert!(!literal.contains('\n'));
        assert_eq!(serde_json::from_str::<String>(&literal).unwrap(), text);
    }

    #[test]
    fn key_text_is_spliced_as_escaped_literals() {
        let none = mods(false, false, false, false);
        let newline = build_regular_key_script("\n", "\n", true, &none);
        assert!(newline.contains(&format!("key: {}", js_string("\n"))));
        assert!(newline.contains(&format!("var insertedText = {}", js_string("\n"))));
        let run = build_insert_run_script("a`$\\b\n'");
        assert!(run.contains(&format!("var insertedText = {}", js_string("a`$\\b\n'"))));
    }

    #[test]
    fn key_scripts_target_the_deep_active_element() {
        let none = mods(false, false, false, false);
        for script in [
            build_special_key_script("Enter", "Enter", 13, true, &none),
            build_printable_key_script(" ", "Space", 32, true, &none),
            build_insert_run_script("x"),
            build_send_keys_start_script("v", "", None),
        ] {
            assert!(
                script.contains("activeEl.shadowRoot.activeElement"),
                "{script}"
            );
        }
    }

    #[test]
    fn default_actions_wait_for_an_uncanceled_keydown() {
        let none = mods(false, false, false, false);
        let ctrl = mods(true, false, false, false);
        let guard = "if (!activeEl.dispatchEvent(keyEvent)) {";
        for (script, side_effect) in [
            (
                build_printable_key_script(" ", "Space", 32, true, &none),
                "var insertedText",
            ),
            (
                build_regular_key_script("x", "KeyX", true, &none),
                "var insertedText",
            ),
            (
                build_regular_key_script("a", "KeyA", true, &ctrl),
                "activeEl.select()",
            ),
            (
                build_special_key_script("Backspace", "Backspace", 8, true, &none),
                "nativeInputValueSetter",
            ),
            (
                build_special_key_script("Delete", "Delete", 46, true, &none),
                "nativeInputValueSetter",
            ),
            (
                build_special_key_script("ArrowDown", "ArrowDown", 40, true, &none),
                "nextRadio.checked",
            ),
            (
                build_special_key_script("Enter", "Enter", 13, true, &none),
                "insertParagraph",
            ),
        ] {
            let guard_at = script
                .find(guard)
                .unwrap_or_else(|| panic!("no guard in {script}"));
            let effect_at = script.find(side_effect).unwrap();
            assert!(
                guard_at < effect_at,
                "{side_effect} runs before the guard in {script}"
            );
            assert!(!script.contains("activeEl.dispatchEvent(keyEvent);"));
        }
    }

    #[test]
    fn enter_breaks_lines_in_textareas_and_editors_only() {
        let none = mods(false, false, false, false);
        let shift = mods(false, true, false, false);
        let enter = build_special_key_script("Enter", "Enter", 13, true, &none);
        assert!(enter.contains("if (activeEl.tagName === 'TEXTAREA')"));
        assert!(enter.contains(&format!("var insertedText = {}", js_string("\n"))));
        assert!(enter.contains("document.execCommand('insertParagraph', false, null)"));
        let shift_enter = build_special_key_script("Enter", "Enter", 13, true, &shift);
        assert!(shift_enter.contains("document.execCommand('insertLineBreak', false, null)"));
        let enter_up = build_special_key_script("Enter", "Enter", 13, false, &none);
        assert!(!enter_up.contains("insertedText"));
        for chord in [
            mods(true, false, false, false),
            mods(false, false, true, false),
            mods(false, false, false, true),
        ] {
            let script = build_special_key_script("Enter", "Enter", 13, true, &chord);
            assert!(!script.contains("insertedText") && !script.contains("insertParagraph"));
        }
    }

    #[test]
    fn delete_keys_edit_text_fields_at_the_end_without_a_selection_api() {
        let none = mods(false, false, false, false);
        let backspace = build_special_key_script("Backspace", "Backspace", 8, true, &none);
        assert!(backspace.contains(&format!("if ({})", is_editable_text_field_js("activeEl"))));
        let fallback = backspace.find("if (!hasSelectionApi) {").unwrap();
        let to_end = backspace
            .find("selStart = selEnd = currentValue.length;")
            .unwrap();
        assert!(fallback < to_end);
        assert!(backspace.contains("deleteContentBackward"));
        let delete = build_special_key_script("Delete", "Delete", 46, true, &none);
        assert!(delete.contains("deleteContentForward"));
    }

    #[test]
    fn radio_navigation_escapes_the_group_name() {
        let script = build_special_key_script(
            "ArrowDown",
            "ArrowDown",
            40,
            true,
            &mods(false, false, false, false),
        );
        assert!(script.contains("CSS.escape(activeEl.name)"));
        assert!(script.contains("activeEl.getRootNode().querySelectorAll("));
    }

    #[test]
    fn segment_send_keys_splits_text_and_special_keys() {
        assert_eq!(
            segment_send_keys("hello"),
            vec![KeySegment::Text("hello".into())]
        );
        assert_eq!(segment_send_keys(""), vec![]);
        assert_eq!(
            segment_send_keys(ESCAPE),
            vec![KeySegment::Special(ESCAPE.into())]
        );

        assert_eq!(
            segment_send_keys(&format!("hi{ENTER}")),
            vec![
                KeySegment::Text("hi".into()),
                KeySegment::Special(ENTER.into())
            ]
        );

        assert_eq!(
            segment_send_keys(&format!("a{ARROW_DOWN}bc")),
            vec![
                KeySegment::Text("a".into()),
                KeySegment::Special(ARROW_DOWN.into()),
                KeySegment::Text("bc".into()),
            ]
        );

        assert_eq!(
            segment_send_keys(&format!("{ESCAPE}{ENTER}")),
            vec![
                KeySegment::Special(ESCAPE.into()),
                KeySegment::Special(ENTER.into())
            ]
        );
    }

    #[test]
    fn segment_send_keys_never_leaves_a_special_key_in_text() {
        let everything: String = special_key_range().flat_map(|ch| ['x', ch]).collect();
        for segment in segment_send_keys(&everything) {
            if let KeySegment::Text(run) = segment {
                assert_eq!(run, "x");
            }
        }
    }

    #[test]
    fn plan_send_keys_types_plain_text_in_one_step() {
        assert_eq!(plan_send_keys("hello"), vec![text("hello")]);
        assert_eq!(plan_send_keys(""), vec![]);
    }

    #[test]
    fn plan_send_keys_drops_null_keys() {
        assert_eq!(plan_send_keys(&format!("a{NULL_KEY}b")), vec![text("ab")]);
        assert_eq!(plan_send_keys(NULL_KEY), vec![]);
    }

    #[test]
    fn held_modifiers_start_from_keys_still_pressed() {
        let pressed = vec![
            SHIFT.to_string(),
            "a".to_string(),
            CONTROL_RIGHT.to_string(),
        ];
        let held = HeldModifiers::from_keys(&pressed);
        assert_eq!(held.state(), mods(true, true, false, false));
        assert_eq!(held.keys(), vec![SHIFT, CONTROL_RIGHT]);
    }

    #[test]
    fn held_modifiers_track_each_hand() {
        let mut held = HeldModifiers::default();
        assert!(held.press(CONTROL));
        assert!(held.press(CONTROL_RIGHT));
        assert!(!held.press(CONTROL));
        assert!(!held.press("a"));
        assert!(held.release(CONTROL_RIGHT));
        assert_eq!(held.state(), mods(true, false, false, false));
        assert!(held.release(CONTROL));
        assert_eq!(held.state(), ModifierState::default());
        assert!(!held.release(CONTROL));
    }

    #[test]
    fn held_modifiers_map_every_modifier_key() {
        let mut held = HeldModifiers::default();
        for key in ["\u{E050}", "\u{E052}", "\u{E053}"] {
            held.press(key);
        }
        assert_eq!(held.state(), mods(false, true, true, true));
        assert_eq!(held.keys(), vec!["\u{E050}", "\u{E052}", "\u{E053}"]);
    }

    #[test]
    fn plan_send_keys_presses_special_keys_between_text_runs() {
        let none = ModifierState::default();
        assert_eq!(
            plan_send_keys(&format!("abc{BACKSPACE}d{PAGE_DOWN}")),
            vec![
                text("abc"),
                key(BACKSPACE, true, none),
                key(BACKSPACE, false, none),
                text("d"),
                key(PAGE_DOWN, true, none),
                key(PAGE_DOWN, false, none),
            ]
        );
    }

    #[test]
    fn plan_send_keys_holds_modifiers_until_the_end() {
        let none = ModifierState::default();
        let shift = mods(false, true, false, false);
        assert_eq!(
            plan_send_keys(&format!("{SHIFT}ab{ENTER}")),
            vec![
                key(SHIFT, true, shift),
                text("ab"),
                key(ENTER, true, shift),
                key(ENTER, false, shift),
                key(SHIFT, false, none),
            ]
        );
    }

    #[test]
    fn plan_send_keys_presses_text_as_shortcuts_under_control() {
        let none = ModifierState::default();
        let ctrl = mods(true, false, false, false);
        assert_eq!(
            plan_send_keys(&format!("{CONTROL}a{BACKSPACE}")),
            vec![
                key(CONTROL, true, ctrl),
                key("a", true, ctrl),
                key("a", false, ctrl),
                key(BACKSPACE, true, ctrl),
                key(BACKSPACE, false, ctrl),
                key(CONTROL, false, none),
            ]
        );
    }

    #[test]
    fn plan_send_keys_null_key_releases_modifiers() {
        let none = ModifierState::default();
        let ctrl = mods(true, false, false, false);
        assert_eq!(
            plan_send_keys(&format!("{CONTROL}a{NULL_KEY}b")),
            vec![
                key(CONTROL, true, ctrl),
                key("a", true, ctrl),
                key("a", false, ctrl),
                key(CONTROL, false, none),
                text("b"),
            ]
        );
    }

    #[test]
    fn plan_send_keys_toggles_a_repeated_modifier_and_releases_in_code_point_order() {
        let none = ModifierState::default();
        let alt = mods(false, false, true, false);
        let shift = mods(false, true, false, false);
        let alt_shift = mods(false, true, true, false);
        let ctrl = mods(true, false, false, false);
        let ctrl_shift = mods(true, true, false, false);
        assert_eq!(
            plan_send_keys(&format!("{ALT}{SHIFT}{ALT}{CONTROL}")),
            vec![
                key(ALT, true, alt),
                key(SHIFT, true, alt_shift),
                key(ALT, false, shift),
                key(CONTROL, true, ctrl_shift),
                key(SHIFT, false, ctrl),
                key(CONTROL, false, none),
            ]
        );
    }

    #[test]
    fn plan_send_keys_keeps_control_while_the_other_hand_holds_it() {
        let ctrl = mods(true, false, false, false);
        let steps = plan_send_keys(&format!("{CONTROL}{CONTROL_RIGHT}a"));
        assert_eq!(steps[2], key("a", true, ctrl));
        assert_eq!(
            steps[4..],
            [
                key(CONTROL, false, ctrl),
                key(CONTROL_RIGHT, false, ModifierState::default()),
            ]
        );
    }

    #[test]
    fn build_send_keys_start_script_appends_to_the_field_that_receives_the_text() {
        let script = build_send_keys_start_script("__wd_el_abc", "", None);
        let field_caret = script
            .find("el.setSelectionRange(el.value.length, el.value.length)")
            .unwrap();
        let focus = script.find("focusTarget.focus()").unwrap();
        let editor_caret = script.find("range.collapse(false)").unwrap();
        let delegated_caret = script
            .find("receiver.setSelectionRange(receiver.value.length, receiver.value.length)")
            .unwrap();
        assert!(field_caret < focus && focus < editor_caret && editor_caret < delegated_caret);
        assert!(script.contains("if (!wasFocused && el.isContentEditable)"));
        assert!(script.contains(&format!(
            "var initialValue = {} ? receiver.value : null;",
            is_text_field_js("receiver")
        )));
        assert!(script.contains("window.__wd_el_abc__receiver = receiver;"));
        let plain = build_send_keys_start_script("__wd_el_abc", "x", Some("x"));
        assert!(plain.contains("receiver.value !== initialValue"));
        assert!(plain.contains("receiver.dispatchEvent(new Event('change'"));
    }

    #[test]
    fn build_send_keys_start_script_accepts_the_body_editing_hosts_and_focus_inside() {
        let script = build_send_keys_start_script("__wd_el_abc", "", None);
        assert!(script.contains(
            "el === document.body || el === document.documentElement || activeEl === focusTarget;"
        ));
        assert!(script.contains("focusTarget = focusTarget.parentElement;"));
        assert!(script.contains("node = node.parentNode || node.host"));
        assert!(script.contains("return { status: 'unfocused' };"));
    }

    #[test]
    fn build_send_keys_start_script_reports_a_stale_element_without_throwing() {
        let script = build_send_keys_start_script("__wd_el_abc", "x", Some("x"));
        assert!(script.contains("return { status: 'stale' };"));
        assert!(!script.contains("throw"));
    }

    #[test]
    fn build_send_keys_start_script_types_plain_text_in_the_same_script() {
        let plain = build_send_keys_start_script("__wd_el_abc", "hi", Some("hi"));
        let focus = plain.find("focusTarget.focus()").unwrap();
        let insert = plain.find("var insertedText = \"hi\"").unwrap();
        let change = plain.rfind("new Event('change'").unwrap();
        assert!(focus < insert && insert < change);
        assert!(plain.contains("return { status: 'done' };"));
        let empty = build_send_keys_start_script("__wd_el_abc", "", Some(""));
        assert!(!empty.contains("insertedText") && empty.contains("return { status: 'done' };"));
    }

    #[test]
    fn build_insert_run_script_inserts_fires_input_and_defers_change() {
        let script = build_insert_run_script("hi");
        assert!(script.contains("var activeEl = document.activeElement || document.body;"));
        assert!(script.contains("var insertedText = \"hi\""));
        assert!(script.contains("inputType: 'insertText'"));
        assert!(script.contains("document.execCommand('insertText', false, insertedText)"));
        assert!(!script.contains("new Event('change'"));
    }

    #[test]
    fn build_send_keys_change_script_fires_change_only_for_a_changed_value() {
        let script = build_send_keys_change_script("__wd_el_abc", "it's\n");
        assert!(script.contains("var el = window.__wd_el_abc__receiver;"));
        assert!(script.contains(&format!("el.value !== {}", js_string("it's\n"))));
        assert!(script.contains("new Event('change'"));
        assert!(!script.contains("throw"));
    }

    #[test]
    fn key_and_input_events_cross_shadow_boundaries() {
        let none = mods(false, false, false, false);
        for script in [
            build_special_key_script("Backspace", "Backspace", 8, true, &none),
            build_printable_key_script(" ", "Space", 32, true, &none),
        ] {
            let keyboard = script.find("new KeyboardEvent(").unwrap();
            let input = script.find("new InputEvent('input'").unwrap();
            assert!(script[keyboard..].contains("composed: true"));
            assert!(script[input..].contains("composed: true"));
            assert_eq!(script.matches("composed: true").count(), 2, "{script}");
        }
        assert!(build_special_key_script("End", "End", 35, false, &none).contains("composed: true"));
    }

    #[test]
    fn typing_skips_read_only_and_disabled_fields() {
        let none = mods(false, false, false, false);
        let editable = is_editable_text_field_js("activeEl");
        assert!(editable.contains("!activeEl.readOnly && !activeEl.disabled"));
        for script in [
            build_printable_key_script("x", "KeyX", 120, true, &none),
            build_special_key_script("Enter", "Enter", 13, true, &none),
            build_special_key_script("Backspace", "Backspace", 8, true, &none),
            build_special_key_script("Delete", "Delete", 46, true, &none),
        ] {
            assert!(script.contains(&format!("if ({editable})")), "{script}");
        }
        assert!(build_insert_run_script("x")
            .contains(&format!("if ({})", is_editable_text_field_js("activeEl"))));
    }

    #[test]
    fn value_controls_get_their_value_set_directly() {
        let control = is_value_control_js("el");
        for kind in [
            "color",
            "date",
            "datetime-local",
            "month",
            "range",
            "time",
            "week",
        ] {
            assert!(control.contains(&format!("'{kind}'")));
        }
        for typeable in ["text", "checkbox", "radio", "file", "button"] {
            assert!(!control.contains(&format!("'{typeable}'")));
        }
        let script = build_send_keys_start_script("__wd_el_abc", "2026-10-21", Some("2026-10-21"));
        assert!(script.contains(&format!("var typed = {};", js_string("2026-10-21"))));
        assert!(script.contains(&format!("if ({control} && typed !== '')")));
        assert!(script.contains("return { status: 'immutable' };"));
        let input = script.find("new Event('input'").unwrap();
        let change = script.find("new Event('change'").unwrap();
        assert!(script.contains("if (el.value !== previousValue)") && input < change);
    }

    #[test]
    fn send_keys_start_refuses_file_inputs_and_invalid_values() {
        let script = build_send_keys_start_script("__wd_el_abc", "not-a-date", Some("not-a-date"));
        let file = script.find("el.type === 'file'").unwrap();
        assert!(file < script.find("var typed").unwrap());
        let invalid = script.find("if (el.value === '') {").unwrap();
        let restore = script.find("setValue.call(el, previousValue);").unwrap();
        assert!(invalid < restore && restore < script.find("status: 'invalid'").unwrap());
    }

    #[test]
    fn typed_text_keeps_only_the_text_runs() {
        let steps = plan_send_keys(&format!("20{BACKSPACE}26-10{SHIFT}-21"));
        assert_eq!(typed_text(&steps), "2026-10-21");
        assert_eq!(typed_text(&plan_send_keys(NULL_KEY)), "");
    }
}
