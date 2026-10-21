use std::collections::{HashMap, HashSet};

use serde::Serialize;
use uuid::Uuid;

use super::element::ElementStore;
use crate::platform::{FrameId, PointerInputState};
use crate::server::response::WebDriverErrorResponse;

/// Tracks currently pressed keys and pointer buttons for action state
#[derive(Debug, Default, Clone)]
pub struct ActionState {
    /// Currently pressed keyboard keys (`WebDriver` key codes)
    pub pressed_keys: HashSet<String>,
    /// Currently pressed pointer buttons by source ID
    pub pressed_buttons: HashMap<String, HashSet<u32>>,
    /// Pointer sources whose `pointerdown` was canceled; their compatibility mouse
    /// events stay suppressed until they release every button.
    pub canceled_pointer_downs: HashSet<String>,
    /// Last pointer position in viewport coordinates. Persisted across
    /// `performActions` calls so an `origin: "pointer"` move resolves relative to
    /// where the pointer actually is, not (0, 0) at the start of every call.
    pub pointer_position: (i32, i32),
}

impl ActionState {
    /// Record a press and return the input state its events carry.
    pub fn press_pointer_button(&mut self, source_id: &str, button: u32) -> PointerInputState {
        self.pressed_buttons
            .entry(source_id.to_string())
            .or_default()
            .insert(button);
        self.pointer_input_state(source_id)
    }

    /// Record a release and return the input state its events carry. The release
    /// that leaves no button held is the last one suppressed.
    pub fn release_pointer_button(&mut self, source_id: &str, button: u32) -> PointerInputState {
        let suppress_mouse_events = self.canceled_pointer_downs.contains(source_id);
        if let Some(buttons) = self.pressed_buttons.get_mut(source_id) {
            buttons.remove(&button);
        }
        let input_state = PointerInputState {
            suppress_mouse_events,
            ..self.pointer_input_state(source_id)
        };
        if input_state.buttons == 0 {
            self.canceled_pointer_downs.remove(source_id);
        }
        input_state
    }

    /// Record that the source's `pointerdown` was canceled.
    pub fn cancel_pointer_down(&mut self, source_id: &str) {
        self.canceled_pointer_downs.insert(source_id.to_string());
    }

    /// Input state for an event that doesn't change the held buttons.
    pub fn pointer_input_state(&self, source_id: &str) -> PointerInputState {
        let buttons = self.pressed_buttons.get(source_id).map_or(0, |pressed| {
            pressed
                .iter()
                .fold(0, |mask, &button| mask | dom_buttons_bit(button))
        });
        PointerInputState {
            buttons,
            suppress_mouse_events: self.canceled_pointer_downs.contains(source_id),
        }
    }
}

/// The DOM `buttons` bitmask swaps the middle and secondary buttons relative to
/// `button`: button 1 (middle) is 4 and button 2 (right) is 2.
fn dom_buttons_bit(button: u32) -> u32 {
    match button {
        1 => 4,
        2 => 2,
        other => 1u32.checked_shl(other).unwrap_or(0),
    }
}

/// Session timeouts configuration
#[derive(Debug, Clone, Serialize)]
#[allow(clippy::struct_field_names)]
pub struct Timeouts {
    /// Implicit wait timeout in milliseconds
    pub implicit_ms: u64,
    /// Page load timeout in milliseconds
    pub page_load_ms: u64,
    /// Script execution timeout in milliseconds
    pub script_ms: u64,
}

impl Default for Timeouts {
    fn default() -> Self {
        Self {
            implicit_ms: 0,
            page_load_ms: 300_000,
            script_ms: 30_000,
        }
    }
}

/// Represents a `WebDriver` session
#[derive(Debug)]
pub struct Session {
    /// Unique session identifier
    pub id: String,
    /// Session timeouts
    pub timeouts: Timeouts,
    /// Element reference storage
    pub elements: ElementStore,
    /// Current window handle
    pub current_window: String,
    /// Current frame context (stack of frame selectors)
    pub frame_context: Vec<FrameId>,
    /// Increments whenever the selected top-level browsing context changes
    pub browsing_context_generation: u64,
    /// Action state tracking for pressed keys/buttons
    pub action_state: ActionState,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SwitchWindowError {
    BrowsingContextGenerationOverflow,
}

impl Session {
    pub fn new(initial_window: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            timeouts: Timeouts::default(),
            elements: ElementStore::new(),
            current_window: initial_window,
            frame_context: Vec::new(),
            browsing_context_generation: 0,
            action_state: ActionState::default(),
        }
    }

    pub fn switch_to_window(&mut self, window: String) -> Result<(), SwitchWindowError> {
        let browsing_context_generation = self
            .browsing_context_generation
            .checked_add(1)
            .ok_or(SwitchWindowError::BrowsingContextGenerationOverflow)?;

        self.current_window = window;
        self.frame_context.clear();
        self.browsing_context_generation = browsing_context_generation;

        Ok(())
    }
}

/// Manages `WebDriver` sessions
#[derive(Debug, Default)]
pub struct SessionManager {
    sessions: HashMap<String, Session>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Create a new session
    pub fn create(&mut self, initial_window: String) -> &Session {
        let session = Session::new(initial_window);
        let id = session.id.clone();
        self.sessions.insert(id.clone(), session);
        self.sessions.get(&id).expect("session was just inserted")
    }

    /// Get a session by ID
    pub fn get(&self, id: &str) -> Result<&Session, WebDriverErrorResponse> {
        self.sessions
            .get(id)
            .ok_or_else(|| WebDriverErrorResponse::invalid_session_id(id))
    }

    /// Get a mutable session by ID
    pub fn get_mut(&mut self, id: &str) -> Result<&mut Session, WebDriverErrorResponse> {
        self.sessions
            .get_mut(id)
            .ok_or_else(|| WebDriverErrorResponse::invalid_session_id(id))
    }

    /// Delete a session
    pub fn delete(&mut self, id: &str) -> bool {
        self.sessions.remove(id).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::{ActionState, FrameId, PointerInputState, Session, SwitchWindowError};

    fn input(buttons: u32, suppress_mouse_events: bool) -> PointerInputState {
        PointerInputState {
            buttons,
            suppress_mouse_events,
        }
    }

    #[test]
    fn held_buttons_use_the_dom_buttons_bitmask() {
        let mut state = ActionState::default();

        assert_eq!(state.press_pointer_button("mouse", 0), input(1, false));
        assert_eq!(state.press_pointer_button("mouse", 2), input(3, false));
        assert_eq!(state.press_pointer_button("mouse", 1), input(7, false));
        assert_eq!(state.pointer_input_state("mouse"), input(7, false));

        assert_eq!(state.release_pointer_button("mouse", 0), input(6, false));
        assert_eq!(state.release_pointer_button("mouse", 1), input(2, false));
        assert_eq!(state.release_pointer_button("mouse", 2), input(0, false));
        assert_eq!(state.pointer_input_state("mouse"), input(0, false));
    }

    #[test]
    fn held_buttons_are_tracked_per_source() {
        let mut state = ActionState::default();

        state.press_pointer_button("a", 0);
        state.press_pointer_button("b", 2);

        assert_eq!(state.pointer_input_state("a"), input(1, false));
        assert_eq!(state.pointer_input_state("b"), input(2, false));
    }

    #[test]
    fn canceled_pointer_down_suppresses_mouse_events_through_the_final_release() {
        let mut state = ActionState::default();
        state.press_pointer_button("mouse", 0);
        state.cancel_pointer_down("mouse");

        assert_eq!(state.pointer_input_state("mouse"), input(1, true));
        assert_eq!(state.release_pointer_button("mouse", 0), input(0, true));
        assert_eq!(state.pointer_input_state("mouse"), input(0, false));
        assert_eq!(state.press_pointer_button("mouse", 0), input(1, false));
    }

    #[test]
    fn suppression_outlasts_a_release_that_leaves_a_button_held() {
        let mut state = ActionState::default();
        state.press_pointer_button("mouse", 0);
        state.cancel_pointer_down("mouse");
        state.press_pointer_button("mouse", 2);

        assert_eq!(state.release_pointer_button("mouse", 0), input(2, true));
        assert_eq!(state.pointer_input_state("mouse"), input(2, true));
        assert_eq!(state.release_pointer_button("mouse", 2), input(0, true));
        assert_eq!(state.pointer_input_state("mouse"), input(0, false));
    }

    #[test]
    fn releasing_an_unpressed_button_clears_suppression() {
        let mut state = ActionState::default();
        state.cancel_pointer_down("mouse");

        assert_eq!(state.release_pointer_button("mouse", 0), input(0, true));
        assert_eq!(state.pointer_input_state("mouse"), input(0, false));
    }

    #[test]
    fn switching_windows_updates_context_and_generation_together() {
        let mut session = Session::new("child-left".to_string());
        session.frame_context.push(FrameId::Index(0));

        assert_eq!(session.switch_to_window("child-right".to_string()), Ok(()));

        assert_eq!(session.current_window, "child-right");
        assert!(session.frame_context.is_empty());
        assert_eq!(session.browsing_context_generation, 1);
    }

    #[test]
    fn switching_windows_at_max_generation_leaves_session_unchanged() {
        let mut session = Session::new("child-left".to_string());
        session.frame_context.push(FrameId::Index(0));
        session.browsing_context_generation = u64::MAX;

        let result = session.switch_to_window("child-right".to_string());

        assert_eq!(
            result,
            Err(SwitchWindowError::BrowsingContextGenerationOverflow)
        );
        assert_eq!(session.current_window, "child-left");
        assert!(matches!(
            session.frame_context.as_slice(),
            [FrameId::Index(0)]
        ));
        assert_eq!(session.browsing_context_generation, u64::MAX);
    }
}
