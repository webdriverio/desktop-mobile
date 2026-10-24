use tauri::{command, Manager, Runtime, WebviewWindow, Listener};
use serde_json::Value as JsonValue;
use uuid::Uuid;
use tokio::sync::oneshot;

use crate::models::ExecuteRequest;
use crate::Result;

/// Window state information for generic window management
/// Mirrors Electron's window tracking - discover active window without app-specific knowledge
#[derive(serde::Serialize, Debug, Clone)]
pub struct WindowState {
  pub label: String,
  pub title: String,
  pub is_visible: bool,
  pub is_focused: bool,
}

/// Debug command to verify plugin is working
#[command]
pub(crate) async fn debug_plugin<R: Runtime>(_window: WebviewWindow<R>) -> String {
    eprintln!("[WDIO-Rust] DEBUG PLUGIN CALLED!");
    "Plugin alive".to_string()
}

/// Log a frontend message to stderr (for standalone mode capture)
/// This bypasses the event system and writes directly to stderr
#[command]
pub(crate) async fn log_frontend<R: Runtime>(
    _window: WebviewWindow<R>,
    message: String,
    level: String,
) -> Result<String> {
    // Output with a special marker that the log parser recognizes as frontend
    // Format: [WDIO-FRONTEND][LEVEL] message
    eprintln!("[WDIO-FRONTEND][{}] {}", level.to_uppercase(), message);

    // Return success indicator
    Ok(format!("logged: {} @ {}", level, message))
}

/// Execute JavaScript code in the frontend context
/// This command is called via invoke from the frontend plugin
/// It extracts the script from the request, evaluates it, and returns the result
#[command]
pub(crate) async fn execute<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: WebviewWindow<R>,
    request: ExecuteRequest,
) -> Result<JsonValue> {
    log::debug!("Execute command called");
    log::trace!("Script length: {} chars", request.script.len());

    // Determine which window to use for execution
    let target_window = if let Some(ref label) = request.window_label {
        log::debug!("Target window label specified: {}", label);
        match app.webview_windows().get(label) {
            Some(w) => w.clone(),
            None => {
                log::error!("Window with label '{}' not found", label);
                return Err(crate::Error::ExecuteError(format!(
                    "Window with label '{}' not found. Available windows: {:?}",
                    label,
                    app.webview_windows().keys().collect::<Vec<_>>()
                )));
            }
        }
    } else {
        log::debug!("No window label specified, using current window");
        window
    };

    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    // Use tokio's async oneshot channel for async waiting
    // Wrap sender in Arc<Mutex<Option>> so the Fn closure can take it once
    let (tx, rx) = tokio::sync::oneshot::channel::<crate::Result<JsonValue>>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    // Build the script with args if offered.
    // Callable scripts receive Tauri APIs + user args.
    // Statement/expression scripts run as body code (with args exposed as __wdio_args).
    let trimmed = request.script.trim();
    let has_keyword_prefix = |source: &str, keyword: &str| {
        source
            .strip_prefix(keyword)
            .and_then(|rest| rest.chars().next())
            .map(|ch| ch.is_whitespace() || ch == '(')
            .unwrap_or(false)
    };

    // Check if => appears outside of string literals (to avoid false positives like "foo"=>"bar")
    // All characters of interest ('\'', '"', '`', '\\', '=', '>') are ASCII (< 0x80)
        // and cannot be continuation bytes in multi-byte UTF-8 sequences, so byte-level
        // scanning is correct and avoids the char_indices/chars().nth() index mismatch.
        fn contains_arrow_outside_quotes(s: &str) -> bool {
            let bytes = s.as_bytes();
            let mut in_single_quote = false;
            let mut in_double_quote = false;
            let mut in_backtick = false;
            let mut backslash_count: usize = 0;
            let mut i = 0;
            while i < bytes.len() {
                let b = bytes[i];
                if b == b'\\' {
                    backslash_count += 1;
                    i += 1;
                    continue;
                }
                let escaped = backslash_count % 2 == 1;
                backslash_count = 0;
                if !escaped {
                    match b {
                        b'\'' if !in_double_quote && !in_backtick => in_single_quote = !in_single_quote,
                        b'"' if !in_single_quote && !in_backtick => in_double_quote = !in_double_quote,
                        b'`' if !in_single_quote && !in_double_quote => in_backtick = !in_backtick,
                        b'='
                            if !in_single_quote
                                && !in_double_quote
                                && !in_backtick
                                && i + 1 < bytes.len()
                                && bytes[i + 1] == b'>' =>
                        {
                            return true;
                        }
                        _ => {}
                    }
                }
                i += 1;
            }
            false
        }

        // Like contains_arrow_outside_quotes but also tracks bracket depth.
        // Returns true only if => appears at depth 0 (outside all parens/brackets).
        // Prevents false positives on (arr.find(x => x)) where => is nested inside
        // the outer parentheses.
        fn has_arrow_outside_parens(s: &str) -> bool {
            let bytes = s.as_bytes();
            let mut in_single_quote = false;
            let mut in_double_quote = false;
            let mut in_backtick = false;
            let mut depth: i32 = 0;
            let mut backslash_count: usize = 0;
            let mut i = 0;
            while i < bytes.len() {
                let b = bytes[i];
                if b == b'\\' {
                    backslash_count += 1;
                    i += 1;
                    continue;
                }
                let escaped = backslash_count % 2 == 1;
                backslash_count = 0;
                if !escaped {
                    match b {
                        b'\'' if !in_double_quote && !in_backtick => in_single_quote = !in_single_quote,
                        b'"' if !in_single_quote && !in_backtick => in_double_quote = !in_double_quote,
                        b'`' if !in_single_quote && !in_double_quote => in_backtick = !in_backtick,
                        _ if !in_single_quote && !in_double_quote && !in_backtick => match b {
                            b'(' | b'[' => depth += 1,
                            b')' | b']' => depth -= 1,
                            b'=' if depth == 0 && i + 1 < bytes.len() && bytes[i + 1] == b'>' => {
                                return true;
                            }
                            _ => {}
                        },
                        _ => {}
                    }
                }
                i += 1;
            }
            false
        }

        // Returns true if s contains ';' outside string literals at bracket depth 0.
        // Uses a stack-based tracker for template literals so that nested template
        // expressions like `${`inner; value`}` do not produce false positives.
        fn has_semicolon_outside_quotes(s: &str) -> bool {
            struct TmplFrame { in_str: bool, expr_depth: i32 }
            let bytes = s.as_bytes();
            let mut depth: i32 = 0;
            let mut in_single_quote = false;
            let mut in_double_quote = false;
            let mut tmpl: Vec<TmplFrame> = Vec::new();
            let mut i = 0;
            while i < bytes.len() {
                let b = bytes[i];
                let top_in_str = tmpl.last().is_some_and(|f| f.in_str);

                // Escape: skip next byte when inside a string or template string chars.
                if b == b'\\' && (in_single_quote || in_double_quote || top_in_str) {
                    i += 2;
                    continue;
                }

                // Inside template string chars: only backtick and ${ are significant.
                if top_in_str {
                    if b == b'`' {
                        tmpl.pop();
                    } else if b == b'$' && i + 1 < bytes.len() && bytes[i + 1] == b'{' {
                        i += 1; // consume the {
                        depth += 1;
                        if let Some(frame) = tmpl.last_mut() {
                            frame.in_str = false;
                            frame.expr_depth = depth;
                        }
                    }
                    i += 1;
                    continue;
                }

                if b == b'\'' && !in_double_quote {
                    in_single_quote = !in_single_quote;
                    i += 1;
                    continue;
                }
                if b == b'"' && !in_single_quote {
                    in_double_quote = !in_double_quote;
                    i += 1;
                    continue;
                }
                if in_single_quote || in_double_quote {
                    i += 1;
                    continue;
                }

                // Start a new template literal.
                if b == b'`' {
                    tmpl.push(TmplFrame { in_str: true, expr_depth: 0 });
                    i += 1;
                    continue;
                }

                match b {
                    b'(' | b'[' | b'{' => depth += 1,
                    b')' | b']' | b'}' => {
                        depth -= 1;
                        // Check if this } closes a template expression.
                        if let Some(frame) = tmpl.last_mut() {
                            if !frame.in_str && depth == frame.expr_depth - 1 {
                                frame.in_str = true;
                            }
                        }
                    }
                    b';' if depth == 0 => return true,
                    _ => {}
                }
                i += 1;
            }
            false
        }

    // Check for arrow functions at START of script:
    // - "(args) => ..." (parenthesized params)
    // - "param => ..." (single param, alphanumeric start)
    // Only detect arrows that are NOT inside string literals
    let starts_with_paren_arrow = trimmed.starts_with('(') && has_arrow_outside_parens(trimmed);
    let single_param_arrow = trimmed.starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_')
        && contains_arrow_outside_quotes(trimmed)
        && trimmed.find("=>").map(|pos| {
            let before = trimmed[..pos].trim();
            // Single param: no spaces and no parens before =>
            // Parens before => mean the arrow is inside a nested expression, not a top-level arrow
            // e.g. "x => x + 1" is a param arrow; "obj.fn(x => x)" is not
            !before.is_empty() && !before.contains(' ') && !before.contains('(')
        }).unwrap_or(false);
    // Only detect function-like patterns: function, async, arrow functions, or pre-packaged
    // async IIFEs emitted by guest-js (both branches produce "(async ...)" patterns).
    // Don't use starts_with('(') alone as it catches any parenthesized expression like (document.title).
    let is_function = has_keyword_prefix(trimmed, "function")
        || has_keyword_prefix(trimmed, "function*")
        || has_keyword_prefix(trimmed, "async")
        || starts_with_paren_arrow
        || single_param_arrow
        || trimmed.starts_with("(async");

    let script = if is_function {
        // Callable/pre-packaged script — pass through as-is.
        // guest-js wraps both function-like and plain-string cases into async IIFEs before
        // invoking this command, so no further wrapping is needed here.
        request.script.clone()
    } else if !request.args.is_empty() {
        // String script with args (not a callable function) - return error
        return Err(crate::Error::ExecuteError(
            "browser.execute(string, args) is not supported. Use browser.execute(function, ...args) instead.".to_string(),
        ));
    } else {
        // Statement/expression-style script - wrap in block-body IIFE
        let t = request.script.trim_start();
        let has_statement = t.starts_with("const ")
        || t.starts_with("let ")
        || t.starts_with("var ")
        || t.starts_with("if ")
        || t.starts_with("if(")
        || t.starts_with("for ")
        || t.starts_with("for(")
        || t.starts_with("while ")
        || t.starts_with("while(")
        || t.starts_with("switch ")
        || t.starts_with("switch(")
        || t.starts_with("throw ")
        || t.starts_with("throw(")
        || t.starts_with("try ")
        || t.starts_with("try{")
        || t.starts_with("do ")
        || t.starts_with("do{")
        || has_semicolon_outside_quotes(t);
        let has_return = {
            if let Some(rest) = t.strip_prefix("return") {
                rest.is_empty() || !rest.starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_' || c == '$')
            } else {
                false
            }
        };
        let body = if !has_statement && !has_return {
            // Pure expression - add return so it evaluates and returns
            format!("return {};", request.script)
        } else {
            // Has statements or already has return - pass through as-is
            request.script.clone()
        };

        format!("(async () => {{ {body} }})()")
    };

    // Generate unique event ID for this execution
    let event_id = format!("wdio-result-{}", Uuid::new_v4());
    log::trace!("Generated event_id for result: {}", event_id);

    // Helper function to handle events
    fn handle_event(event: tauri::Event, tx: Arc<Mutex<Option<oneshot::Sender<crate::Result<JsonValue>>>>>) {
        log::trace!("Received result event payload: {}", event.payload());

        // Take the sender from the Option (only the first call will succeed)
        let tx = match tx.lock().ok().and_then(|mut guard| guard.take()) {
            Some(tx) => tx,
            None => {
                log::warn!("Event received but sender already taken, ignoring");
                return;
            }
        };

        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            if let Some(success) = payload.get("success").and_then(|s| s.as_bool()) {
                if success {
                    let is_undefined = payload.get("__wdio_undefined__").and_then(|v| v.as_bool()).unwrap_or(false);
                    let value: JsonValue = if is_undefined {
                        serde_json::json!({"__wdio_undefined__": true})
                    } else {
                        payload.get("value").unwrap_or(&JsonValue::Null).clone()
                    };
                    let _ = tx.send(Ok(value));
                } else {
                    let error_msg = payload.get("error")
                        .and_then(|e| e.as_str())
                        .unwrap_or("Unknown error")
                        .to_string();
                    let _ = tx.send(Err(crate::Error::ExecuteError(error_msg)));
                }
            }
        }
    }

    // Listen for the result event on the app target.
    // guest-js uses emit() from @tauri-apps/api/event which targets the app scope.
    let tx_clone: Arc<Mutex<Option<oneshot::Sender<crate::Result<JsonValue>>>>> = Arc::clone(&tx);

    let listener_id = app.listen(&event_id, move |event| {
        log::trace!("Received result event: {}", event.payload());
        handle_event(event, tx_clone.clone());
    });

    // Wrap the script to:
    // 1. Wait for Tauri core.invoke to be available (handles race condition)
    // 2. Execute the user's script
    // 3. Emit the result via a Tauri event using the current window's emit
    //
    // NOTE: We use window.__wdio_original_core__ and window.__wdio_original_tauri__ (set by
    // the @wdio/tauri-plugin frontend before any Proxy interception) rather than accessing
    // window.__TAURI__ directly. On macOS/WKWebView the plugin may replace window.__TAURI__
    // with a Proxy; reading non-configurable/non-writable own properties through that Proxy
    // triggers a JavaScript invariant violation. The snapshots are plain objects and are safe.
    let script_with_result = format!(
        r#"
        (async () => {{
            // Helper: emit a result event via the snapshotted original tauri or dynamic import
            async function __wdio_emit(eventName, payload) {{
                const origTauri = window.__wdio_original_tauri__;
                if (origTauri?.event?.emit) {{
                    await origTauri.event.emit(eventName, payload);
                }} else {{
                    const {{ emit }} = await import('@tauri-apps/api/event');
                    await emit(eventName, payload);
                }}
            }}

            try {{
                // Wait for core.invoke using the snapshotted original core (avoids Proxy issues)
                const maxWait = 5000;
                const startTime = Date.now();
                while (!window.__wdio_original_core__?.invoke && (Date.now() - startTime) < maxWait) {{
                    await new Promise(r => setTimeout(r, 10));
                }}
                if (!window.__wdio_original_core__?.invoke) {{
                    throw new Error('Tauri core.invoke not available after timeout');
                }}

                // Execute the user's script (already wrapped in both branches)
                // Both with-args and no-args paths return a complete async IIFE
                const __wdio_script = ({});
                const result = await __wdio_script;

                if (result === undefined) {{
                    await __wdio_emit('{}', {{ success: true, __wdio_undefined__: true }});
                }} else {{
                    await __wdio_emit('{}', {{ success: true, value: result }});
                }}
            }} catch (error) {{
                try {{
                    await __wdio_emit('{}', {{ success: false, error: error.message || String(error) }});
                }} catch (emitError) {{
                    console.error('[WDIO Execute] Failed to emit error:', emitError);
                }}
            }}
        }})();
        "#,
        script, event_id, event_id, event_id
    );

    log::trace!("Executing script via window.eval()");

    // Evaluate the script in the target window
    if let Err(e) = target_window.eval(&script_with_result) {
        log::error!("Failed to eval script: {}", e);
        app.unlisten(listener_id);
        return Err(crate::Error::ExecuteError(format!("Failed to eval script: {}", e)));
    }

    log::trace!("Waiting for execute result (30s timeout)");

    // Wait for the result event with 30s timeout using async
    // This allows the async runtime to process other tasks (like IPC) while waiting
    // This matches the WebDriver default script timeout
    let window_label = target_window.label().to_owned();
    let timeout_duration = Duration::from_secs(30);

    match tokio::time::timeout(timeout_duration, rx).await {
        Ok(Ok(Ok(result))) => {
            log::debug!("Execute completed successfully");
            log::trace!("Result: {:?}", result);
            app.unlisten(listener_id);
            Ok(result)
        }
        Ok(Ok(Err(e))) => {
            log::error!("JS error during execution: {}", e);
            app.unlisten(listener_id);
            Err(e)
        }
        Ok(Err(_)) => {
            // Channel closed without sending (shouldn't happen)
            log::error!("Channel closed unexpectedly. Event ID: {}. Window: {}", event_id, window_label);
            app.unlisten(listener_id);
            Err(crate::Error::ExecuteError(format!(
                "Channel closed unexpectedly. Event ID: {}. Window: {}",
                event_id, window_label
            )))
        }
        Err(_) => {
            log::error!("Timeout waiting for execute result after 30s. Event ID: {}. Window: {}",
                event_id, window_label);
            app.unlisten(listener_id);
            Err(crate::Error::ExecuteError(format!(
                "Script execution timed out after 30s. Event ID: {}. Window: {}",
                event_id, window_label
            )))
        }
    }
}

/// Get the label of the window that invoked this command
#[command]
pub(crate) async fn get_active_window_label<R: Runtime>(
  window: WebviewWindow<R>,
) -> Result<String> {
  Ok(window.label().to_string())
}

/// List all window labels in the application
#[command]
pub(crate) async fn list_windows<R: Runtime>(
  app: tauri::AppHandle<R>,
) -> Result<Vec<String>> {
  Ok(app.webview_windows().keys().cloned().collect())
}

/// Get detailed state of all windows (for generic window management like Electron)
#[command]
pub(crate) async fn get_window_states<R: Runtime>(
  app: tauri::AppHandle<R>,
) -> Result<Vec<WindowState>> {
  let mut states = Vec::new();

  for (label, window) in app.webview_windows() {
    let state = WindowState {
      label: label.clone(),
      title: window.title().unwrap_or_default(),
      is_visible: window.is_visible().unwrap_or(false),
      is_focused: window.is_focused().unwrap_or(false),
    };
    log::debug!("[get_window_states] {}: title='{}', visible={}, focused={}",
      label, state.title, state.is_visible, state.is_focused);
    states.push(state);
  }

  Ok(states)
}
