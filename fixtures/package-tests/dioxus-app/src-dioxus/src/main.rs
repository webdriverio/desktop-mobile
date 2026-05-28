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
        }
        h1 { id: "app-title", "WDIO Dioxus Package Test App" }
        div { id: "status", "ready" }
    }
}
