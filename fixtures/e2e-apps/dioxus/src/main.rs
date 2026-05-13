#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use dioxus::prelude::*;
use serde_json::json;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("wdio_dioxus_bridge=debug".parse().unwrap())
                .add_directive("wdio_dioxus_embedded_driver=debug".parse().unwrap()),
        )
        .init();

    let mut config = dioxus::desktop::Config::new();

    #[cfg(debug_assertions)]
    {
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
            style { "body {{ font-family: sans-serif; padding: 20px; }}" }
        }
        h1 { id: "app-title", "WDIO Dioxus E2E Test App" }
        div { id: "counter", "{count}" }
        div { id: "status", "{status}" }
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
}
