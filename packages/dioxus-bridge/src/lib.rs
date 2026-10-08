//! Internal crate used by [`wdio-dioxus-embedded-driver`] to connect a Dioxus
//! desktop app to [`@wdio/dioxus-service`]. It provides the `wdio://` IPC
//! channel ([`invoke`]), log forwarding ([`log_bridge`]), the window registry
//! behind `listWindows` / `switchWindow` ([`window_state`]), automation
//! detection ([`automation`]) and a deeplink helper ([`deeplink`]).
//!
//! [`install`] registers each window from a [`Config::with_on_window`]
//! callback. Dioxus keeps only one, so a later `with_on_window` call replaces
//! the bridge's; an app that needs its own callback must call
//! [`window_state::register_window`] from it.
//!
//! [`@wdio/dioxus-service`]: https://www.npmjs.com/package/@wdio/dioxus-service
//! [`wdio-dioxus-embedded-driver`]: https://docs.rs/wdio-dioxus-embedded-driver

pub mod automation;
pub mod deeplink;
pub mod embedded;
pub mod invoke;
pub mod log_bridge;
pub mod window_state;

use dioxus_desktop::Config;
use serde_json::{json, Value};

pub use invoke::CommandRegistry;
pub use log_bridge::FRONTEND_MARKER;

/// Mirrors `wdio_dioxus_embedded_driver::PORT_ENV_VAR`, which this crate can't
/// import: the embedded driver depends on the bridge.
const EMBEDDED_PORT_ENV_VAR: &str = "WDIO_EMBEDDED_PORT";

/// The guest-js bundle, embedded by `build.rs` from `dist-js/index.js`. It's
/// committed so crates.io and git builds have it; rebuild it with
/// `pnpm --filter @wdio/dioxus-bridge build` after editing `guest-js/`.
const GUEST_JS_BUNDLE: &str = include_str!(concat!(env!("OUT_DIR"), "/guest_js_bundle.js"));

/// Installs the bridge into a Dioxus [`Config`]: registers the `wdio://`
/// protocol, the built-in commands and the window hook, and injects the
/// guest-js bundle into the page `<head>` so `window.__WDIO_DIOXUS__.invoke`
/// exists before app code runs.
pub fn install(config: Config) -> Config {
  install_with_registry(config, CommandRegistry::new())
}

/// Variant of [`install`] that accepts a pre-populated [`CommandRegistry`].
/// Use this when the app needs custom commands beyond the built-ins.
pub fn install_with_registry(config: Config, registry: CommandRegistry) -> Config {
  install_with_registry_and_config(config, registry, None)
}

/// Variant of [`install`] for `wdio-dioxus-embedded-driver`: also registers
/// the commands its guest-js polling loop uses, and starts that loop.
pub fn install_with_embedded_port(config: Config, port: u16) -> Config {
  embedded::init();
  install_with_registry_and_config(config, CommandRegistry::new(), Some(port))
}

/// Like [`install_with_embedded_port`] but accepts a pre-populated
/// [`CommandRegistry`] so the app can add custom bridge commands alongside
/// the embedded-driver infrastructure.
pub fn install_with_embedded_port_and_registry(config: Config, registry: CommandRegistry, port: u16) -> Config {
  embedded::init();
  install_with_registry_and_config(config, registry, Some(port))
}

fn install_with_registry_and_config(
  config: Config,
  registry: CommandRegistry,
  embedded_port: Option<u16>,
) -> Config {
  automation::report();
  if embedded_port.is_none() && std::env::var_os(EMBEDDED_PORT_ENV_VAR).is_some() {
    tracing::warn!(
      target: "wdio_dioxus_bridge",
      "{EMBEDDED_PORT_ENV_VAR} is set, so @wdio/dioxus-service is waiting for an embedded WebDriver \
       server, but none was started. Add wdio-dioxus with its default features and call \
       wdio_dioxus::install(config)."
    );
  }
  log_bridge::register(&registry);
  register_window_commands(&registry);
  if embedded_port.is_some() {
    register_embedded_commands(&registry);
  }

  let registry_for_handler = registry;

  // On Windows, Wry serves custom protocols as `http://{scheme}.*`, and
  // WebView2 rejects a `fetch('wdio://invoke')`, so guest-js reads the URL
  // from `window.__WDIO_BRIDGE_URL__`.
  let bridge_url = if cfg!(target_os = "windows") {
    "http://wdio.invoke/"
  } else {
    "wdio://invoke"
  };

  // If the embedded driver is active, inject the port signal before the
  // module script so the polling loop starts up automatically.
  let head = match embedded_port {
    Some(port) => format!(
      "<script>window.__WDIO_BRIDGE_URL__={bridge_url:?};window.__WDIO_EMBEDDED_PORT={port};</script><script type=\"module\">{GUEST_JS_BUNDLE}</script>"
    ),
    None => format!(
      "<script>window.__WDIO_BRIDGE_URL__={bridge_url:?};</script><script type=\"module\">{GUEST_JS_BUNDLE}</script>"
    ),
  };

  config
    .with_custom_protocol("wdio".to_string(), move |_webview_id, request| {
      invoke::handle_invoke_request(&registry_for_handler, &request)
    })
    .with_custom_head(head)
    .with_on_window(|window, _dom| {
      let label = window_state::register_window(&window);
      tracing::debug!(label = %label, "wdio-dioxus-bridge: registered window");
    })
}

fn register_window_commands(registry: &CommandRegistry) {
  registry.register("__list_windows", |_args| Ok(json!(window_state::list_labels())));
  registry.register("__active_window", |_args| {
    Ok(json!(window_state::get_active_label()))
  });
  registry.register("__window_states", |_args| {
    Ok(json!(window_state::get_window_states()))
  });
}

fn register_embedded_commands(registry: &CommandRegistry) {
  // Non-blocking: returns the next pending eval request, or null.
  registry.register("__embedded_poll", |_args| {
    match embedded::poll_next() {
      Some((id, script, args)) => Ok(json!({ "id": id, "script": script, "args": args })),
      None => Ok(Value::Null),
    }
  });

  // Hands a polled request's result back to the waiting WebDriver handler.
  registry.register("__embedded_result", |args| {
    let id = args["id"].as_str().ok_or("missing id")?.to_string();
    let result = match args["error"].as_str() {
      Some(err) => Err(err.to_string()),
      None => Ok(args["result"].clone()),
    };
    embedded::resolve(&id, result);
    Ok(Value::Null)
  });
}
