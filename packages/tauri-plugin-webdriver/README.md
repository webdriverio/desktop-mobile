# tauri-plugin-wdio-webdriver

[![Crates.io](https://img.shields.io/crates/v/tauri-plugin-wdio-webdriver.svg)](https://crates.io/crates/tauri-plugin-wdio-webdriver)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An embedded W3C WebDriver server for Tauri applications, providing the **embedded** driver provider for `@wdio/tauri-service`. This plugin embeds a WebDriver HTTP server directly inside your Tauri app, eliminating the need for external drivers like `tauri-driver` or CrabNebula.

This is a fork of [`Choochmeque/tauri-plugin-webdriver`](https://github.com/Choochmeque/tauri-plugin-webdriver) with changes for WebdriverIO compatibility.

## When to Use This Plugin

This plugin is required when using the `'embedded'` driver provider with `@wdio/tauri-service`:

- **macOS** — auto-detected, no configuration needed
- **Windows/Linux** — set `driverProvider: 'embedded'` or `TAURI_WEBDRIVER_PORT` env var

It is **not needed** if you use the `'official'` or `'crabnebula'` driver providers.

## Features

- **Full W3C WebDriver compliance** — 47 endpoints implementing the W3C WebDriver specification
- **Native platform integration** — Uses native WebView APIs (WKWebView, WebView2, WebKitGTK)
- **Zero configuration** — Add the plugin, and `@wdio/tauri-service` handles the rest
- **No external drivers** — No need to install `tauri-driver`, `msedgedriver`, or `webkit2gtk-driver`
- **Child webview handles on macOS** — Tauri child `Webview` labels are exposed as standard WebDriver window handles by the embedded provider. This requires Tauri's `unstable` feature because Tauri currently gates its managed-webview registry behind that feature.

### Supported Platforms

| Platform | Status | Backend |
|----------|--------|---------|
| macOS | Full support | WKWebView native APIs |
| Windows | Full support | WebView2 native APIs |
| Linux | Full support | WebKitGTK native APIs |

## Installation

> **Warning**: This plugin exposes automation capabilities via HTTP. Never include it in production builds.

Add to your `Cargo.toml` as a dev/test-only dependency:

```toml
[target.'cfg(debug_assertions)'.dependencies]
tauri-plugin-wdio-webdriver = "1"
```

Or use a feature flag for more control:

```toml
[features]
webdriver = ["tauri-plugin-wdio-webdriver"]

[dependencies]
tauri-plugin-wdio-webdriver = { version = "1", optional = true }
```

## Usage with @wdio/tauri-service

### 1. Register the plugin

Use conditional compilation to exclude from release builds:

```rust
fn main() {
    let builder = tauri::Builder::default();

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 2. Configure WebdriverIO

```typescript
// wdio.conf.ts
export const config = {
  services: [['@wdio/tauri-service', {
    driverProvider: 'embedded',  // Auto-detected on macOS
  }]],

  capabilities: [{
    browserName: 'tauri',
    'tauri:options': {
      application: './src-tauri/target/release/my-app',
    },
  }],
};
```

The service spawns your Tauri app with `TAURI_WEBDRIVER_PORT` set, the plugin starts the WebDriver server on that port, and WebdriverIO connects directly — no external driver process needed.

### 3. Add permissions

Add to your `src-tauri/capabilities/default.json`:

```json
{
  "permissions": [
    "wdio-webdriver:default"
  ]
}
```

## Standalone Usage

The plugin also works with any W3C WebDriver client independently of `@wdio/tauri-service`:

```bash
# Start your app with the WebDriver port configured
TAURI_WEBDRIVER_PORT=4445 cargo tauri dev
```

Then connect with any client:

```javascript
// WebdriverIO
const browser = await remote({
    hostname: '127.0.0.1',
    port: 4445,
    capabilities: {}
});
```

```python
# Selenium
driver = webdriver.Remote(
    command_executor="http://127.0.0.1:4445",
    options=webdriver.ChromeOptions()
)
```

## Configuration

The WebDriver server runs on port `4445` by default, bound to `127.0.0.1`.

### Custom Port

**1. Environment variable** (used by `@wdio/tauri-service` automatically):

```bash
TAURI_WEBDRIVER_PORT=9515 cargo tauri dev
```

**2. Programmatically:**

```rust
#[cfg(debug_assertions)]
let builder = builder.plugin(tauri_plugin_wdio_webdriver::init_with_port(9515));
```

Port resolution order:
1. `init_with_port(port)` — uses the specified port (ignores env var)
2. `init()` — checks `TAURI_WEBDRIVER_PORT` env var, falls back to 4445

## Child WebViews

Child webview runtime support is currently limited to macOS and the embedded driver provider. WebDriver handles identify webviews, so multiple child handles can share one native host window. Page, element, script, screenshot, cookie, and print commands target the selected webview. Rectangle commands target child bounds, while maximize, minimize, fullscreen, focus, and visibility commands affect the shared native host window.

A primary webview uses the same label as its host window. Child webviews must use labels distinct from their host. Primary rectangle commands target the native outer window; child rectangle commands target child bounds.

`closeWindow` closes only a standalone primary webview whose host contains no sibling webviews. It returns `unsupported operation` for child and shared-host primary webviews so it cannot destroy sibling browsing contexts. Applications should remove child webviews through their own lifecycle command.

An explicit standard `switchToWindow` selection is preserved. Automatic focus recovery does not override it, and internal recovery switches are not recorded as explicit user selection.

## W3C WebDriver Endpoints

### Session Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/status` | Server status |
| POST | `/session` | Create session |
| DELETE | `/session/{id}` | Delete session |

### Timeouts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/session/{id}/timeouts` | Get timeouts |
| POST | `/session/{id}/timeouts` | Set timeouts |

### Navigation
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/session/{id}/url` | Get current URL |
| POST | `/session/{id}/url` | Navigate to URL |
| GET | `/session/{id}/title` | Get page title |
| POST | `/session/{id}/back` | Go back |
| POST | `/session/{id}/forward` | Go forward |
| POST | `/session/{id}/refresh` | Refresh page |

### Elements
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/session/{id}/element` | Find element |
| POST | `/session/{id}/elements` | Find elements |
| GET | `/session/{id}/element/active` | Get active element |
| POST | `/session/{id}/element/{eid}/element` | Find from element |
| POST | `/session/{id}/element/{eid}/elements` | Find all from element |
| POST | `/session/{id}/element/{eid}/click` | Click element |
| POST | `/session/{id}/element/{eid}/clear` | Clear element |
| POST | `/session/{id}/element/{eid}/value` | Send keys |
| GET | `/session/{id}/element/{eid}/text` | Get text |
| GET | `/session/{id}/element/{eid}/name` | Get tag name |
| GET | `/session/{id}/element/{eid}/attribute/{name}` | Get attribute |
| GET | `/session/{id}/element/{eid}/property/{name}` | Get property |
| GET | `/session/{id}/element/{eid}/css/{prop}` | Get CSS value |
| GET | `/session/{id}/element/{eid}/rect` | Get rect |
| GET | `/session/{id}/element/{eid}/selected` | Is selected |
| GET | `/session/{id}/element/{eid}/displayed` | Is displayed |
| GET | `/session/{id}/element/{eid}/enabled` | Is enabled |
| GET | `/session/{id}/element/{eid}/computedrole` | Get ARIA role |
| GET | `/session/{id}/element/{eid}/computedlabel` | Get ARIA label |
| GET | `/session/{id}/element/{eid}/screenshot` | Element screenshot |

### Shadow DOM
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/session/{id}/element/{eid}/shadow` | Get shadow root |
| POST | `/session/{id}/shadow/{sid}/element` | Find in shadow |
| POST | `/session/{id}/shadow/{sid}/elements` | Find all in shadow |

### Windows
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/session/{id}/window` | Get window handle |
| POST | `/session/{id}/window` | Switch to window |
| DELETE | `/session/{id}/window` | Close window |
| POST | `/session/{id}/window/new` | New window |
| GET | `/session/{id}/window/handles` | Get all handles |
| GET | `/session/{id}/window/rect` | Get window rect |
| POST | `/session/{id}/window/rect` | Set window rect |
| POST | `/session/{id}/window/maximize` | Maximize |
| POST | `/session/{id}/window/minimize` | Minimize |
| POST | `/session/{id}/window/fullscreen` | Fullscreen |

### Frames
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/session/{id}/frame` | Switch to frame |
| POST | `/session/{id}/frame/parent` | Switch to parent |

### Scripts
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/session/{id}/execute/sync` | Execute sync script |
| POST | `/session/{id}/execute/async` | Execute async script |

### Cookies
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/session/{id}/cookie` | Get all cookies |
| POST | `/session/{id}/cookie` | Add cookie |
| DELETE | `/session/{id}/cookie` | Delete all cookies |
| GET | `/session/{id}/cookie/{name}` | Get cookie |
| DELETE | `/session/{id}/cookie/{name}` | Delete cookie |

### Alerts
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/session/{id}/alert/dismiss` | Dismiss alert |
| POST | `/session/{id}/alert/accept` | Accept alert |
| GET | `/session/{id}/alert/text` | Get alert text |
| POST | `/session/{id}/alert/text` | Send alert text |

### Actions
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/session/{id}/actions` | Perform actions |
| DELETE | `/session/{id}/actions` | Release actions |

### Document
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/session/{id}/source` | Get page source |
| GET | `/session/{id}/screenshot` | Take screenshot |
| POST | `/session/{id}/print` | Print to PDF |

## Locator Strategies

| Strategy | Example |
|----------|---------|
| `css selector` | `#id`, `.class`, `div > p` |
| `xpath` | `//div[@id='test']` |
| `tag name` | `button`, `input` |
| `link text` | Exact link text match |
| `partial link text` | Partial link text match |

## See Also

- [Plugin Setup Guide](../tauri-service/docs/plugin-setup.md) — Full setup instructions including this plugin
- [Platform Support](../tauri-service/docs/platform-support.md) — Per-platform details
- [Upstream repository](https://github.com/Choochmeque/tauri-plugin-webdriver) — Original project

## License

MIT
