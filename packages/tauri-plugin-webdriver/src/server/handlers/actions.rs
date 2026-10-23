use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use tauri::Runtime;

use crate::platform::key_input::HeldModifiers;
use crate::platform::PointerEventType;
use crate::server::response::{WebDriverErrorResponse, WebDriverResponse, WebDriverResult};
use crate::server::AppState;

#[derive(Debug, Deserialize)]
pub struct ActionsRequest {
    pub actions: Vec<ActionSequence>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ActionSequence {
    #[serde(rename = "key")]
    Key {
        #[serde(rename = "id")]
        _id: String,
        actions: Vec<KeyAction>,
    },
    #[serde(rename = "pointer")]
    Pointer {
        id: String,
        actions: Vec<PointerAction>,
    },
    #[serde(rename = "wheel")]
    Wheel {
        #[serde(rename = "id")]
        _id: String,
        actions: Vec<WheelAction>,
    },
    #[serde(rename = "none")]
    None {
        #[serde(rename = "id")]
        _id: String,
        actions: Vec<PauseAction>,
    },
}

impl ActionSequence {
    /// Number of actions in this source. The request's tick count is the max across all sources.
    fn action_count(&self) -> usize {
        match self {
            ActionSequence::Key { actions, .. } => actions.len(),
            ActionSequence::Pointer { actions, .. } => actions.len(),
            ActionSequence::Wheel { actions, .. } => actions.len(),
            ActionSequence::None { actions, .. } => actions.len(),
        }
    }

    /// The duration (ms) this source's action at `tick` contributes to the tick. Pause, pointer-move
    /// and wheel-scroll actions carry a duration; everything else is instantaneous (`None`). The tick's
    /// duration is the max of these across sources (W3C §17.4.3), not their sum.
    fn duration_at(&self, tick: usize) -> Option<u64> {
        match self {
            ActionSequence::Key { actions, .. } => match actions.get(tick) {
                Some(KeyAction::Pause { duration }) => *duration,
                _ => None,
            },
            ActionSequence::Pointer { actions, .. } => match actions.get(tick) {
                Some(PointerAction::PointerMove { duration, .. })
                | Some(PointerAction::Pause { duration }) => *duration,
                _ => None,
            },
            ActionSequence::Wheel { actions, .. } => match actions.get(tick) {
                Some(WheelAction::Scroll { duration, .. }) | Some(WheelAction::Pause { duration }) => {
                    *duration
                }
                _ => None,
            },
            ActionSequence::None { actions, .. } => match actions.get(tick) {
                Some(PauseAction::Pause { duration }) => *duration,
                _ => None,
            },
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum KeyAction {
    #[serde(rename = "keyDown")]
    KeyDown { value: String },
    #[serde(rename = "keyUp")]
    KeyUp { value: String },
    #[serde(rename = "pause")]
    Pause { duration: Option<u64> },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum PointerAction {
    #[serde(rename = "pointerDown")]
    PointerDown { button: u32 },
    #[serde(rename = "pointerUp")]
    PointerUp { button: u32 },
    #[serde(rename = "pointerMove")]
    PointerMove {
        x: i32,
        y: i32,
        duration: Option<u64>,
        #[serde(default)]
        origin: Option<Origin>,
    },
    #[serde(rename = "pause")]
    Pause { duration: Option<u64> },
}

/// W3C JSON key identifying a web element reference.
const ELEMENT_KEY: &str = "element-6066-11e4-a52e-4f735466cecf";

/// Coordinate origin for a `pointerMove`. Per the WebDriver Actions spec the
/// `origin` is either the string `"viewport"` (the default — x/y are absolute
/// viewport coordinates) or `"pointer"` (x/y are relative to the current pointer
/// position), or an element reference object
/// `{ "element-6066-11e4-a52e-4f735466cecf": "<id>" }` (x/y are offsets from the
/// element's in-view center point). WebdriverIO sends the element form for
/// `element.click(options)` with x/y defaulting to 0, so this must resolve to the
/// element's center rather than viewport (0,0).
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum Origin {
    Named(String),
    Element(HashMap<String, String>),
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum WheelAction {
    #[serde(rename = "scroll")]
    Scroll {
        x: i32,
        y: i32,
        #[serde(rename = "deltaX")]
        delta_x: i32,
        #[serde(rename = "deltaY")]
        delta_y: i32,
        #[serde(default)]
        duration: Option<u64>,
    },
    #[serde(rename = "pause")]
    Pause { duration: Option<u64> },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum PauseAction {
    #[serde(rename = "pause")]
    Pause { duration: Option<u64> },
}

/// Current pointer position for actions
struct PointerState {
    x: i32,
    y: i32,
}

/// POST `/session/{session_id}/actions` - Perform actions
pub async fn perform<R: Runtime + 'static>(
    State(state): State<Arc<AppState<R>>>,
    Path(session_id): Path<String>,
    Json(request): Json<ActionsRequest>,
) -> WebDriverResult {
    let result = perform_actions(&state, session_id.clone(), &request).await;
    if result.is_err() {
        // WDIO skips releaseActions after a failed perform, and a button left held
        // makes later presses of it no-ops.
        let mut sessions = state.sessions.write().await;
        if let Ok(session) = sessions.get_mut(&session_id) {
            session.action_state.forget_pointer_input();
        }
    }
    result
}

#[allow(clippy::too_many_lines)]
async fn perform_actions<R: Runtime + 'static>(
    state: &AppState<R>,
    session_id: String,
    request: &ActionsRequest,
) -> WebDriverResult {
    // Get session info and executor first
    let (current_window, timeouts, frame_context, pointer_position) = {
        let sessions = state.sessions.read().await;
        let session = sessions.get(&session_id)?;
        (
            session.current_window.clone(),
            session.timeouts.clone(),
            session.frame_context.clone(),
            session.action_state.pointer_position,
        )
    };

    let executor = state.get_executor_for_window(&current_window, timeouts, frame_context)?;
    let mut pointer_state = PointerState {
        x: pointer_position.0,
        y: pointer_position.1,
    };
    let mut held_modifiers = {
        let sessions = state.sessions.read().await;
        HeldModifiers::from_keys(&sessions.get(&session_id)?.action_state.pressed_keys)
    };

    // Process actions tick-by-tick across sources (W3C): the action at index N from every source runs
    // before index N+1 from any source, so cross-source chains interleave correctly (e.g. Ctrl+click
    // built as a key source + a pointer source in one performActions — the modifier is down when the
    // click lands). A source with fewer actions contributes nothing on later ticks.
    let tick_count = request
        .actions
        .iter()
        .map(ActionSequence::action_count)
        .max()
        .unwrap_or(0);
    for tick in 0..tick_count {
        // W3C §17.4.3: a tick lasts the *maximum* pause/move/scroll duration across its sources (not
        // the sum), slept once after the tick's actions are dispatched.
        let tick_duration_ms = request
            .actions
            .iter()
            .filter_map(|seq| seq.duration_at(tick))
            .max()
            .unwrap_or(0);
        for action_seq in &request.actions {
            match action_seq {
                ActionSequence::Key { _id: _, actions } => {
                    if let Some(action) = actions.get(tick) {
                        match action {
                            KeyAction::KeyDown { value } => {
                                held_modifiers.press(value);
                                executor
                                    .dispatch_key_event(value, true, &held_modifiers.state())
                                    .await?;
                                // Track pressed key
                                let mut sessions = state.sessions.write().await;
                                if let Ok(session) = sessions.get_mut(&session_id) {
                                    session.action_state.pressed_keys.insert(value.clone());
                                }
                            }
                            KeyAction::KeyUp { value } => {
                                held_modifiers.release(value);
                                executor
                                    .dispatch_key_event(value, false, &held_modifiers.state())
                                    .await?;
                                // Remove from tracked keys
                                let mut sessions = state.sessions.write().await;
                                if let Ok(session) = sessions.get_mut(&session_id) {
                                    session.action_state.pressed_keys.remove(value);
                                }
                            }
                            KeyAction::Pause { .. } => {}
                        }
                    }
                }
                ActionSequence::Pointer { id, actions } => {
                    if let Some(action) = actions.get(tick) {
                        match action {
                            PointerAction::PointerDown { button } => {
                                let press = {
                                    let mut sessions = state.sessions.write().await;
                                    sessions
                                        .get_mut(&session_id)?
                                        .action_state
                                        .press_pointer_button(id, *button)
                                };
                                let Some(input_state) = press else {
                                    continue;
                                };
                                let pointer_down_canceled = executor
                                    .dispatch_pointer_event(
                                        PointerEventType::Down,
                                        pointer_state.x,
                                        pointer_state.y,
                                        *button,
                                        input_state,
                                    )
                                    .await?;
                                if pointer_down_canceled {
                                    let mut sessions = state.sessions.write().await;
                                    if let Ok(session) = sessions.get_mut(&session_id) {
                                        session.action_state.cancel_pointer_down(id);
                                    }
                                }
                            }
                            PointerAction::PointerUp { button } => {
                                let release = {
                                    let mut sessions = state.sessions.write().await;
                                    sessions
                                        .get_mut(&session_id)?
                                        .action_state
                                        .release_pointer_button(id, *button)
                                };
                                let Some(input_state) = release else {
                                    continue;
                                };
                                executor
                                    .dispatch_pointer_event(
                                        PointerEventType::Up,
                                        pointer_state.x,
                                        pointer_state.y,
                                        *button,
                                        input_state,
                                    )
                                    .await?;
                            }
                            PointerAction::PointerMove { x, y, origin, .. } => {
                                let (target_x, target_y) = match origin {
                                    // No origin (the default) or "viewport": x/y are absolute viewport coords.
                                    None => (*x, *y),
                                    Some(Origin::Named(name)) if name == "viewport" => (*x, *y),
                                    Some(Origin::Named(name)) if name == "pointer" => {
                                        (pointer_state.x + *x, pointer_state.y + *y)
                                    }
                                    // The spec defines only "viewport" and "pointer" as named origins;
                                    // reject anything else rather than silently treating it as viewport.
                                    Some(Origin::Named(name)) => {
                                        return Err(WebDriverErrorResponse::invalid_argument(&format!(
                                            "pointerMove origin '{name}' is not a recognised named origin (expected 'viewport' or 'pointer')"
                                        )));
                                    }
                                    Some(Origin::Element(refs)) => {
                                        let element_id = refs.get(ELEMENT_KEY).ok_or_else(|| {
                                            WebDriverErrorResponse::invalid_argument(
                                                "pointerMove origin is missing a web element reference",
                                            )
                                        })?;
                                        let js_var = {
                                            let sessions = state.sessions.read().await;
                                            let session = sessions.get(&session_id)?;
                                            session
                                                .elements
                                                .get(element_id)
                                                .ok_or_else(WebDriverErrorResponse::no_such_element)?
                                                .js_ref
                                                .clone()
                                        };
                                        let (cx, cy) = executor.get_element_center(&js_var).await?;
                                        (cx + *x, cy + *y)
                                    }
                                };
                                pointer_state.x = target_x;
                                pointer_state.y = target_y;
                                // Saved per move: press and release compare against it to detect
                                // a click, and a later origin: "pointer" move starts from it.
                                let input_state = {
                                    let mut sessions = state.sessions.write().await;
                                    let action_state =
                                        &mut sessions.get_mut(&session_id)?.action_state;
                                    action_state.pointer_position = (target_x, target_y);
                                    action_state.pointer_input_state(id)
                                };
                                executor
                                    .dispatch_pointer_event(
                                        PointerEventType::Move,
                                        pointer_state.x,
                                        pointer_state.y,
                                        0,
                                        input_state,
                                    )
                                    .await?;
                            }
                            PointerAction::Pause { .. } => {}
                        }
                    }
                }
                ActionSequence::Wheel { _id: _, actions } => {
                    if let Some(action) = actions.get(tick) {
                        match action {
                            WheelAction::Scroll { x, y, delta_x, delta_y, .. } => {
                                executor
                                    .dispatch_scroll_event(*x, *y, *delta_x, *delta_y)
                                    .await?;
                            }
                            WheelAction::Pause { .. } => {}
                        }
                    }
                }
                ActionSequence::None { _id: _, actions } => {
                    if let Some(action) = actions.get(tick) {
                        match action {
                            PauseAction::Pause { .. } => {}
                        }
                    }
                }
            }
        }
        // The tick's actions are dispatched; wait its longest source duration once.
        if tick_duration_ms > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(tick_duration_ms)).await;
        }
    }

    Ok(WebDriverResponse::null())
}

/// DELETE `/session/{session_id}/actions` - Release actions
pub async fn release<R: Runtime + 'static>(
    State(state): State<Arc<AppState<R>>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    // Get session state and clear tracked actions
    let (current_window, timeouts, frame_context, mut taken) = {
        let mut sessions = state.sessions.write().await;
        let session = sessions.get_mut(&session_id)?;
        (
            session.current_window.clone(),
            session.timeouts.clone(),
            session.frame_context.clone(),
            std::mem::take(&mut session.action_state),
        )
    };

    let executor = state.get_executor_for_window(&current_window, timeouts, frame_context)?;
    let mut pressed_keys: Vec<String> = taken.pressed_keys.drain().collect();
    pressed_keys.sort();
    let mut held_modifiers = HeldModifiers::from_keys(&pressed_keys);

    // Release everything even if one fails; the state is cleared, so nothing could retry it.
    let mut first_error = None;

    // Release all pressed keys (keyUp events), in a fixed order so each keyup's flags are stable
    for key in &pressed_keys {
        held_modifiers.release(key);
        if let Err(error) = executor
            .dispatch_key_event(key, false, &held_modifiers.state())
            .await
        {
            first_error.get_or_insert(error);
        }
    }

    // Release all pressed pointer buttons where the pointer last was
    let (x, y) = taken.pointer_position;
    for (source_id, button) in taken.held_pointer_buttons() {
        if let Some(input_state) = taken.release_pointer_button(&source_id, button) {
            if let Err(error) = executor
                .dispatch_pointer_event(PointerEventType::Up, x, y, button, input_state)
                .await
            {
                first_error.get_or_insert(error);
            }
        }
    }

    first_error.map_or_else(|| Ok(WebDriverResponse::null()), Err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> ActionsRequest {
        serde_json::from_str(json).expect("valid actions request")
    }

    #[test]
    fn action_count_returns_actions_len_per_source() {
        let req = parse(
            r#"{"actions":[
                {"type":"key","id":"k","actions":[{"type":"keyDown","value":"a"},{"type":"keyUp","value":"a"}]},
                {"type":"none","id":"n","actions":[{"type":"pause","duration":0}]}
            ]}"#,
        );
        let counts: Vec<usize> = req.actions.iter().map(ActionSequence::action_count).collect();
        assert_eq!(counts, vec![2, 1]);
    }

    #[test]
    fn tick_count_is_the_max_actions_across_sources() {
        // The number of ticks is max(actions) across sources, so a shorter source contributes
        // nothing on later ticks while a longer one keeps going.
        let req = parse(
            r#"{"actions":[
                {"type":"key","id":"k","actions":[{"type":"keyDown","value":"a"}]},
                {"type":"pointer","id":"p","actions":[
                    {"type":"pointerMove","x":0,"y":0},{"type":"pointerDown","button":0},{"type":"pointerUp","button":0}
                ]}
            ]}"#,
        );
        let ticks = req
            .actions
            .iter()
            .map(ActionSequence::action_count)
            .max()
            .unwrap_or(0);
        assert_eq!(ticks, 3);
    }

    #[test]
    fn tick_count_is_zero_for_no_sources() {
        let req = parse(r#"{"actions":[]}"#);
        let ticks = req
            .actions
            .iter()
            .map(ActionSequence::action_count)
            .max()
            .unwrap_or(0);
        assert_eq!(ticks, 0);
    }

    #[test]
    fn tick_duration_is_max_across_sources_not_sum() {
        // W3C §17.4.3: a tick lasts the max pause/move/scroll duration across sources, not their sum.
        let req = parse(
            r#"{"actions":[
                {"type":"none","id":"n","actions":[{"type":"pause","duration":100},{"type":"pause","duration":50}]},
                {"type":"pointer","id":"p","actions":[
                    {"type":"pointerMove","x":0,"y":0,"duration":200},{"type":"pause","duration":30}
                ]},
                {"type":"wheel","id":"w","actions":[{"type":"scroll","x":0,"y":0,"deltaX":0,"deltaY":0,"duration":80}]}
            ]}"#,
        );
        let tick_ms =
            |tick: usize| req.actions.iter().filter_map(|s| s.duration_at(tick)).max().unwrap_or(0);
        // tick 0: max(100, 200, 80) = 200 — not the sum (380).
        assert_eq!(tick_ms(0), 200);
        // tick 1: max(50, 30) = 50 — the wheel source is exhausted and contributes nothing.
        assert_eq!(tick_ms(1), 50);
    }
}
