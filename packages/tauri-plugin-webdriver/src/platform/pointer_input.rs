use super::PointerEventType;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PointerInputState {
    /// DOM `buttons` bitmask of the buttons held once the event applies
    pub buttons: u32,
    /// A canceled `pointerdown` suppresses compatibility mouse events until release
    pub suppress_mouse_events: bool,
    /// Another button stays held across this press or release, so the pointer
    /// reports it as a `pointermove` instead of `pointerdown`/`pointerup`
    pub chorded: bool,
}

/// Script that dispatches one pointer action's events at (`x`, `y`) and returns
/// whether its `pointerdown` was canceled.
pub fn pointer_event_script(
    event_type: PointerEventType,
    x: i32,
    y: i32,
    button: u32,
    input_state: PointerInputState,
) -> String {
    let PointerInputState {
        buttons,
        suppress_mouse_events,
        chorded,
    } = input_state;
    let (pointer_event_name, mouse_event_name) = match event_type {
        PointerEventType::Down if chorded => (Some("pointermove"), "mousedown"),
        PointerEventType::Down => (Some("pointerdown"), "mousedown"),
        PointerEventType::Up if chorded => (Some("pointermove"), "mouseup"),
        PointerEventType::Up => (Some("pointerup"), "mouseup"),
        PointerEventType::Move => (Some("pointermove"), "mousemove"),
        // A dispatched mousedown/mouseup never makes the browser fire click, so
        // the actions handler emits one after a same-spot press and release.
        PointerEventType::Click => (None, "click"),
    };

    // Pointer Events: a `pointermove` that doesn't change a button reports -1.
    let pointer_button = if matches!(event_type, PointerEventType::Move) {
        -1
    } else {
        i64::from(button)
    };
    let pressure = if buttons == 0 { "0" } else { "0.5" };
    let pointer_dispatch = pointer_event_name.map_or_else(String::new, |name| {
        let init = format!(
            r"{{
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
                bubbles: true,
                cancelable: true,
                composed: true,
                clientX: {x},
                clientY: {y},
                button: {pointer_button},
                buttons: {buttons},
                pressure: {pressure},
            }}"
        );
        // Only a canceled pointerdown starts suppression, never a chorded pointermove.
        if name == "pointerdown" {
            format!("pointerDownCanceled = !el.dispatchEvent(new PointerEvent('{name}', {init}));")
        } else {
            format!("el.dispatchEvent(new PointerEvent('{name}', {init}));")
        }
    });

    // click is not a compatibility mouse event, so suppression never drops it.
    let mouse_dispatch = if suppress_mouse_events && !matches!(event_type, PointerEventType::Click)
    {
        String::new()
    } else {
        format!(
            r"if (!pointerDownCanceled) {{
                el.dispatchEvent(new MouseEvent('{mouse_event_name}', {{
                    bubbles: true,
                    cancelable: true,
                    clientX: {x},
                    clientY: {y},
                    button: {button},
                    buttons: {buttons},
                }}));
            }}"
        )
    };

    format!(
        r"(function() {{
            var el = document.elementFromPoint({x}, {y});
            if (!el) {{
                el = document.body;
            }}
            var pointerDownCanceled = false;
            {pointer_dispatch}
            {mouse_dispatch}
            return pointerDownCanceled;
        }})()"
    )
}

#[cfg(test)]
mod tests {
    use super::{pointer_event_script, PointerEventType, PointerInputState};

    fn state(buttons: u32, suppress_mouse_events: bool, chorded: bool) -> PointerInputState {
        PointerInputState {
            buttons,
            suppress_mouse_events,
            chorded,
        }
    }

    fn position(script: &str, needle: &str) -> usize {
        script
            .find(needle)
            .unwrap_or_else(|| panic!("`{needle}` missing from:\n{script}"))
    }

    #[test]
    fn press_dispatches_pointerdown_before_a_mousedown_gated_on_its_cancellation() {
        let script = pointer_event_script(PointerEventType::Down, 5, 6, 0, state(1, false, false));

        let pointer = position(
            &script,
            "pointerDownCanceled = !el.dispatchEvent(new PointerEvent('pointerdown'",
        );
        let gate = position(&script, "if (!pointerDownCanceled) {");
        let mouse = position(&script, "new MouseEvent('mousedown'");
        assert!(pointer < gate && gate < mouse);
        assert!(script.contains("pointerType: 'mouse',"));
        assert!(script.contains("isPrimary: true,"));
        assert!(script.contains("clientX: 5,"));
        assert!(script.contains("clientY: 6,"));
        assert!(script.contains("button: 0,"));
        assert!(script.contains("buttons: 1,"));
        assert!(script.contains("return pointerDownCanceled;"));
    }

    #[test]
    fn move_reports_button_minus_one_on_the_pointer_event_only() {
        let script = pointer_event_script(PointerEventType::Move, 0, 0, 0, state(1, false, false));

        assert!(script.contains("new PointerEvent('pointermove'"));
        assert!(script.contains("new MouseEvent('mousemove'"));
        assert_eq!(script.matches("button: -1,").count(), 1);
        assert_eq!(script.matches("button: 0,").count(), 1);
        assert!(!script.contains("pointerDownCanceled = !"));
    }

    #[test]
    fn pressure_is_half_while_a_button_is_held() {
        let held = pointer_event_script(PointerEventType::Move, 0, 0, 0, state(1, false, false));
        let hovering =
            pointer_event_script(PointerEventType::Move, 0, 0, 0, state(0, false, false));

        assert!(held.contains("pressure: 0.5,"));
        assert!(hovering.contains("pressure: 0,"));
    }

    #[test]
    fn suppression_drops_compatibility_mouse_events_but_not_click() {
        let suppressed = state(1, true, false);
        for event_type in [PointerEventType::Down, PointerEventType::Move] {
            let script = pointer_event_script(event_type, 0, 0, 0, suppressed);
            assert!(script.contains("new PointerEvent("));
            assert!(!script.contains("new MouseEvent("));
        }
        let release = pointer_event_script(PointerEventType::Up, 0, 0, 0, state(0, true, false));
        assert!(release.contains("new PointerEvent('pointerup'"));
        assert!(!release.contains("new MouseEvent("));

        let click = pointer_event_script(PointerEventType::Click, 0, 0, 0, state(0, true, false));
        assert!(click.contains("new MouseEvent('click'"));
    }

    #[test]
    fn chorded_press_is_a_pointermove_that_cannot_start_suppression() {
        let script = pointer_event_script(PointerEventType::Down, 0, 0, 2, state(3, false, true));

        assert!(script.contains("el.dispatchEvent(new PointerEvent('pointermove'"));
        assert!(!script.contains("pointerdown"));
        assert!(!script.contains("pointerDownCanceled = !"));
        assert!(script.contains("new MouseEvent('mousedown'"));
        assert_eq!(script.matches("button: 2,").count(), 2);
        assert_eq!(script.matches("buttons: 3,").count(), 2);
    }

    #[test]
    fn only_the_last_release_is_a_pointerup() {
        let chorded = pointer_event_script(PointerEventType::Up, 0, 0, 2, state(1, false, true));
        assert!(chorded.contains("new PointerEvent('pointermove'"));
        assert!(!chorded.contains("pointerup"));
        assert!(chorded.contains("new MouseEvent('mouseup'"));
        assert_eq!(chorded.matches("button: 2,").count(), 2);

        let last = pointer_event_script(PointerEventType::Up, 0, 0, 0, state(0, false, false));
        assert!(last.contains("new PointerEvent('pointerup'"));
        assert!(last.contains("new MouseEvent('mouseup'"));
    }

    #[test]
    fn click_dispatches_no_pointer_event() {
        let script = pointer_event_script(PointerEventType::Click, 0, 0, 0, state(0, false, false));

        assert!(!script.contains("new PointerEvent("));
        assert!(script.contains("new MouseEvent('click'"));
    }
}
