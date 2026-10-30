# tauri-plugin-wdio-webdriver

[![Crates.io](https://img.shields.io/crates/v/tauri-plugin-wdio-webdriver.svg)](https://crates.io/crates/tauri-plugin-wdio-webdriver)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An embedded W3C WebDriver server for Tauri applications, providing the **embedded** driver provider for `@wdio/tauri-service`. This plugin embeds a WebDriver HTTP server directly inside your Tauri app, eliminating the need for external drivers like `tauri-driver` or CrabNebula.

This is a fork of [`Choochmeque/tauri-plugin-webdriver`](https://github.com/Choochmeque/tauri-plugin-webdriver) with changes for WebdriverIO compatibility.

## When to Use This Plugin

This plugin is required when using the `'embedded'` driver provider with `@wdio/tauri-service`:
- **macOS** — auto-detected, no configuration needed
- **Windows/Linux** — set `driverProvider: 'embedded'` or `TAURI_WEBDRIVER_PORT` env var

It is **not needed** if you use the `'external'` or `'crabnebula'` driver providers.

## Features

- **Full W3C WebDriver compliance** — 47 endpoints implementing the W3C WebDriver specification
- **Native platform integration** — Uses native WebView APIs (WKWebView, WebView2, WebKitGTK)
- **Zero configuration** — Add the plugin, and `@wdio/tauri-service` handles the rest
- **No external drivers** — No need to install `tauri-driver`, `msedgedriver`, or `WebKitWebDriver`

### Supported Platforms

| Platform | Status       | Backend               |
| -------- | ------------ | --------------------- |
| macOS    | Full support | WKWebView native APIs |
| Windows  | Full support | WebView2 native APIs  |
| Linux    | Full support | WebKitGTK native APIs |

Android and iOS are not supported. The plugin still builds for them, so an app that also targets mobile compiles, but on mobile it does nothing.

## Installation

> **Warning**: This plugin exposes automation capabilities via HTTP. Never register it in production builds.

Add it to your `Cargo.toml`:

```toml
[dependencies]
tauri-plugin-wdio-webdriver = "1"
```

The registration below only runs in debug builds, so release builds never start the server. To leave the crate out of release builds entirely, use a feature flag, and gate the registration on `#[cfg(feature = "webdriver")]` instead:

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
  services: [
    [
      '@wdio/tauri-service',
      {
        driverProvider: 'embedded', // The default, so this line is optional
      },
    ],
  ],

  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: './src-tauri/target/debug/my-app',
      },
    },
  ],
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
  capabilities: {},
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

## W3C WebDriver Endpoints

### Session Management

| Method | Endpoint        | Description    |
| ------ | --------------- | -------------- |
| GET    | `/status`       | Server status  |
| POST   | `/session`      | Create session |
| DELETE | `/session/{id}` | Delete session |

### Timeouts

| Method | Endpoint                 | Description  |
| ------ | ------------------------ | ------------ |
| GET    | `/session/{id}/timeouts` | Get timeouts |
| POST   | `/session/{id}/timeouts` | Set timeouts |

### Navigation

| Method | Endpoint                | Description     |
| ------ | ----------------------- | --------------- |
| GET    | `/session/{id}/url`     | Get current URL |
| POST   | `/session/{id}/url`     | Navigate to URL |
| GET    | `/session/{id}/title`   | Get page title  |
| POST   | `/session/{id}/back`    | Go back         |
| POST   | `/session/{id}/forward` | Go forward      |
| POST   | `/session/{id}/refresh` | Refresh page    |

### Elements

| Method | Endpoint                                       | Description           |
| ------ | ---------------------------------------------- | --------------------- |
| POST   | `/session/{id}/element`                        | Find element          |
| POST   | `/session/{id}/elements`                       | Find elements         |
| GET    | `/session/{id}/element/active`                 | Get active element    |
| POST   | `/session/{id}/element/{eid}/element`          | Find from element     |
| POST   | `/session/{id}/element/{eid}/elements`         | Find all from element |
| POST   | `/session/{id}/element/{eid}/click`            | Click element         |
| POST   | `/session/{id}/element/{eid}/clear`            | Clear element         |
| POST   | `/session/{id}/element/{eid}/value`            | Send keys             |
| GET    | `/session/{id}/element/{eid}/text`             | Get text              |
| GET    | `/session/{id}/element/{eid}/name`             | Get tag name          |
| GET    | `/session/{id}/element/{eid}/attribute/{name}` | Get attribute         |
| GET    | `/session/{id}/element/{eid}/property/{name}`  | Get property          |
| GET    | `/session/{id}/element/{eid}/css/{prop}`       | Get CSS value         |
| GET    | `/session/{id}/element/{eid}/rect`             | Get rect              |
| GET    | `/session/{id}/element/{eid}/selected`         | Is selected           |
| GET    | `/session/{id}/element/{eid}/displayed`        | Is displayed          |
| GET    | `/session/{id}/element/{eid}/enabled`          | Is enabled            |
| GET    | `/session/{id}/element/{eid}/computedrole`     | Get ARIA role         |
| GET    | `/session/{id}/element/{eid}/computedlabel`    | Get ARIA label        |
| GET    | `/session/{id}/element/{eid}/screenshot`       | Element screenshot    |

### Shadow DOM

| Method | Endpoint                              | Description        |
| ------ | ------------------------------------- | ------------------ |
| GET    | `/session/{id}/element/{eid}/shadow`  | Get shadow root    |
| POST   | `/session/{id}/shadow/{sid}/element`  | Find in shadow     |
| POST   | `/session/{id}/shadow/{sid}/elements` | Find all in shadow |

### Windows

| Method | Endpoint                          | Description       |
| ------ | --------------------------------- | ----------------- |
| GET    | `/session/{id}/window`            | Get window handle |
| POST   | `/session/{id}/window`            | Switch to window  |
| DELETE | `/session/{id}/window`            | Close window      |
| POST   | `/session/{id}/window/new`        | New window        |
| GET    | `/session/{id}/window/handles`    | Get all handles   |
| GET    | `/session/{id}/window/rect`       | Get window rect   |
| POST   | `/session/{id}/window/rect`       | Set window rect   |
| POST   | `/session/{id}/window/maximize`   | Maximize          |
| POST   | `/session/{id}/window/minimize`   | Minimize          |
| POST   | `/session/{id}/window/fullscreen` | Fullscreen        |

`Get Window Rect` and `Set Window Rect` use CSS pixels, as required by the
[W3C WebDriver Window Rect commands](https://www.w3.org/TR/webdriver2/#set-window-rect).
The plugin converts Tauri's physical outer-window bounds
using the window's current display scale factor. Position changes are completed
before a requested size is applied, including moves between displays.

### Frames

| Method | Endpoint                     | Description      |
| ------ | ---------------------------- | ---------------- |
| POST   | `/session/{id}/frame`        | Switch to frame  |
| POST   | `/session/{id}/frame/parent` | Switch to parent |

### Scripts

| Method | Endpoint                      | Description          |
| ------ | ----------------------------- | -------------------- |
| POST   | `/session/{id}/execute/sync`  | Execute sync script  |
| POST   | `/session/{id}/execute/async` | Execute async script |

### Cookies

| Method | Endpoint                      | Description        |
| ------ | ----------------------------- | ------------------ |
| GET    | `/session/{id}/cookie`        | Get all cookies    |
| POST   | `/session/{id}/cookie`        | Add cookie         |
| DELETE | `/session/{id}/cookie`        | Delete all cookies |
| GET    | `/session/{id}/cookie/{name}` | Get cookie         |
| DELETE | `/session/{id}/cookie/{name}` | Delete cookie      |

### Alerts

| Method | Endpoint                      | Description     |
| ------ | ----------------------------- | --------------- |
| POST   | `/session/{id}/alert/dismiss` | Dismiss alert   |
| POST   | `/session/{id}/alert/accept`  | Accept alert    |
| GET    | `/session/{id}/alert/text`    | Get alert text  |
| POST   | `/session/{id}/alert/text`    | Send alert text |

### Actions

| Method | Endpoint                | Description     |
| ------ | ----------------------- | --------------- |
| POST   | `/session/{id}/actions` | Perform actions |
| DELETE | `/session/{id}/actions` | Release actions |

### Document

| Method | Endpoint                   | Description     |
| ------ | -------------------------- | --------------- |
| GET    | `/session/{id}/source`     | Get page source |
| GET    | `/session/{id}/screenshot` | Take screenshot |
| POST   | `/session/{id}/print`      | Print to PDF    |

## Locator Strategies

| Strategy            | Example                    |
| ------------------- | -------------------------- |
| `css selector`      | `#id`, `.class`, `div > p` |
| `xpath`             | `//div[@id='test']`        |
| `tag name`          | `button`, `input`          |
| `link text`         | Exact link text match      |
| `partial link text` | Partial link text match    |

## Keyboard Events

Keyboard events carry the `key`, `code`, `keyCode` and `shiftKey` a browser sends on a US keyboard: `a` is `code: 'KeyA'`, `keyCode: 65`, `A` is the same key with `shiftKey: true`, and `!` is `code: 'Digit1'`, `keyCode: 49` with `shiftKey: true`. A character with no key on a US keyboard gets `code: ''` and `keyCode: 0`. A newline is the Enter key and a backspace character the Backspace key, as in chromedriver, which skips a carriage return, so a `\r\n` line ending presses Enter once. A tab is typed as a character, with the Tab key's `code` and `keyCode`, because the Tab key doesn't move focus in this driver yet ([#889](https://github.com/webdriverio/desktop-mobile/issues/889)).

Key actions (`browser.keys()`) send keyboard events for every key but a carriage return. Element Send Keys (`setValue()`, `addValue()`) types plain text without them, so `keydown` handlers don't see it; it sends them for special keys, newlines and backspace characters, and for text typed while Control, Alt or Meta is held.

Unless a `keydown` handler cancels it, Enter acts as it does in Chrome. It breaks the line in a textarea or contenteditable. In an input, it fires the `change` the field owes, then submits the input's form. From a text, search, URL, telephone, email, password or number input, it clicks the form's first submit button, unless that button is disabled, or in a form without one, submits the form if it has no other input of those types. From any other input, such as a checkbox or a date input, it clicks the form's first enabled submit button. Element Send Keys sets a date, time or range input's value without pressing any keys, so in those inputs only key actions (`browser.keys()`) press Enter. The click is a single `click` event, without pointer or mouse events, and a `submit` that no handler cancels navigates the page. Unlike in Chrome, Enter on a button, a colour or file input or a `<select>`, or with Control, Alt or Meta held, sends only its key events, and as the driver sends no `keypress` events, a `keypress` handler can't cancel Enter.

One difference from the W3C key tables: `\uE007` (WebdriverIO's `Key.Enter`) sends `code: 'Enter'`, and `\uE006` (Return) sends `code: 'NumpadEnter'`. The tables assign them the other way round, but clients send `\uE007` for the Enter key, so a handler that checks `code === 'Enter'` matches it.

## See Also

- [Plugin Setup Guide](../tauri-service/docs/plugin-setup.md) — Full setup instructions including this plugin
- [Choosing a Driver Provider](../tauri-service/docs/configuration.md#choosing-a-driver-provider) — When to use the embedded provider
- [Upstream repository](https://github.com/Choochmeque/tauri-plugin-webdriver) — Original project

## License

MIT
