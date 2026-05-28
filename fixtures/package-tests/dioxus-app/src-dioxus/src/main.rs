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
            registry.register("generate_test_logs", |_args| {
                tracing::error!("[WDIO:Backend] pkg-test-error-log");
                tracing::warn!("[WDIO:Backend] pkg-test-warn-log");
                tracing::info!("[WDIO:Backend] pkg-test-info-log");
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
    rsx! {
        head {
            title { "WDIO Dioxus Package Test App" }
            style { {SHARED_STYLES} }
        }
        div { class: "container",
            h1 { id: "app-title", "WDIO Dioxus Package Test App" }
            div { class: "info-section",
                div { id: "status", "ready" }
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
