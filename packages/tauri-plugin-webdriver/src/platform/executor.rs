use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::webview::Cookie as TauriCookie;
use tauri::{Runtime, WebviewWindow};

#[cfg(desktop)]
use tauri::Listener;
#[cfg(desktop)]
use tauri::{LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize};

use tauri::Manager;

use crate::platform::alert_state::{AlertStateManager, AlertType};
use crate::server::response::WebDriverErrorResponse;

/// Element bounding rectangle
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ElementRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Window rectangle (position and size)
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WindowRect {
    #[serde(default)]
    pub x: i32,
    #[serde(default)]
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[cfg(desktop)]
fn physical_window_rect_to_logical(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    scale_factor: f64,
) -> WindowRect {
    let position = position.to_logical::<i32>(scale_factor);
    let size = size.to_logical::<u32>(scale_factor);

    WindowRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    }
}

#[cfg(desktop)]
fn physical_window_chrome_to_logical(
    outer: PhysicalSize<u32>,
    inner: PhysicalSize<u32>,
    scale_factor: f64,
) -> LogicalSize<u32> {
    PhysicalSize::new(
        outer.width.saturating_sub(inner.width),
        outer.height.saturating_sub(inner.height),
    )
    .to_logical(scale_factor)
}

#[cfg(desktop)]
const WINDOW_CHANGE_EVENT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1);

/// Apply a native window change and wait for Tauri to confirm it via `event_name`.
///
/// Only a failure of the native call itself is an error. A window manager may clamp or
/// ignore a request, in which case the confirming event never arrives — `Set Window Rect`
/// is best-effort, so callers report the rect the window actually ended up with instead
/// of failing the command.
#[cfg(desktop)]
async fn apply_window_change<R, F>(
    window: &WebviewWindow<R>,
    event_name: &'static str,
    operation: &'static str,
    change: F,
) -> Result<(), WebDriverErrorResponse>
where
    R: Runtime,
    F: FnOnce() -> tauri::Result<()>,
{
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let listener_id = window.once(event_name, move |_| {
        let _ = sender.send(());
    });

    if let Err(error) = change() {
        window.unlisten(listener_id);
        return Err(WebDriverErrorResponse::unknown_error(&format!(
            "Failed to {operation}: {error}"
        )));
    }

    match tokio::time::timeout(WINDOW_CHANGE_EVENT_TIMEOUT, receiver).await {
        Ok(Ok(())) => {}
        Ok(Err(_)) => {
            tracing::debug!("Window event listener closed while waiting to {operation}");
        }
        Err(_) => {
            window.unlisten(listener_id);
            tracing::debug!("Timed out waiting to {operation}");
        }
    }

    Ok(())
}

#[cfg(all(test, desktop))]
mod window_rect_tests {
    use super::*;

    #[test]
    fn converts_physical_window_rect_at_common_scale_factors() {
        let cases = [
            (
                PhysicalPosition::new(-200, 150),
                PhysicalSize::new(720, 540),
                1.0,
                WindowRect {
                    x: -200,
                    y: 150,
                    width: 720,
                    height: 540,
                },
            ),
            (
                PhysicalPosition::new(-151, 251),
                PhysicalSize::new(1000, 750),
                1.25,
                WindowRect {
                    x: -121,
                    y: 201,
                    width: 800,
                    height: 600,
                },
            ),
            (
                PhysicalPosition::new(-400, 300),
                PhysicalSize::new(1440, 1080),
                2.0,
                WindowRect {
                    x: -200,
                    y: 150,
                    width: 720,
                    height: 540,
                },
            ),
        ];

        for (position, size, scale_factor, expected) in cases {
            let actual = physical_window_rect_to_logical(position, size, scale_factor);

            assert_eq!(actual.x, expected.x);
            assert_eq!(actual.y, expected.y);
            assert_eq!(actual.width, expected.width);
            assert_eq!(actual.height, expected.height);
        }
    }

    #[test]
    fn converts_physical_window_chrome_before_subtracting_it() {
        let retina_chrome = physical_window_chrome_to_logical(
            PhysicalSize::new(1440, 1080),
            PhysicalSize::new(1440, 1032),
            2.0,
        );
        let fractional_chrome = physical_window_chrome_to_logical(
            PhysicalSize::new(1251, 1001),
            PhysicalSize::new(1000, 750),
            1.25,
        );

        assert_eq!(retina_chrome, LogicalSize::new(0, 24));
        assert_eq!(fractional_chrome, LogicalSize::new(201, 201));
    }
}

/// Frame identifier for switching frames
#[derive(Debug, Clone)]
pub enum FrameId {
    /// Frame by index
    Index(u32),
    /// Frame by element reference (`js_var`)
    Element(String),
}

/// Pointer event type
#[derive(Debug, Clone, Copy)]
pub enum PointerEventType {
    Down,
    Up,
    Move,
    Click,
}

/// Cookie data
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Cookie {
    pub name: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(default)]
    pub secure: bool,
    #[serde(default, rename = "httpOnly")]
    pub http_only: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiry: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "sameSite")]
    pub same_site: Option<String>,
}

/// Print options for PDF generation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PrintOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orientation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "pageWidth")]
    pub page_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "pageHeight")]
    pub page_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "marginTop")]
    pub margin_top: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "marginBottom")]
    pub margin_bottom: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "marginLeft")]
    pub margin_left: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "marginRight")]
    pub margin_right: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "shrinkToFit")]
    pub shrink_to_fit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "pageRanges")]
    pub page_ranges: Option<Vec<String>>,
}

/// Tracks the state of modifier keys during action sequences
#[derive(Debug, Clone, Copy, Default)]
#[allow(clippy::struct_excessive_bools)]
pub struct ModifierState {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
    pub meta: bool,
}

impl ModifierState {
    /// Update modifier state when a key is pressed or released
    pub fn update(&mut self, key: &str, is_down: bool) {
        match key {
            "\u{E009}" => self.ctrl = is_down,  // Control
            "\u{E008}" => self.shift = is_down, // Shift
            "\u{E00A}" => self.alt = is_down,   // Alt
            "\u{E03D}" => self.meta = is_down,  // Meta
            _ => {}
        }
    }
}

/// Platform-agnostic trait for `WebView` operations.
/// Each platform (macOS, Windows, Linux) implements this trait.
#[async_trait]
#[allow(clippy::too_many_lines)]
pub trait PlatformExecutor<R: Runtime>: Send + Sync {
    // =========================================================================
    // Window Access
    // =========================================================================

    /// Get a reference to the underlying window
    fn window(&self) -> &WebviewWindow<R>;

    /// Get the script timeout in milliseconds
    fn script_timeout_ms(&self) -> u64;

    // =========================================================================
    // Core JavaScript Execution
    // =========================================================================

    /// Execute JavaScript and return the result as JSON
    async fn evaluate_js(&self, script: &str) -> Result<Value, WebDriverErrorResponse>;

    // =========================================================================
    // Navigation
    // =========================================================================

    /// Navigate to a URL
    async fn navigate(&self, url: &str) -> Result<(), WebDriverErrorResponse> {
        let script = format!(
            r"window.location.href = '{}'; null;",
            url.replace('\\', "\\\\").replace('\'', "\\'")
        );
        self.evaluate_js(&script).await?;
        Ok(())
    }

    /// Get current URL
    async fn get_url(&self) -> Result<String, WebDriverErrorResponse> {
        let result = self.evaluate_js("window.location.href").await?;
        extract_string_value(&result)
    }

    /// Get page title
    async fn get_title(&self) -> Result<String, WebDriverErrorResponse> {
        let result = self.evaluate_js("document.title").await?;
        extract_string_value(&result)
    }

    /// Navigate back in history
    async fn go_back(&self) -> Result<(), WebDriverErrorResponse> {
        self.evaluate_js("window.history.back(); null;").await?;
        Ok(())
    }

    /// Navigate forward in history
    async fn go_forward(&self) -> Result<(), WebDriverErrorResponse> {
        self.evaluate_js("window.history.forward(); null;").await?;
        Ok(())
    }

    /// Refresh the current page
    async fn refresh(&self) -> Result<(), WebDriverErrorResponse> {
        self.evaluate_js("window.location.reload(); null;").await?;
        Ok(())
    }

    // =========================================================================
    // Document
    // =========================================================================

    /// Get page source HTML
    async fn get_source(&self) -> Result<String, WebDriverErrorResponse> {
        let result = self
            .evaluate_js("document.documentElement.outerHTML")
            .await?;
        extract_string_value(&result)
    }

    // =========================================================================
    // Element Operations
    // =========================================================================

    /// Find element and store reference in a JavaScript variable
    /// Returns true if element was found
    async fn find_element(
        &self,
        strategy_js: &str,
        js_var: &str,
    ) -> Result<bool, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var el = {strategy_js};
                if (el) {{
                    window.{js_var} = el;
                    return true;
                }}
                return false;
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_bool_value(&result)
    }

    /// Find multiple elements and store count
    /// Returns the number of elements found
    async fn find_elements(
        &self,
        strategy_js: &str,
        js_var_prefix: &str,
    ) -> Result<usize, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var elements = {strategy_js};
                var count = elements.length;
                for (var i = 0; i < count; i++) {{
                    window['{js_var_prefix}' + i] = elements[i];
                }}
                return count;
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_usize_value(&result)
    }

    /// Find element from a parent element and store reference
    /// Returns true if element was found
    async fn find_element_from_element(
        &self,
        parent_js_var: &str,
        strategy_js: &str,
        js_var: &str,
    ) -> Result<bool, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var parent = window.{parent_js_var};
                if (!parent || !parent.isConnected) {{
                    throw new Error('stale element reference');
                }}
                var el = {strategy_js};
                if (el) {{
                    window.{js_var} = el;
                    return true;
                }}
                return false;
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_bool_value(&result)
    }

    /// Find multiple elements from a parent element
    /// Returns count of elements found, stores as {prefix}0, {prefix}1, etc.
    async fn find_elements_from_element(
        &self,
        parent_js_var: &str,
        strategy_js: &str,
        js_var_prefix: &str,
    ) -> Result<usize, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var parent = window.{parent_js_var};
                if (!parent || !parent.isConnected) {{
                    throw new Error('stale element reference');
                }}
                var elements = {strategy_js};
                var count = elements.length;
                for (var i = 0; i < count; i++) {{
                    window['{js_var_prefix}' + i] = elements[i];
                }}
                return count;
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_usize_value(&result)
    }

    /// Get element text content
    async fn get_element_text(&self, js_var: &str) -> Result<String, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}
                return el.textContent || '';
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_string_value(&result)
    }

    /// Get element tag name (lowercase)
    async fn get_element_tag_name(&self, js_var: &str) -> Result<String, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}
                return el.tagName.toLowerCase();
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_string_value(&result)
    }

    /// Get element attribute value
    /// Per W3C `WebDriver` spec, certain attributes should return current property values:
    /// - "value" on input/textarea returns current value property
    /// - "checked" on checkbox/radio returns current checked state
    /// - "selected" on option returns current selected state
    async fn get_element_attribute(
        &self,
        js_var: &str,
        name: &str,
    ) -> Result<Option<String>, WebDriverErrorResponse> {
        let escaped_name = name.replace('\\', "\\\\").replace('\'', "\\'");
        let script = format!(
            r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}
                var attrName = '{escaped_name}'.toLowerCase();
                var tagName = el.tagName.toLowerCase();

                // Per W3C WebDriver spec, return property values for certain attributes
                if (attrName === 'value') {{
                    if (tagName === 'input' || tagName === 'textarea') {{
                        return el.value;
                    }}
                }}
                if (attrName === 'checked') {{
                    if (tagName === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {{
                        return el.checked ? 'true' : null;
                    }}
                }}
                if (attrName === 'selected') {{
                    if (tagName === 'option') {{
                        return el.selected ? 'true' : null;
                    }}
                }}

                return el.getAttribute('{escaped_name}');
            }})()"
        );
        let result = self.evaluate_js(&script).await?;

        if let Some(value) = result.get("value") {
            if value.is_null() {
                return Ok(None);
            }
            if let Some(s) = value.as_str() {
                return Ok(Some(s.to_string()));
            }
        }
        Ok(None)
    }

    /// Get element property value
    async fn get_element_property(
        &self,
        js_var: &str,
        name: &str,
    ) -> Result<Value, WebDriverErrorResponse> {
        let escaped_name = name.replace('\\', "\\\\").replace('\'', "\\'");
        let script = format!(
            r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}
                return el['{escaped_name}'];
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_value(&result)
    }

    /// Get element CSS property value
    async fn get_element_css_value(
        &self,
        js_var: &str,
        property: &str,
    ) -> Result<String, WebDriverErrorResponse> {
        let escaped_prop = property.replace('\\', "\\\\").replace('\'', "\\'");
        let script = format!(
            r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}
                return window.getComputedStyle(el).getPropertyValue('{escaped_prop}');
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_string_value(&result)
    }

    /// Get element bounding rectangle
    async fn get_element_rect(&self, js_var: &str) -> Result<ElementRect, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}
                var rect = el.getBoundingClientRect();
                return {{
                    x: rect.x + window.scrollX,
                    y: rect.y + window.scrollY,
                    width: rect.width,
                    height: rect.height
                }};
            }})()"
        );
        let result = self.evaluate_js(&script).await?;

        if let Some(value) = result.get("value") {
            return Ok(ElementRect {
                x: value.get("x").and_then(Value::as_f64).unwrap_or(0.0),
                y: value.get("y").and_then(Value::as_f64).unwrap_or(0.0),
                width: value.get("width").and_then(Value::as_f64).unwrap_or(0.0),
                height: value.get("height").and_then(Value::as_f64).unwrap_or(0.0),
            });
        }
        Ok(ElementRect::default())
    }

    /// Get an element's in-view center point in **client (viewport)** coordinates,
    /// scrolling it into view first. Unlike [`Executor::get_element_rect`], this
    /// does not add scroll offsets: pointer events dispatch against viewport
    /// coordinates (`clientX`/`clientY`), so the center must be viewport-relative.
    async fn get_element_center(&self, js_var: &str) -> Result<(i32, i32), WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}
                el.scrollIntoView({{ behavior: 'instant', block: 'center', inline: 'center' }});
                var r = el.getBoundingClientRect();
                return {{
                    x: Math.floor(r.left + r.width / 2),
                    y: Math.floor(r.top + r.height / 2)
                }};
            }})()"
        );
        let result = self.evaluate_js(&script).await?;

        let value = result.get("value").cloned().ok_or_else(|| {
            WebDriverErrorResponse::unknown_error("element center script returned no value")
        })?;

        #[derive(serde::Deserialize)]
        struct Center {
            x: i32,
            y: i32,
        }
        let center: Center = serde_json::from_value(value).map_err(|err| {
            WebDriverErrorResponse::unknown_error(&format!("could not read element center: {err}"))
        })?;
        Ok((center.x, center.y))
    }

    /// Check if element is displayed
    async fn is_element_displayed(&self, js_var: &str) -> Result<bool, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}
                var style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_bool_value(&result)
    }

    /// Check if element is enabled
    async fn is_element_enabled(&self, js_var: &str) -> Result<bool, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}
                return !el.disabled;
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_bool_value(&result)
    }

    /// Check if element is selected (for checkboxes, radio buttons, options)
    async fn is_element_selected(&self, js_var: &str) -> Result<bool, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}
                if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {{
                    return el.checked;
                }}
                if (el.tagName === 'OPTION') {{
                    return el.selected;
                }}
                return false;
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_bool_value(&result)
    }

    /// Click on element
    async fn click_element(&self, js_var: &str) -> Result<(), WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}
                el.scrollIntoView({{ block: 'center', inline: 'center' }});
                el.click();
                // Explicitly focus the element after click - programmatic click()
                // doesn't always trigger focus like a real click would
                if (typeof el.focus === 'function') {{
                    el.focus();
                }}
                return true;
            }})()"
        );
        self.evaluate_js(&script).await?;
        Ok(())
    }

    /// Clear element content (for inputs/textareas)
    async fn clear_element(&self, js_var: &str) -> Result<(), WebDriverErrorResponse> {
        let script = format!(
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
                    nativeInputValueSetter.call(el, '');
                    var inputEvent = new InputEvent('input', {{
                        bubbles: true,
                        cancelable: true,
                        inputType: 'deleteContentBackward'
                    }});
                    el.dispatchEvent(inputEvent);
                    var changeEvent = new Event('change', {{ bubbles: true }});
                    el.dispatchEvent(changeEvent);
                }} else if (el.isContentEditable) {{
                    el.innerHTML = '';
                }}
                return true;
            }})()"
        );
        self.evaluate_js(&script).await?;
        Ok(())
    }

    /// Send keys to element
    async fn send_keys_to_element(
        &self,
        js_var: &str,
        text: &str,
    ) -> Result<(), WebDriverErrorResponse> {
        let script = crate::platform::key_input::build_send_keys_script(js_var, text);
        self.evaluate_js(&script).await?;
        Ok(())
    }

    /// Get the active (focused) element and store in `js_var`
    /// Returns true if an active element was found
    async fn get_active_element(&self, js_var: &str) -> Result<bool, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var el = document.activeElement;
                if (el && el !== document.body) {{
                    window.{js_var} = el;
                    return true;
                }}
                return false;
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_bool_value(&result)
    }

    /// Get element's computed accessibility role
    async fn get_element_computed_role(
        &self,
        js_var: &str,
    ) -> Result<String, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}

                // Check for explicit role attribute first
                var explicitRole = el.getAttribute('role');
                if (explicitRole) return explicitRole;

                // Try computedRole if available (Chrome/Edge)
                if (el.computedRole) return el.computedRole;

                // Compute implicit role based on element type
                var tag = el.tagName.toLowerCase();
                var type = el.type ? el.type.toLowerCase() : '';

                // Map elements to their implicit ARIA roles
                var roleMap = {{
                    'a': el.hasAttribute('href') ? 'link' : 'generic',
                    'article': 'article',
                    'aside': 'complementary',
                    'button': 'button',
                    'datalist': 'listbox',
                    'details': 'group',
                    'dialog': 'dialog',
                    'fieldset': 'group',
                    'figure': 'figure',
                    'footer': 'contentinfo',
                    'form': 'form',
                    'h1': 'heading',
                    'h2': 'heading',
                    'h3': 'heading',
                    'h4': 'heading',
                    'h5': 'heading',
                    'h6': 'heading',
                    'header': 'banner',
                    'hr': 'separator',
                    'img': el.getAttribute('alt') === '' ? 'presentation' : 'img',
                    'li': 'listitem',
                    'main': 'main',
                    'menu': 'list',
                    'meter': 'meter',
                    'nav': 'navigation',
                    'ol': 'list',
                    'optgroup': 'group',
                    'option': 'option',
                    'output': 'status',
                    'progress': 'progressbar',
                    'section': 'region',
                    'select': el.multiple ? 'listbox' : 'combobox',
                    'summary': 'button',
                    'table': 'table',
                    'tbody': 'rowgroup',
                    'td': 'cell',
                    'textarea': 'textbox',
                    'tfoot': 'rowgroup',
                    'th': 'columnheader',
                    'thead': 'rowgroup',
                    'tr': 'row',
                    'ul': 'list'
                }};

                // Handle input types
                if (tag === 'input') {{
                    var inputRoles = {{
                        'button': 'button',
                        'checkbox': 'checkbox',
                        'email': 'textbox',
                        'image': 'button',
                        'number': 'spinbutton',
                        'radio': 'radio',
                        'range': 'slider',
                        'reset': 'button',
                        'search': 'searchbox',
                        'submit': 'button',
                        'tel': 'textbox',
                        'text': 'textbox',
                        'url': 'textbox'
                    }};
                    return inputRoles[type] || 'textbox';
                }}

                return roleMap[tag] || '';
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_string_value(&result)
    }

    /// Get element's computed accessibility label
    async fn get_element_computed_label(
        &self,
        js_var: &str,
    ) -> Result<String, WebDriverErrorResponse> {
        let script = format!(
            r#"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}

                // Try computedName if available (Chrome/Edge)
                if (el.computedName) return el.computedName;

                // Check aria-labelledby first (highest priority)
                var labelledBy = el.getAttribute('aria-labelledby');
                if (labelledBy) {{
                    var labels = labelledBy.split(/\s+/).map(function(id) {{
                        var labelEl = document.getElementById(id);
                        return labelEl ? labelEl.textContent : '';
                    }});
                    var combined = labels.join(' ').trim();
                    if (combined) return combined;
                }}

                // Check aria-label
                var ariaLabel = el.getAttribute('aria-label');
                if (ariaLabel) return ariaLabel;

                // For inputs, check associated label
                var tag = el.tagName.toLowerCase();
                if (tag === 'input' || tag === 'textarea' || tag === 'select') {{
                    // Check for label with 'for' attribute
                    if (el.id) {{
                        var label = document.querySelector("label[for='" + el.id + "']");
                        if (label) return label.textContent.trim();
                    }}
                    // Check for wrapping label
                    var parentLabel = el.closest('label');
                    if (parentLabel) {{
                        // Get label text excluding the input's value
                        var clone = parentLabel.cloneNode(true);
                        var inputs = clone.querySelectorAll('input, textarea, select');
                        inputs.forEach(function(input) {{ input.remove(); }});
                        var labelText = clone.textContent.trim();
                        if (labelText) return labelText;
                    }}
                    // Check placeholder
                    if (el.placeholder) return el.placeholder;
                }}

                // For buttons and links, use text content
                if (tag === 'button' || tag === 'a') {{
                    return el.textContent.trim();
                }}

                // For images, use alt text
                if (tag === 'img') {{
                    return el.getAttribute('alt') || '';
                }}

                // Check title attribute as last resort
                var title = el.getAttribute('title');
                if (title) return title;

                // Fall back to text content for other elements
                return el.textContent ? el.textContent.trim() : '';
            }})()"#
        );
        let result = self.evaluate_js(&script).await?;
        extract_string_value(&result)
    }

    // =========================================================================
    // Shadow DOM
    // =========================================================================

    /// Get element's shadow root and store in `shadow_var`
    /// Returns true if shadow root exists
    async fn get_element_shadow_root(
        &self,
        js_var: &str,
        shadow_var: &str,
    ) -> Result<bool, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var el = window.{js_var};
                if (!el || !el.isConnected) {{
                    throw new Error('stale element reference');
                }}
                var shadow = el.shadowRoot;
                if (shadow) {{
                    window.{shadow_var} = shadow;
                    return true;
                }}
                return false;
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_bool_value(&result)
    }

    /// Find element within a shadow root
    async fn find_element_from_shadow(
        &self,
        shadow_var: &str,
        strategy_js: &str,
        js_var: &str,
    ) -> Result<bool, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var shadow = window.{shadow_var};
                if (!shadow) {{
                    throw new Error('no such shadow root');
                }}
                var el = {strategy_js};
                if (el) {{
                    window.{js_var} = el;
                    return true;
                }}
                return false;
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_bool_value(&result)
    }

    /// Find multiple elements within a shadow root
    async fn find_elements_from_shadow(
        &self,
        shadow_var: &str,
        strategy_js: &str,
        js_var_prefix: &str,
    ) -> Result<usize, WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var shadow = window.{shadow_var};
                if (!shadow) {{
                    throw new Error('no such shadow root');
                }}
                var elements = {strategy_js};
                var count = elements.length;
                for (var i = 0; i < count; i++) {{
                    window['{js_var_prefix}' + i] = elements[i];
                }}
                return count;
            }})()"
        );
        let result = self.evaluate_js(&script).await?;
        extract_usize_value(&result)
    }

    // =========================================================================
    // Script Execution
    // =========================================================================

    /// Execute synchronous JavaScript with arguments
    async fn execute_script(
        &self,
        script: &str,
        args: &[Value],
    ) -> Result<Value, WebDriverErrorResponse> {
        let args_json = serde_json::to_string(args)
            .map_err(|e| WebDriverErrorResponse::invalid_argument(&e.to_string()))?;

        // Generate unique result variable name
        let result_var = format!("__wdio_exec_{}", uuid::Uuid::new_v4());

        // Wrapper script that:
        // 1. Executes the user's script as a function body (per W3C WebDriver spec §13.2.2)
        // 2. Stores result in a global variable for polling
        // Note: We use an IIFE that returns `undefined` to avoid Promise serialization issues
        //
        // The script is treated as a function body. Clients that want to return a value must
        // include an explicit `return` statement — this matches WebdriverIO's function-object
        // wrapping (`return (fn).apply(null, arguments)`) and raw string scripts like
        // `"return document.title"`.
        let wrapper = format!(
            r"(function() {{
                var ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

                function serializeValue(value) {{
                    if (value === null || value === undefined) return null;
                    if (typeof value === 'boolean') return value;
                    if (typeof value === 'number') {{
                        if (!isFinite(value)) return null;
                        return value;
                    }}
                    if (typeof value === 'string') return value;
                    if (typeof value === 'function') return null;
                    if (typeof value === 'symbol') return null;
                    if (typeof value === 'bigint') return Number(value);
                    if (Array.isArray(value)) {{
                        return value.map(serializeValue);
                    }}
                    if (typeof value === 'object') {{
                        if (value[ELEMENT_KEY]) return value;
                        if (value && value.nodeType && value.nodeType === 1) return null;
                        var result = {{}};
                        for (var key in value) {{
                            if (value.hasOwnProperty(key)) {{
                                result[key] = serializeValue(value[key]);
                            }}
                        }}
                        return result;
                    }}
                    return null;
                }}

                function deserializeArg(arg) {{
                    if (arg === null || arg === undefined) return arg;
                    if (Array.isArray(arg)) return arg.map(deserializeArg);
                    if (typeof arg === 'object') {{
                        if (arg[ELEMENT_KEY]) {{
                            var el = window['__wd_el_' + arg[ELEMENT_KEY].replace(/-/g, '')];
                            if (!el) throw new Error('stale element reference');
                            return el;
                        }}
                        var result = {{}};
                        for (var key in arg) {{
                            if (arg.hasOwnProperty(key)) result[key] = deserializeArg(arg[key]);
                        }}
                        return result;
                    }}
                    return arg;
                }}

                // Start async execution (fire and forget)
                (async function() {{
                    try {{
                        var args = {args_json}.map(deserializeArg);
                        // W3C-compliant: wrap as function body, apply with args
                        var raw_result = await (async function() {{ {script} }}).apply(null, args);
                        var serialized = serializeValue(raw_result);
                        window['{result_var}'] = {{ __wd_success: true, __wd_value: serialized }};
                    }} catch (e) {{
                        window['{result_var}'] = {{ __wd_success: false, __wd_error: e.message || String(e) }};
                    }}
                }})();

                // Return undefined to avoid Promise serialization issues
                return undefined;
            }})()",
        );

        // Execute the wrapper script (fire and forget, returns undefined)
        self.evaluate_js(&wrapper).await?;

        // Poll for the result with timeout
        let poll_script = format!("window['{}']", result_var);
        let timeout = std::time::Duration::from_millis(self.script_timeout_ms());
        let start = std::time::Instant::now();
        let poll_interval = std::time::Duration::from_millis(50);

        loop {
            let poll_result = self.evaluate_js(&poll_script).await?;
            let inner = poll_result.get("value").cloned().unwrap_or(Value::Null);

            // Check if we have a result
            if !inner.is_null() && inner.get("__wd_success").is_some() {
                // Clean up the global variable
                let cleanup_script = format!("delete window['{}']", result_var);
                let _ = self.evaluate_js(&cleanup_script).await;

                return extract_script_result_from_inner(&inner);
            }

            if start.elapsed() > timeout {
                // Clean up on timeout
                let cleanup_script = format!("delete window['{}']", result_var);
                let _ = self.evaluate_js(&cleanup_script).await;

                return Err(WebDriverErrorResponse::script_timeout());
            }

            tokio::time::sleep(poll_interval).await;
        }
    }

    /// Execute asynchronous JavaScript with callback.
    ///
    /// Each platform must implement this using native message handlers.
    async fn execute_async_script(
        &self,
        script: &str,
        args: &[Value],
    ) -> Result<Value, WebDriverErrorResponse>;

    /// Execute a pre-wrapped async DirectEval script (the `/wdio/eval` channel).
    ///
    /// The script uses the W3C async-callback contract (`arguments[last]` is the done callback).
    /// Defaults to `execute_async_script`; a platform may override to avoid a long-lived native
    /// completion handler (see the macOS executor).
    async fn execute_direct_eval(&self, script: &str) -> Result<Value, WebDriverErrorResponse> {
        self.execute_async_script(script, &[]).await
    }

    // =========================================================================
    // Screenshots
    // =========================================================================

    /// Take screenshot of the page, returns base64-encoded PNG
    async fn take_screenshot(&self) -> Result<String, WebDriverErrorResponse>;

    /// Take screenshot of a specific element, returns base64-encoded PNG
    async fn take_element_screenshot(&self, js_var: &str)
        -> Result<String, WebDriverErrorResponse>;

    // =========================================================================
    // Actions (Keyboard/Pointer)
    // =========================================================================

    /// Dispatch a keyboard event with modifier state
    async fn dispatch_key_event(
        &self,
        key: &str,
        is_down: bool,
        modifiers: &ModifierState,
    ) -> Result<(), WebDriverErrorResponse> {
        match crate::platform::key_input::map_special_key(key) {
            Some((js_key, js_code, key_code)) => {
                let script =
                    crate::platform::key_input::build_special_key_script(js_key, js_code, key_code, is_down);
                self.evaluate_js(&script).await?;
                Ok(())
            }
            None => {
                let code = crate::platform::key_input::regular_key_code_for(key);
                self.dispatch_regular_key(key, &code, is_down, modifiers).await
            }
        }
    }

    /// Dispatch a regular (non-special) key event with modifier state
    async fn dispatch_regular_key(
        &self,
        key: &str,
        code: &str,
        is_down: bool,
        modifiers: &ModifierState,
    ) -> Result<(), WebDriverErrorResponse> {
        let script = crate::platform::key_input::build_regular_key_script(key, code, is_down, modifiers);
        self.evaluate_js(&script).await?;
        Ok(())
    }

    /// Dispatch a pointer/mouse event
    ///
    /// These are synthetic (`isTrusted: false`) like the pre-#612 key path. If a
    /// click-activation-gated web API (popups, clipboard, fullscreen) is ever reported not
    /// working on Windows/WebView2, the remedy is the same as #612: route through CDP
    /// (`Input.dispatchMouseEvent`) so the click is trusted and grants user activation.
    async fn dispatch_pointer_event(
        &self,
        event_type: PointerEventType,
        x: i32,
        y: i32,
        button: u32,
    ) -> Result<(), WebDriverErrorResponse> {
        let event_name = match event_type {
            PointerEventType::Down => "mousedown",
            PointerEventType::Up => "mouseup",
            PointerEventType::Move => "mousemove",
            // Manually dispatched mousedown/mouseup do NOT make the browser
            // synthesize a click, so element click handlers never fire. The
            // actions handler emits this explicitly after a same-spot down+up.
            PointerEventType::Click => "click",
        };

        let buttons = if matches!(event_type, PointerEventType::Down) {
            1 << button
        } else {
            0
        };
        let script = format!(
            r"(function() {{
                var el = document.elementFromPoint({x}, {y});
                if (!el) el = document.body;

                var event = new MouseEvent('{event_name}', {{
                    bubbles: true,
                    cancelable: true,
                    clientX: {x},
                    clientY: {y},
                    button: {button},
                    buttons: {buttons}
                }});
                el.dispatchEvent(event);
                return true;
            }})()"
        );

        self.evaluate_js(&script).await?;
        Ok(())
    }

    /// Dispatch a scroll/wheel event
    async fn dispatch_scroll_event(
        &self,
        x: i32,
        y: i32,
        delta_x: i32,
        delta_y: i32,
    ) -> Result<(), WebDriverErrorResponse> {
        let script = format!(
            r"(function() {{
                var el = document.elementFromPoint({x}, {y});
                if (!el) el = document.body;

                var event = new WheelEvent('wheel', {{
                    bubbles: true,
                    cancelable: true,
                    clientX: {x},
                    clientY: {y},
                    deltaX: {delta_x},
                    deltaY: {delta_y},
                    deltaMode: 0
                }});
                el.dispatchEvent(event);

                window.scrollBy({delta_x}, {delta_y});
                return true;
            }})()"
        );

        self.evaluate_js(&script).await?;
        Ok(())
    }

    // =========================================================================
    // Window Management
    // =========================================================================

    /// Get window rectangle (position and size)
    #[cfg(desktop)]
    async fn get_window_rect(&self) -> Result<WindowRect, WebDriverErrorResponse> {
        let scale_factor = self.window().scale_factor().map_err(|error| {
            WebDriverErrorResponse::unknown_error(&format!(
                "Failed to get window scale factor: {error}"
            ))
        })?;
        let position = self.window().outer_position().map_err(|error| {
            WebDriverErrorResponse::unknown_error(&format!(
                "Failed to get window position: {error}"
            ))
        })?;
        let size = self.window().outer_size().map_err(|error| {
            WebDriverErrorResponse::unknown_error(&format!("Failed to get window size: {error}"))
        })?;

        Ok(physical_window_rect_to_logical(
            position,
            size,
            scale_factor,
        ))
    }

    #[cfg(mobile)]
    async fn get_window_rect(&self) -> Result<WindowRect, WebDriverErrorResponse>;

    /// Set window rectangle (position and size)
    #[cfg(desktop)]
    async fn set_window_rect(
        &self,
        rect: WindowRect,
    ) -> Result<WindowRect, WebDriverErrorResponse> {
        // Exit fullscreen/maximized state before setting rect
        // Otherwise the window manager may ignore our size/position request
        let is_fullscreen = self.window().is_fullscreen().map_err(|error| {
            WebDriverErrorResponse::unknown_error(&format!(
                "Failed to query window fullscreen state: {error}"
            ))
        })?;
        if is_fullscreen {
            apply_window_change(
                self.window(),
                "tauri://resize",
                "exit window fullscreen state",
                || self.window().set_fullscreen(false),
            )
            .await?;
        }
        let is_maximized = self.window().is_maximized().map_err(|error| {
            WebDriverErrorResponse::unknown_error(&format!(
                "Failed to query window maximized state: {error}"
            ))
        })?;
        if is_maximized {
            apply_window_change(
                self.window(),
                "tauri://resize",
                "restore maximized window",
                || self.window().unmaximize(),
            )
            .await?;
        }

        let scale_factor = self.window().scale_factor().map_err(|error| {
            WebDriverErrorResponse::unknown_error(&format!(
                "Failed to get window scale factor: {error}"
            ))
        })?;
        let position = self.window().outer_position().map_err(|error| {
            WebDriverErrorResponse::unknown_error(&format!(
                "Failed to get window position: {error}"
            ))
        })?;
        let outer_size = self.window().outer_size().map_err(|error| {
            WebDriverErrorResponse::unknown_error(&format!(
                "Failed to get outer window size: {error}"
            ))
        })?;
        let inner_size = self.window().inner_size().map_err(|error| {
            WebDriverErrorResponse::unknown_error(&format!(
                "Failed to get inner window size: {error}"
            ))
        })?;

        let current_rect = physical_window_rect_to_logical(position, outer_size, scale_factor);
        let chrome_size = physical_window_chrome_to_logical(outer_size, inner_size, scale_factor);

        if rect.x != current_rect.x || rect.y != current_rect.y {
            apply_window_change(self.window(), "tauri://move", "set window position", || {
                self.window()
                    .set_position(LogicalPosition::new(rect.x, rect.y))
            })
            .await?;
        }

        if rect.width != current_rect.width || rect.height != current_rect.height {
            // Tauri sets the inner size. Chrome is measured in logical pixels before any
            // display move so physical metrics from different scale factors are never mixed.
            let inner_size = LogicalSize::new(
                rect.width.saturating_sub(chrome_size.width),
                rect.height.saturating_sub(chrome_size.height),
            );
            apply_window_change(self.window(), "tauri://resize", "set window size", || {
                self.window().set_size(inner_size)
            })
            .await?;
        }

        self.get_window_rect().await
    }

    /// Maximize window
    #[cfg(desktop)]
    async fn maximize_window(&self) -> Result<WindowRect, WebDriverErrorResponse> {
        apply_window_change(self.window(), "tauri://resize", "maximize window", || {
            self.window().maximize()
        })
        .await?;
        self.get_window_rect().await
    }

    /// Minimize window
    #[cfg(desktop)]
    async fn minimize_window(&self) -> Result<(), WebDriverErrorResponse> {
        let _ = self.window().minimize();
        Ok(())
    }

    /// Set window to fullscreen
    #[cfg(desktop)]
    async fn fullscreen_window(&self) -> Result<WindowRect, WebDriverErrorResponse> {
        apply_window_change(
            self.window(),
            "tauri://resize",
            "enter window fullscreen state",
            || self.window().set_fullscreen(true),
        )
        .await?;
        self.get_window_rect().await
    }

    /// Set window rectangle (mobile unsupported)
    #[cfg(mobile)]
    async fn set_window_rect(
        &self,
        _rect: WindowRect,
    ) -> Result<WindowRect, WebDriverErrorResponse> {
        Err(WebDriverErrorResponse::unsupported_operation(
            "Setting window rect is not supported on mobile platforms",
        ))
    }

    /// Maximize window (mobile unsupported)
    #[cfg(mobile)]
    async fn maximize_window(&self) -> Result<WindowRect, WebDriverErrorResponse> {
        Err(WebDriverErrorResponse::unsupported_operation(
            "Maximizing window is not supported on mobile platforms",
        ))
    }

    /// Minimize window (mobile unsupported)
    #[cfg(mobile)]
    async fn minimize_window(&self) -> Result<(), WebDriverErrorResponse> {
        Err(WebDriverErrorResponse::unsupported_operation(
            "Minimizing window is not supported on mobile platforms",
        ))
    }

    /// Set window to fullscreen (mobile unsupported)
    #[cfg(mobile)]
    async fn fullscreen_window(&self) -> Result<WindowRect, WebDriverErrorResponse> {
        Err(WebDriverErrorResponse::unsupported_operation(
            "Fullscreen window is not supported on mobile platforms",
        ))
    }

    // =========================================================================
    // Frames
    // =========================================================================

    /// Switch to a frame by ID (index or element reference)
    async fn switch_to_frame(&self, id: FrameId) -> Result<(), WebDriverErrorResponse> {
        match id {
            FrameId::Index(index) => {
                let script = format!(
                    r"(function() {{
                        var frames = document.querySelectorAll('iframe, frame');
                        if ({index} >= frames.length) {{
                            return false;
                        }}
                        return true;
                    }})()"
                );
                let result = self.evaluate_js(&script).await?;
                if result.get("value") == Some(&Value::Bool(false)) {
                    return Err(WebDriverErrorResponse::no_such_frame());
                }
                Ok(())
            }
            FrameId::Element(js_var) => {
                let script = format!(
                    r"(function() {{
                        var el = window.{js_var};
                        if (!el || !el.isConnected) {{
                            throw new Error('stale element reference');
                        }}
                        if (el.tagName !== 'IFRAME' && el.tagName !== 'FRAME') {{
                            throw new Error('element is not a frame');
                        }}
                        return true;
                    }})()"
                );
                self.evaluate_js(&script).await?;
                Ok(())
            }
        }
    }

    /// Switch to parent frame
    async fn switch_to_parent_frame(&self) -> Result<(), WebDriverErrorResponse> {
        // No-op - frame context is managed by the session, not the executor
        Ok(())
    }

    // =========================================================================
    // Cookies (using Tauri's native cookie APIs)
    // =========================================================================

    /// Get all cookies
    async fn get_all_cookies(&self) -> Result<Vec<Cookie>, WebDriverErrorResponse> {
        self.window()
            .cookies()
            .map(|cookies| cookies.iter().map(tauri_cookie_to_webdriver).collect())
            .map_err(|e| WebDriverErrorResponse::unknown_error(&e.to_string()))
    }

    /// Get a specific cookie by name
    async fn get_cookie(&self, name: &str) -> Result<Option<Cookie>, WebDriverErrorResponse> {
        let cookies = self.get_all_cookies().await?;
        Ok(cookies.into_iter().find(|c| c.name == name))
    }

    /// Add a cookie
    async fn add_cookie(&self, mut cookie: Cookie) -> Result<(), WebDriverErrorResponse> {
        // Per WebDriver spec: if no domain is specified, use the current page's domain
        if cookie.domain.is_none() {
            if let Ok(url) = self.window().url() {
                cookie.domain = url.host_str().map(String::from);
            }
        }

        // Default path to "/" if not specified
        if cookie.path.is_none() {
            cookie.path = Some("/".to_string());
        }

        let tauri_cookie = webdriver_cookie_to_tauri(&cookie);
        self.window()
            .set_cookie(tauri_cookie)
            .map_err(|e| WebDriverErrorResponse::unknown_error(&e.to_string()))
    }

    /// Delete a cookie by name
    async fn delete_cookie(&self, name: &str) -> Result<(), WebDriverErrorResponse> {
        // Find the cookie first to get its exact domain/path for deletion
        let cookies = self
            .window()
            .cookies()
            .map_err(|e| WebDriverErrorResponse::unknown_error(&e.to_string()))?;

        for cookie in cookies {
            if cookie.name() == name {
                self.window()
                    .delete_cookie(cookie)
                    .map_err(|e| WebDriverErrorResponse::unknown_error(&e.to_string()))?;
                return Ok(());
            }
        }
        Ok(())
    }

    /// Delete all cookies
    async fn delete_all_cookies(&self) -> Result<(), WebDriverErrorResponse> {
        let cookies = self
            .window()
            .cookies()
            .map_err(|e| WebDriverErrorResponse::unknown_error(&e.to_string()))?;

        for cookie in cookies {
            self.window()
                .delete_cookie(cookie)
                .map_err(|e| WebDriverErrorResponse::unknown_error(&e.to_string()))?;
        }
        Ok(())
    }

    // =========================================================================
    // Alerts (using per-window alert state)
    // =========================================================================

    /// Dismiss the current alert (cancel)
    async fn dismiss_alert(&self) -> Result<(), WebDriverErrorResponse> {
        let manager = self.window().app_handle().state::<AlertStateManager>();
        let alert_state = manager.get_or_create(self.window().label());
        if alert_state.respond(false, None) {
            Ok(())
        } else {
            Err(WebDriverErrorResponse::no_such_alert())
        }
    }

    /// Accept the current alert (OK)
    async fn accept_alert(&self) -> Result<(), WebDriverErrorResponse> {
        let manager = self.window().app_handle().state::<AlertStateManager>();
        let alert_state = manager.get_or_create(self.window().label());
        // For prompts, use input text if set, otherwise default text
        let prompt_text = alert_state
            .get_prompt_input()
            .or_else(|| alert_state.get_default_text());
        if alert_state.respond(true, prompt_text) {
            Ok(())
        } else {
            Err(WebDriverErrorResponse::no_such_alert())
        }
    }

    /// Get the text of the current alert
    async fn get_alert_text(&self) -> Result<String, WebDriverErrorResponse> {
        let manager = self.window().app_handle().state::<AlertStateManager>();
        let alert_state = manager.get_or_create(self.window().label());
        match alert_state.get_message() {
            Some(msg) => Ok(msg),
            None => Err(WebDriverErrorResponse::no_such_alert()),
        }
    }

    /// Send text to the current alert (for prompts)
    async fn send_alert_text(&self, text: &str) -> Result<(), WebDriverErrorResponse> {
        let manager = self.window().app_handle().state::<AlertStateManager>();
        let alert_state = manager.get_or_create(self.window().label());
        match alert_state.get_alert_type() {
            None => Err(WebDriverErrorResponse::no_such_alert()),
            Some(AlertType::Prompt) => {
                // Store the text for when acceptAlert is called
                if alert_state.set_prompt_input(text.to_string()) {
                    Ok(())
                } else {
                    Err(WebDriverErrorResponse::no_such_alert())
                }
            }
            Some(_) => Err(WebDriverErrorResponse::element_not_interactable(
                "User prompt is not a prompt dialog",
            )),
        }
    }

    // =========================================================================
    // Print
    // =========================================================================

    /// Print page to PDF, returns base64-encoded PDF
    async fn print_page(&self, options: PrintOptions) -> Result<String, WebDriverErrorResponse>;
}

// =============================================================================
// Helper Functions for Default Implementations
// =============================================================================

/// Extract string value from JavaScript result
fn extract_string_value(result: &Value) -> Result<String, WebDriverErrorResponse> {
    if let Some(success) = result.get("success").and_then(Value::as_bool) {
        if success {
            if let Some(value) = result.get("value") {
                if let Some(s) = value.as_str() {
                    return Ok(s.to_string());
                }
                return Ok(value.to_string());
            }
        } else if let Some(error) = result.get("error").and_then(Value::as_str) {
            return Err(WebDriverErrorResponse::javascript_error(error, None));
        }
    }
    Ok(String::new())
}

/// Extract boolean value from JavaScript result
fn extract_bool_value(result: &Value) -> Result<bool, WebDriverErrorResponse> {
    if let Some(success) = result.get("success").and_then(Value::as_bool) {
        if success {
            if let Some(value) = result.get("value").and_then(Value::as_bool) {
                return Ok(value);
            }
        } else if let Some(error) = result.get("error").and_then(Value::as_str) {
            return Err(WebDriverErrorResponse::javascript_error(error, None));
        }
    }
    Ok(false)
}

/// Extract usize value from JavaScript result
fn extract_usize_value(result: &Value) -> Result<usize, WebDriverErrorResponse> {
    if let Some(success) = result.get("success").and_then(Value::as_bool) {
        if success {
            if let Some(count) = result.get("value").and_then(Value::as_u64) {
                return Ok(usize::try_from(count).unwrap_or(0));
            }
        } else if let Some(error) = result.get("error").and_then(Value::as_str) {
            return Err(WebDriverErrorResponse::javascript_error(error, None));
        }
    }
    Ok(0)
}

/// Extract raw Value from JavaScript result
fn extract_value(result: &Value) -> Result<Value, WebDriverErrorResponse> {
    if let Some(success) = result.get("success").and_then(Value::as_bool) {
        if success {
            return Ok(result.get("value").cloned().unwrap_or(Value::Null));
        } else if let Some(error) = result.get("error").and_then(Value::as_str) {
            return Err(WebDriverErrorResponse::javascript_error(error, None));
        }
    }
    Ok(Value::Null)
}

/// Extract result from inner value (the __wd_success/__wd_value object)
fn extract_script_result_from_inner(inner: &Value) -> Result<Value, WebDriverErrorResponse> {
    // Check the script execution result
    if let Some(success) = inner.get("__wd_success").and_then(Value::as_bool) {
        if success {
            return Ok(inner.get("__wd_value").cloned().unwrap_or(Value::Null));
        } else if let Some(error) = inner.get("__wd_error").and_then(Value::as_str) {
            return Err(WebDriverErrorResponse::javascript_error(error, None));
        }
    }

    // If we got null or no wrapper structure, it's likely a syntax error
    if inner.is_null() || inner.get("__wd_success").is_none() {
        return Err(WebDriverErrorResponse::javascript_error(
            "Script execution failed (possible syntax error)",
            None,
        ));
    }

    Ok(Value::Null)
}

/// Wrap a JavaScript script to execute within a specific frame context.
/// If `frame_context` is empty (top-level), returns the script unchanged.
/// Otherwise, wraps the script to navigate to the correct frame before execution.
pub fn wrap_script_for_frame_context(script: &str, frame_context: &[FrameId]) -> String {
    use std::fmt::Write;

    if frame_context.is_empty() {
        return script.to_string();
    }

    // Build JavaScript to navigate to the target frame
    let mut frame_nav = String::new();
    frame_nav.push_str("(function() {\n");
    frame_nav.push_str("  var ctx = window;\n");
    frame_nav.push_str("  var doc = document;\n");

    for (i, frame_id) in frame_context.iter().enumerate() {
        match frame_id {
            FrameId::Index(index) => {
                let _ = writeln!(
                    frame_nav,
                    "  var frames{i} = doc.querySelectorAll('iframe, frame');"
                );
                let _ = writeln!(
                    frame_nav,
                    "  if ({index} >= frames{i}.length) throw new Error('no such frame');"
                );
                let _ = writeln!(frame_nav, "  var frame{i} = frames{i}[{index}];");
                let _ = writeln!(
                    frame_nav,
                    "  if (!frame{i}.contentWindow) throw new Error('no such frame');"
                );
                let _ = writeln!(frame_nav, "  ctx = frame{i}.contentWindow;");
                let _ = writeln!(frame_nav, "  doc = frame{i}.contentDocument;");
            }
            FrameId::Element(js_var) => {
                let _ = writeln!(frame_nav, "  var frame{i} = window.{js_var};");
                let _ = writeln!(
                    frame_nav,
                    "  if (!frame{i} || !doc.contains(frame{i})) throw new Error('stale element reference');"
                );
                let _ = writeln!(
                    frame_nav,
                    "  if (frame{i}.tagName !== 'IFRAME' && frame{i}.tagName !== 'FRAME') throw new Error('element is not a frame');"
                );
                let _ = writeln!(
                    frame_nav,
                    "  if (!frame{i}.contentWindow) throw new Error('no such frame');"
                );
                let _ = writeln!(frame_nav, "  ctx = frame{i}.contentWindow;");
                let _ = writeln!(frame_nav, "  doc = frame{i}.contentDocument;");
            }
        }
    }

    // Execute the original script in the frame context
    // We use Function constructor to evaluate in the frame's context
    let escaped_script = script
        .replace('\\', "\\\\")
        .replace('`', "\\`")
        .replace("${", "\\${");

    let _ = writeln!(frame_nav, "  return ctx.eval(`{escaped_script}`);");
    frame_nav.push_str("})()");

    frame_nav
}

// =============================================================================
// Cookie Conversion Functions
// =============================================================================

/// Convert Tauri cookie to `WebDriver` cookie
fn tauri_cookie_to_webdriver(cookie: &TauriCookie<'static>) -> Cookie {
    use tauri::webview::cookie::{Expiration, SameSite};

    Cookie {
        name: cookie.name().to_string(),
        value: cookie.value().to_string(),
        path: cookie.path().map(String::from),
        domain: cookie.domain().map(String::from),
        secure: cookie.secure().unwrap_or(false),
        http_only: cookie.http_only().unwrap_or(false),
        expiry: cookie.expires().and_then(|exp| match exp {
            Expiration::DateTime(dt) => u64::try_from(dt.unix_timestamp()).ok(),
            Expiration::Session => None,
        }),
        same_site: cookie.same_site().map(|ss| match ss {
            SameSite::Strict => "Strict".to_string(),
            SameSite::Lax => "Lax".to_string(),
            SameSite::None => "None".to_string(),
        }),
    }
}

/// Convert `WebDriver` cookie to Tauri cookie
fn webdriver_cookie_to_tauri(cookie: &Cookie) -> TauriCookie<'static> {
    use tauri::webview::cookie::{time::OffsetDateTime, Expiration, SameSite};

    let mut builder = TauriCookie::build((cookie.name.clone(), cookie.value.clone()));

    if let Some(ref path) = cookie.path {
        builder = builder.path(path.clone());
    }

    if let Some(ref domain) = cookie.domain {
        builder = builder.domain(domain.clone());
    }

    // SECURITY: Always set Secure attribute for all cookies.
    // This WebDriver implementation supports cookie testing per the WebDriver specification.
    builder = builder.secure(true);

    if cookie.http_only {
        builder = builder.http_only(true);
    }

    if let Some(expiry) = cookie.expiry {
        if let Some(dt) = i64::try_from(expiry)
            .ok()
            .and_then(|expiry| OffsetDateTime::from_unix_timestamp(expiry).ok())
        {
            builder = builder.expires(Expiration::DateTime(dt));
        }
    }

    if let Some(ref same_site) = cookie.same_site {
        let ss = match same_site.to_lowercase().as_str() {
            "strict" => SameSite::Strict,
            "lax" => SameSite::Lax,
            _ => SameSite::None,
        };
        builder = builder.same_site(ss);
    }

    builder.build()
}
