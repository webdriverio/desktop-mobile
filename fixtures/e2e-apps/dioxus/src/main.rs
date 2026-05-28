#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use dioxus::prelude::*;
use serde_json::json;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into())
                .add_directive("wdio_dioxus_bridge=debug".parse().unwrap())
                .add_directive("wdio_dioxus_embedded_driver=debug".parse().unwrap()),
        )
        .init();

    let mut config = dioxus::desktop::Config::new();

    #[cfg(debug_assertions)]
    {
        // Under WDIO automation on macOS, disable WKWebView background
        // throttling so the embedded driver's polling loop survives spec
        // boundaries on headless CI hosts. Requires patched dioxus-desktop
        // (see Cargo.toml `[patch.crates-io]`) until upstream PR lands.
        if wdio_dioxus_embedded_driver::automation::is_requested() {
            config = config.with_background_throttling(
                dioxus::desktop::wry::BackgroundThrottlingPolicy::Disabled,
            );
        }
        config = wdio_dioxus_embedded_driver::install_with_commands(config, |registry| {
            registry.register("get_platform_info", |_args| {
                Ok(json!({
                    "os": std::env::consts::OS,
                    "arch": std::env::consts::ARCH,
                }))
            });
            registry.register("get_command_line_args", |_args| {
                let args: Vec<String> = std::env::args().skip(1).collect();
                Ok(json!(args))
            });
            registry.register("generate_test_logs", |_args| {
                tracing::error!("[WDIO:Backend] test-error-log");
                tracing::warn!("[WDIO:Backend] test-warn-log");
                tracing::info!("[WDIO:Backend] test-info-log");
                Ok(json!(null))
            });
        });
    }

    dioxus::LaunchBuilder::desktop()
        .with_cfg(config)
        .launch(App);
}

#[component]
fn App() -> Element {
    let mut count = use_signal(|| 0i32);
    let mut status = use_signal(|| String::from("ready"));

    rsx! {
        head {
            title { "WDIO Dioxus E2E App" }
            style { {SHARED_STYLES} }
        }
        div { class: "container",
            h1 { id: "app-title", "WDIO Dioxus E2E Test App" }
            div { class: "counter-section",
                div { id: "counter", "{count}" }
                button {
                    id: "increment-button",
                    onclick: move |_| { count += 1; *status.write() = "incremented".into(); },
                    "Increment"
                }
                button {
                    id: "decrement-button",
                    onclick: move |_| { count -= 1; *status.write() = "decremented".into(); },
                    "Decrement"
                }
                button {
                    id: "reset-button",
                    onclick: move |_| { count.set(0); *status.write() = "reset".into(); },
                    "Reset"
                }
            }
            div { class: "info-section",
                div { id: "status", "{status}" }
            }
        }
    }
}

const SHARED_STYLES: &str = r#"
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    margin: 0;
    padding: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}
.container {
    background: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(15px);
    border-radius: 25px;
    padding: 50px;
    text-align: center;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.25);
    max-width: 800px;
    width: 100%;
}
h1 {
    margin: 0 0 25px 0;
    font-size: 3em;
    font-weight: 200;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
}
button {
    background: rgba(255, 255, 255, 0.25);
    border: 2px solid rgba(255, 255, 255, 0.4);
    color: white;
    padding: 15px 20px;
    border-radius: 12px;
    cursor: pointer;
    font-size: 1em;
    font-weight: 500;
    transition: all 0.3s ease;
    backdrop-filter: blur(5px);
    margin: 8px;
}
button:hover {
    background: rgba(255, 255, 255, 0.35);
    transform: translateY(-3px);
    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
}
.counter-section {
    margin: 2rem 0;
}
#counter {
    font-size: 4em;
    font-weight: bold;
    margin: 1rem 0;
    color: #61dafb;
}
.info-section {
    margin-top: 40px;
    padding: 25px;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 15px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 0.95em;
    line-height: 1.5;
    border: 1px solid rgba(255, 255, 255, 0.1);
}
#status {
    margin-top: 1rem;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    display: inline-block;
}
"#;
