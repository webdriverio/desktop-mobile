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
    /// Where each source's primary button went down; releasing it there clicks.
    pub click_anchors: HashMap<String, (i32, i32)>,
    /// Last pointer position in viewport coordinates; persists across `performActions` calls.
    pub pointer_position: (i32, i32),
}

impl ActionState {
    /// `None` when the button is already held, which W3C makes a no-op.
    pub fn press_pointer_button(
        &mut self,
        source_id: &str,
        button: u32,
    ) -> Option<PointerInputState> {
        let held = self
            .pressed_buttons
            .entry(source_id.to_string())
            .or_default();
        if held.contains(&button) {
            return None;
        }
        let chorded = !held.is_empty();
        held.insert(button);
        if button == 0 {
            self.click_anchors
                .insert(source_id.to_string(), self.pointer_position);
        }
        Some(PointerInputState {
            chorded,
            ..self.pointer_input_state(source_id)
        })
    }

    /// `None` when the button isn't held, which W3C makes a no-op.
    pub fn release_pointer_button(
        &mut self,
        source_id: &str,
        button: u32,
    ) -> Option<PointerInputState> {
        let held = self
            .pressed_buttons
            .get_mut(source_id)
            .filter(|held| held.contains(&button))?;
        held.remove(&button);
        let chorded = !held.is_empty();
        let input_state = PointerInputState {
            buttons: dom_buttons_mask(held.iter()),
            suppress_mouse_events: self.canceled_pointer_downs.contains(source_id),
            chorded,
            clicks: button == 0
                && self.click_anchors.get(source_id) == Some(&self.pointer_position),
        };
        if button == 0 {
            self.click_anchors.remove(source_id);
        }
        if !chorded {
            self.canceled_pointer_downs.remove(source_id);
        }
        Some(input_state)
    }

    pub fn cancel_pointer_down(&mut self, source_id: &str) {
        self.canceled_pointer_downs.insert(source_id.to_string());
    }

    /// Input state for an event that doesn't change the held buttons.
    pub fn pointer_input_state(&self, source_id: &str) -> PointerInputState {
        let buttons = self
            .pressed_buttons
            .get(source_id)
            .map_or(0, |pressed| dom_buttons_mask(pressed.iter()));
        PointerInputState {
            buttons,
            suppress_mouse_events: self.canceled_pointer_downs.contains(source_id),
            chorded: false,
            clicks: false,
        }
    }

    pub fn forget_pointer_input(&mut self) {
        self.pressed_buttons.clear();
        self.canceled_pointer_downs.clear();
        self.click_anchors.clear();
    }

    /// Sorted by source, then button, so releasing them is deterministic.
    pub fn held_pointer_buttons(&self) -> Vec<(String, u32)> {
        let mut held: Vec<(String, u32)> = self
            .pressed_buttons
            .iter()
            .flat_map(|(source_id, buttons)| {
                buttons
                    .iter()
                    .map(move |&button| (source_id.clone(), button))
            })
            .collect();
        held.sort();
        held
    }
}

fn dom_buttons_mask<'a>(buttons: impl Iterator<Item = &'a u32>) -> u32 {
    buttons.fold(0, |mask, &button| mask | dom_buttons_bit(button))
}

/// The DOM `buttons` bitmask swaps the middle and secondary buttons relative to `button`.
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
            chorded: false,
            clicks: false,
        }
    }

    fn chord(buttons: u32, suppress_mouse_events: bool) -> PointerInputState {
        PointerInputState {
            chorded: true,
            ..input(buttons, suppress_mouse_events)
        }
    }

    fn clicking(state: PointerInputState) -> PointerInputState {
        PointerInputState {
            clicks: true,
            ..state
        }
    }

    #[test]
    fn held_buttons_use_the_dom_buttons_bitmask() {
        let mut state = ActionState::default();

        assert_eq!(
            state.press_pointer_button("mouse", 0),
            Some(input(1, false))
        );
        assert_eq!(
            state.press_pointer_button("mouse", 2),
            Some(chord(3, false))
        );
        assert_eq!(
            state.press_pointer_button("mouse", 1),
            Some(chord(7, false))
        );
        assert_eq!(state.pointer_input_state("mouse"), input(7, false));

        assert_eq!(
            state.release_pointer_button("mouse", 0),
            Some(clicking(chord(6, false)))
        );
        assert_eq!(
            state.release_pointer_button("mouse", 1),
            Some(chord(2, false))
        );
        assert_eq!(
            state.release_pointer_button("mouse", 2),
            Some(input(0, false))
        );
        assert_eq!(state.pointer_input_state("mouse"), input(0, false));
    }

    #[test]
    fn held_buttons_are_tracked_per_source() {
        let mut state = ActionState::default();

        assert_eq!(state.press_pointer_button("a", 0), Some(input(1, false)));
        assert_eq!(state.press_pointer_button("b", 2), Some(input(2, false)));

        assert_eq!(state.pointer_input_state("a"), input(1, false));
        assert_eq!(state.pointer_input_state("b"), input(2, false));
    }

    #[test]
    fn pressing_a_held_button_again_does_nothing() {
        let mut state = ActionState::default();
        state.press_pointer_button("mouse", 0);

        assert_eq!(state.press_pointer_button("mouse", 0), None);
        assert_eq!(state.pointer_input_state("mouse"), input(1, false));
    }

    #[test]
    fn canceled_pointer_down_suppresses_mouse_events_through_the_final_release() {
        let mut state = ActionState::default();
        state.press_pointer_button("mouse", 0);
        state.cancel_pointer_down("mouse");

        assert_eq!(state.pointer_input_state("mouse"), input(1, true));
        assert_eq!(
            state.release_pointer_button("mouse", 0),
            Some(clicking(input(0, true)))
        );
        assert_eq!(state.pointer_input_state("mouse"), input(0, false));
        assert_eq!(
            state.press_pointer_button("mouse", 0),
            Some(input(1, false))
        );
    }

    #[test]
    fn suppression_outlasts_a_release_that_leaves_a_button_held() {
        let mut state = ActionState::default();
        state.press_pointer_button("mouse", 0);
        state.cancel_pointer_down("mouse");

        assert_eq!(state.press_pointer_button("mouse", 2), Some(chord(3, true)));
        assert_eq!(
            state.release_pointer_button("mouse", 0),
            Some(clicking(chord(2, true)))
        );
        assert_eq!(state.pointer_input_state("mouse"), input(2, true));
        assert_eq!(
            state.release_pointer_button("mouse", 2),
            Some(input(0, true))
        );
        assert_eq!(state.pointer_input_state("mouse"), input(0, false));
    }

    #[test]
    fn releasing_an_unpressed_button_does_nothing() {
        let mut state = ActionState::default();
        state.press_pointer_button("mouse", 0);
        state.cancel_pointer_down("mouse");

        assert_eq!(state.release_pointer_button("mouse", 2), None);
        assert_eq!(state.pointer_input_state("mouse"), input(1, true));
    }

    #[test]
    fn a_primary_release_clicks_only_where_its_press_was() {
        let mut state = ActionState::default();
        state.press_pointer_button("mouse", 0);
        state.pointer_position = (5, 5);
        assert_eq!(
            state.release_pointer_button("mouse", 0),
            Some(input(0, false))
        );

        state.press_pointer_button("mouse", 0);
        assert_eq!(
            state.release_pointer_button("mouse", 0),
            Some(clicking(input(0, false)))
        );
    }

    #[test]
    fn forgetting_pointer_input_lets_the_next_press_dispatch() {
        let mut state = ActionState::default();
        state.press_pointer_button("mouse", 0);
        state.cancel_pointer_down("mouse");

        state.forget_pointer_input();

        assert_eq!(
            state.press_pointer_button("mouse", 0),
            Some(input(1, false))
        );
    }

    #[test]
    fn held_pointer_buttons_are_listed_by_source_then_button() {
        let mut state = ActionState::default();
        for (source_id, button) in [("b", 0), ("a", 2), ("b", 1), ("a", 0), ("a", 1)] {
            state.press_pointer_button(source_id, button);
        }

        let held = state.held_pointer_buttons();

        let expected = [("a", 0), ("a", 1), ("a", 2), ("b", 0), ("b", 1)];
        assert_eq!(
            held,
            expected.map(|(source_id, button)| (source_id.to_string(), button))
        );
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
