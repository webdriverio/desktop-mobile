# wdio-dioxus-embedded-driver

In-process WebDriver server for [Dioxus](https://dioxuslabs.com/) desktop applications. Installing it also installs [`wdio-dioxus-bridge`](../dioxus-bridge/).

> Apps should add [`wdio-dioxus`](../dioxus-wdio/) instead, which installs this server. Calling this crate's `install()` directly still works.

## What Is It?

`wdio-dioxus-embedded-driver` is a Rust crate that implements a W3C WebDriver HTTP server that runs **inside your Dioxus application process**. `wdio_dioxus_embedded_driver::install(config)` installs the bridge and starts this server, which listens for WebDriver connections from `@wdio/dioxus-service`.

This is the WebDriver server `@wdio/dioxus-service` connects to. It lives inside the app itself, so there's no driver to install.

## Quick Start

```toml
# Cargo.toml
[dependencies]
wdio-dioxus-embedded-driver = "1"
```

Wire into `main.rs`, guarded for debug builds so the driver never ships in release binaries:

```rust,ignore
fn main() {
    let mut config = dioxus::desktop::Config::new();

    #[cfg(debug_assertions)]
    {
        config = wdio_dioxus_embedded_driver::install(config);
    }

    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}
```

Call `install()` last in your `Config` builder chain so later calls don't shadow the bridge's `with_on_window` hook. To register custom commands for `browser.dioxus.execute()`, use `install_with_commands(config, |registry| { ... })` instead.

Build the app with `dx build --desktop` rather than `cargo build`, so the files it loads with `asset!()` are bundled. See the [App Setup guide](../dioxus-service/docs/app-setup.md) for the full instructions.

## How It Works

1. `@wdio/dioxus-service` launches your debug Dioxus binary with environment variables:
   - `DIOXUS_WEBVIEW_AUTOMATION=true`
   - `WDIO_EMBEDDED_PORT=<port>` (default 4444, unique per capability)

2. `wdio_dioxus_embedded_driver::install(config)` installs the bridge and starts the HTTP server on `127.0.0.1` at the port in `WDIO_EMBEDDED_PORT` (4444 if unset). It does this on every debug launch, whether or not the service is driving the app.

3. `@wdio/dioxus-service` polls the `/status` endpoint until the server is ready, then establishes a WebDriver session.

4. WebDriver commands are routed to the webview through the bridge's IPC channel: the injected guest-js polls for script execution requests, runs them, and posts the results back.

## Platform Support

The embedded driver works on all three platforms:

| Platform | Status |
| -------- | ------ |
| Windows  | ✅     |
| Linux    | ✅     |
| macOS    | ✅     |

## Limitations

Page and element screenshots fail with `unsupported operation`, so `takeScreenshot()`, `saveScreenshot()` and the visual service throw rather than get a blank image. Native screenshots are tracked in [#741](https://github.com/webdriverio/desktop-mobile/issues/741). On Windows and Linux, the external driver provider (`driverProvider: 'external'`) supports screenshots.

## Configuration

Port is controlled via `@wdio/dioxus-service`:

```typescript
// wdio.conf.ts
services: [
  [
    '@wdio/dioxus-service',
    {
      embeddedPort: 4445, // Optional, defaults to 4444
    },
  ],
];
```

Or via environment variable:
```bash
WDIO_EMBEDDED_PORT=4445 npx wdio run wdio.conf.ts
```

## Keyboard Events

Keyboard events carry the `key`, `code`, `keyCode` and `shiftKey` a browser sends on a US keyboard: `a` is `code: 'KeyA'`, `keyCode: 65`, `A` is the same key with `shiftKey: true`, and `!` is `code: 'Digit1'`, `keyCode: 49` with `shiftKey: true`. A character with no key on a US keyboard gets `code: ''` and `keyCode: 0`. A newline is the Enter key, a tab the Tab key and a backspace character the Backspace key, and a carriage return is skipped, so a `\r\n` line ending presses Enter once. In key actions, chromedriver sends a newline, a tab and a backspace character with the same `key` but an empty `code`.

Key events go to the focused element, even one inside an open shadow root. Unless a `keydown` handler cancels it, a key types its character into a text field or contenteditable, Backspace and Delete delete in a text field, Control+A or Meta+A selects all, and the arrow keys check the next or previous radio button in a group. With Control, Alt or Meta held, a key types nothing. A read-only or disabled field keeps its value. Edits in a text field fire `input` but no `beforeinput`. [#927](https://github.com/webdriverio/desktop-mobile/issues/927) lists where typing still differs from Chrome, such as not deleting in a contenteditable and no `change` on blur.

Key actions (`browser.keys()`) send keyboard events for every key but a carriage return. Element Send Keys (`setValue()`, `addValue()`) types plain text without them, so `keydown` handlers don't see it. It does send them for special keys, newlines and backspace characters, and for text typed while Control, Alt or Meta is held, so `addValue('x' + Key.Enter)` types `x`, then presses Enter. Element Send Keys types only into a text field or contenteditable, and refuses a file input.

Unless a `keydown` handler cancels it, Enter acts as in Chrome, on the element focused after the `keydown`:
- In a textarea or contenteditable, it breaks the line.
- In an input, it fires any `change` that Element Send Keys left pending, then submits the input's form:
  - From a text, search, URL, telephone, email, password or number input, it clicks the form's first submit button, unless that button is disabled. A form without a submit button is submitted if it has no other input of those types.
  - From any other input, such as a checkbox or a date input, it clicks the form's first enabled submit button.
- On a button (a `<button>`, or a submit, image, reset or button input), it clicks the button.

Element Send Keys sets a date, time or range input's value without pressing any keys, so in those inputs only key actions press Enter.

Space on a focused button clicks it on the `keyup`, as in Chrome. It doesn't click if a handler cancels the `keydown` or the `keyup`, or if focus moves between them.

Each click is a single `click` event, without pointer or mouse events. A `submit` that no handler cancels navigates the page.

Unlike in Chrome, Enter and Space send only their key events in these cases:
- Enter on a link, a `<summary>`, a colour or file input or a `<select>`.
- Space on a checkbox, a radio button, a `<summary>`, a colour or file input or a `<select>`.
- Either key with Control, Alt or Meta held.

The driver also sends no `keypress` events, so a `keypress` handler can't cancel a key's default action.

Unless a `keydown` handler cancels it, Tab in a key action moves focus to the next element, and Shift+Tab to the previous one, in Chrome's order: elements with a positive `tabindex`, lowest first, then in tree order those with `tabindex="0"` and those focusable by default, such as links, buttons and form fields. Tab skips disabled, `inert` and hidden elements, and everything outside an open modal `<dialog>`. It goes through open shadow roots and slots, and stops once on a radio group: on its checked radio, or if Tab can't stop on one, on the first radio it reaches. It starts from the element focused after the `keydown`, and from an element it skips, such as one with `tabindex="-1"`, it goes to the nearest stop in tree order. Past the last element or before the first, focus leaves the page, as Chrome hands it to the browser's own controls, and the next Tab or Shift+Tab comes back in at the start or the end.

Tab selects the value of a text, search, URL, telephone, email, password or number input it moves to. The field focus leaves fires any `change` that Element Send Keys left pending.

Unlike in Chrome, Tab:
- Skips the contents of a closed shadow root, which the driver can't reach, and stops on its host only if the host takes focus itself.
- Stops once on an iframe, or on an audio or video element's controls, and doesn't move inside them.
- Doesn't stop on a scrolling box with nothing focusable inside it, or on an image map's areas.
- Starts from the focused element, never from where a click on text landed.
- Sends only its key events with Control, Alt or Meta held. Chrome on macOS moves focus with Alt held.

One difference from the W3C key tables: `\uE007` (WebdriverIO's `Key.Enter`) sends `code: 'Enter'`, and `\uE006` (Return) sends `code: 'NumpadEnter'`. The W3C tables assign them the other way round, but clients send `\uE007` for the Enter key, so a handler that checks `code === 'Enter'` matches it.

## See Also

- [`wdio-dioxus-bridge`](../dioxus-bridge/) — the IPC bridge this crate installs
- [`@wdio/dioxus-service`](../dioxus-service/) — the WebdriverIO service
- [App Setup](../dioxus-service/docs/app-setup.md) — how to integrate the driver into your Dioxus app
