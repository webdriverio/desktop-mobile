# Migration Guide: v1 → v2

What changes when you upgrade from v1 to v2, and what to do about it.

v2 covers `@wdio/dioxus-service`, `@wdio/dioxus-bridge` and the `wdio-dioxus`, `wdio-dioxus-bridge` and `wdio-dioxus-embedded-driver` crates. Most of the behaviour changes are in the embedded driver, and bring it closer to Chrome through chromedriver.

## What's New in v2

For the full list of changes, see the [v2.0.0 release notes](../release-notes/v2.0.0.md). New features, such as support for WebdriverIO v10 and `mock.withImplementation()`, are additive. The sections below cover what you may have to change.

## Breaking Changes

### Requirements

#### WebdriverIO v9 and v10

v2 supports WebdriverIO v9 and v10, from 9.33.0 and 10.2.0 (`^9.33.0 || ^10.2.0`), the first releases with the Node.js floors below. If you move to v10 at the same time, follow WebdriverIO's [v9 → v10 migration guide](https://webdriver.io/docs/v10-migration) for the changes in your own tests, such as strict `$`, the removed `multiremotebrowser` global and `executeAsync`, and Mocha 12.

#### Node.js

v2 needs Node.js 22 (22.23.4+), 24 (24.22.1+) or 26 (26.12.1+). Node.js 23.x and 25.x aren't supported. Older versions trust the compromised eMudhra intermediate CAs. This applies to both npm packages, `@wdio/dioxus-bridge` included.

#### WebdriverIO packages are optional peers

`webdriverio` and `@wdio/types` are now optional peers, where the service used to bring its own copies. They need WebdriverIO 9.33.0+ or 10.2.0+.

- **Testrunner mode:** nothing new to install. `@wdio/cli` and `@wdio/local-runner` provide them, and the service uses those copies.
- **Standalone mode** (no testrunner): install `webdriverio` next to the service. The service's own dependencies used to bring it.
- **pnpm with hoisting turned off, or Yarn Plug'n'Play:** these don't let a package see what it hasn't declared, so list `webdriverio`, `@wdio/types` and `@wdio/globals` as direct dependencies, even in testrunner mode.

They're optional rather than required because npm and pnpm install a missing required peer at the newest version in range, so a project even one release behind got a second copy of each package.

#### Linux display

On WebdriverIO v10, WebdriverIO starts a display server itself, Weston if it's installed and Xvfb otherwise, so no `xvfb-run` wrapper is needed. The service is tested on both and needs no setting. An app with X11-only dependencies sets `displayServer: 'xvfb'`. Local runs on a Linux desktop now show the app instead of a hidden Xvfb. On WebdriverIO v9, keep wrapping the run in `xvfb-run`. See [Linux Without a Display](../quick-start.md#linux-without-a-display).

### Rust crates

#### Update the crates together

`wdio-dioxus`, `wdio-dioxus-bridge` and `wdio-dioxus-embedded-driver` 2.0 require 2.x of each other: the embedded driver calls bridge code that 1.x doesn't have. Update all of them, and `@wdio/dioxus-service`, at once.

**Before (v1):**

```toml
[dependencies]
wdio-dioxus = "1"
```

**After (v2):**

```toml
[dependencies]
wdio-dioxus = "2"
```

`wdio-dioxus` brings the bridge and the embedded driver, so apps that depend on it need no other entry. If your app depends on `wdio-dioxus-embedded-driver` or `wdio-dioxus-bridge` directly, raise those to `"2"` too, or replace them with `wdio-dioxus = "2"`. Then run `cargo update` so the lockfile holds no 1.x copy.

#### `with-bridge` feature removed

`wdio-dioxus-bridge`'s `with-bridge` feature is gone. It never did anything. A manifest that enables it fails to resolve until you delete the entry.

**Before (v1):**

```toml
[dependencies.wdio-dioxus-bridge]
version = "1"
features = ["with-bridge"]
```

**After (v2):**

```toml
[dependencies.wdio-dioxus-bridge]
version = "2"
```

#### Apps with their own window callback

On Windows, the embedded driver needs WebView2's focus emulation (see [Focus on Windows](#focus-on-windows)), which the bridge turns on from its `with_on_window` callback. Dioxus keeps one callback, so an app that sets its own replaces the bridge's. If yours calls `window_state::register_window` from it, call `wdio_dioxus::on_window` instead, or `wdio_dioxus_bridge::on_window` if you don't use `wdio-dioxus`. Otherwise the app gets no focus emulation.

**Before (v1):**

```rust
config = config.with_on_window(|window, _dom| {
    #[cfg(debug_assertions)]
    wdio_dioxus_bridge::window_state::register_window(&window);
});
```

**After (v2):**

```rust
config = config.with_on_window(|window, dom| {
    #[cfg(debug_assertions)]
    wdio_dioxus::on_window(&window, dom);
});
```

Apps that already call `wdio_dioxus::on_window` need no change. See [Apps With Their Own Window Callback](../app-setup.md#apps-with-their-own-window-callback).

#### `ActionState::pressed_keys` is a method

In `wdio-dioxus-embedded-driver`'s Rust API, `ActionState::pressed_keys` is a method that returns the held keys in press order, where it was a public `HashSet` field. `press_key` and `release_key` change them. Apps that only call `install` don't notice.

**Before (v1):**

```rust
let held = &state.pressed_keys;
```

**After (v2):**

```rust
let held: Vec<&String> = state.pressed_keys().collect();
```

### Configuration and options

#### `commandTimeout` and `rootDir` removed

`commandTimeout` is removed. It never took effect. To bound each WebDriver request, set WebdriverIO's `connectionRetryTimeout`. `rootDir` is removed from the service options too: it did nothing.

**Before (v1):**

```ts
services: [['@wdio/dioxus-service', { commandTimeout: 60_000, rootDir: './app' }]],
```

**After (v2):**

```ts
connectionRetryTimeout: 60_000,
services: [['@wdio/dioxus-service', {}]],
```

#### `'dioxus:options'.args` replaces `appArgs`

`'dioxus:options'.args` now reaches the app, and replaces `appArgs` for that capability. The two lists don't merge, so `args: []` launches the app with no arguments. If a capability sets `args`, make it the app's full argument list, or remove it to use `appArgs`.

`'dioxus:options'.webviewOptions` never had an effect, and no longer type-checks. Delete it.

**Before (v1):**

```ts
'dioxus:options': {
  application: './target/debug/my_app',
  args: ['--debug'],
  webviewOptions: { width: 1280, height: 720 },
},
```

**After (v2):**

```ts
'dioxus:options': {
  application: './target/debug/my_app',
  args: ['--debug'], // now passed to the app, in place of appArgs
},
```

See [`dioxus:options` Fields](../configuration.md#dioxusoptions-fields).

#### `driverProvider` per capability

`driverProvider` set in a capability's `wdio:dioxusServiceOptions` now applies to that capability. A run fails at startup if any capability sets `'external'`, or inherits a service-level `'external'` without overriding it. Before, `'external'` on a later capability started the embedded driver. `'external'` isn't available yet ([#713](https://github.com/webdriverio/desktop-mobile/issues/713)), so remove the setting or set `'embedded'`. A value other than `'embedded'` or `'external'` also stops the run, with `driverProvider must be 'embedded' or 'external', not "<value>".`

#### `embeddedPort` is a preferred port

`embeddedPort` is now a preferred port. A busy one is skipped for a free port, each further app prefers the next port up, and the service connects to whichever port it chose. Before, the service used the port without checking it, so an app left over from an earlier run could answer instead. If your tests or tooling assume the app is on exactly `embeddedPort`, don't. See [`embeddedPort`](../configuration.md#embeddedport-number-optional).

### Mocking

#### Each multiremote instance has its own mocks

In multiremote, each instance's `browser.dioxus.mock()` gets its own mock, and restoring one leaves the others in place. `clearAllMocks()`, `resetAllMocks()`, `restoreAllMocks()` and `isMockFunction(command)` on an instance only touch that instance's mocks, while on the root they cover every instance. A test that relied on one instance's bulk operation reaching another instance's mocks must call it on that instance, or on the root.

#### `clearMocks`, `resetMocks` and `restoreMocks` take effect

`clearMocks`, `resetMocks` and `restoreMocks`, with their `*Prefix` options, now take effect in every session, where they used to do nothing. A config that set them now clears, resets or restores mocks before each test. Drop them if your tests rely on mocks carrying over between tests. In multiremote, an instance's own `wdio:dioxusServiceOptions` settings apply to that instance's mocks, and the service-level ones to every instance that doesn't set its own.

#### Bulk mock failures

A failed bulk mock operation now attempts every mock, then throws one error listing every failure, where it stopped at the first. In `beforeTest` (`clearMocks`, `resetMocks`, `restoreMocks`), WebdriverIO reports that as a `BeforeTest` hook failure and still runs the test. The `*AllMocks` APIs reject, so they fail the test that calls them.

#### `undefined` arguments in call data

A mock's recorded calls keep `undefined` arguments, nested ones included, where they used to become `null`. An assertion such as `toHaveBeenCalledWith(args, null)` that matched an `undefined` argument now needs `undefined` there. `invoke('cmd')` with no args records `[undefined]`.

**Before (v1):**

```ts
expect(mock).toHaveBeenCalledWith(null);
```

**After (v2):**

```ts
expect(mock).toHaveBeenCalledWith(undefined);
```

#### `withImplementation()`

`mock.withImplementation(implFn, callbackFn)` now runs the callback in the app's webview, like an `execute()` script, and passes it `dx`. In v1 it ran in the test process and the app never saw the temporary implementation. A callback that uses `browser` now fails with "browser is not defined": call the app through `dx`, and do test-side work before or after.

A callback that returns a promise keeps the temporary implementation until the promise settles. The callback takes only `dx`, and `withImplementation()` resolves to its awaited return value. It rejects with "`<command>` is not mocked in this window" when the current window has no mock for the command.

**Before (v1):**

```ts
await mock.withImplementation(impl, async () => {
  await browser.dioxus.execute(({ invoke }) => invoke('my_command'));
});
```

**After (v2):**

```ts
const result = await mock.withImplementation(impl, ({ invoke }) => invoke('my_command'));
```

See [`withImplementation`](../api-reference.md#withimplementationimplfn-callbackfn).

### Scripts and `execute()`

#### Elements in script results

With the embedded driver, `browser.execute()` and `browser.dioxus.execute()` return a DOM element or shadow root in their result as a W3C element reference, as chromedriver does, where they returned `{}`. Pass the reference to `browser.$()` to get the element. A script that relied on the old `{}` should return a plain value instead, such as the element's ID. Any iterable object with a numeric `length`, such as a `NodeList` or `HTMLCollection`, comes back as an array, where it was an object keyed by index, so an assertion such as `toEqual({ 0: 'a' })` needs an array instead.

#### `execute()` return type

`browser.dioxus.execute()` resolves to the script's awaited return type, so a script that returns `invoke(...)` is no longer typed `Promise<Promise<unknown>>`. `invoke` takes the result type as a generic: `invoke<Metrics>('get_metrics')`. Remove any casts that worked around the old type.

### Embedded driver behaviour

These changes are in `wdio-dioxus-embedded-driver`, the default provider. The driver's [Keyboard Events](https://github.com/webdriverio/desktop-mobile/blob/wdio-dioxus-embedded-driver@v2.0.0/packages/dioxus-embedded-driver/README.md#keyboard-events) section describes the result.

#### Screenshots

Page and element screenshots fail with `unsupported operation`, where they returned a blank image. `browser.takeScreenshot()`, `saveScreenshot()`, element screenshots and the visual service's commands throw. Wrap screenshot-on-failure hooks, for example in `afterTest`, in a `try`/`catch`, or skip them for Dioxus. Real screenshots come in a 2.x minor ([#741](https://github.com/webdriverio/desktop-mobile/issues/741)).

#### Clear, Send Keys and Click

- **Send Keys** (`setValue()`, `addValue()`) no longer fires `change` while the field keeps focus. The field fires it when focus leaves, if its value changed, or when Enter commits it. A test that waits for `change` right after `setValue()` must move focus first, with `el.click()` on another element or `browser.keys(Key.Tab)`, or press Enter. Pointer actions (`browser.action()`) don't move focus in this driver. Send Keys refuses an element that can't take focus with `element not interactable`. A date, colour, range or similar input gets its value at once, with `input` and `change`, and an invalid value fails with `invalid argument`.
- **Clear** (`clearValue()`) focuses the field, clears it with an `input` event, fires `change` if the value differs from its last committed one, and leaves the field blurred. It refuses a disabled or read-only field, and anything that isn't an editable field or contenteditable, such as a checkbox or `<select>`, with `invalid element state`.
- **Click** (`el.click()` with no options) fires `pointerdown`, `mousedown`, `pointerup` and `mouseup` before `click`, as a user's click does, so the app's pointer and mouse handlers run. Focus moves as `mousedown`'s default action, so clicking text, the body or a field's `<label>` fires the field's `change` and `blur`. The `click` has `isPrimary: false`, as Chrome's does.

#### When `change` fires

- A field edited by `browser.keys()` owes a `change` too, which fires when focus leaves it, before `blur`, if its value changed.
- When a `keydown` handler moves focus, a key types or deletes in the newly focused element.
- Element Send Keys leaves a `change` owed only when it edits the field, so a field it focused but didn't edit no longer fires `change` after a script changes the value.
- The `change` a field owes fires before any `blur` or `focusout` listener the page adds, capture listeners on `window` and `document` included, as in Chrome.

#### Key codes and Shift

Key actions (`browser.keys()`, `browser.action('key')`) send the browser's `keyCode`, `code` and Shift. Update handlers and assertions that matched the old values:

- `a` is `keyCode` 65 (was no `keyCode`), and `!` is `code: 'Digit1'` with `shiftKey: true` (was `code: ''` without Shift).
- `Key.Return` is `code: 'NumpadEnter'` (was `'Enter'`). `Key.Enter` keeps `code: 'Enter'`.
- Special keys the driver didn't map before, such as PageUp and the numpad keys, arrive as named keys instead of their code points.
- A newline or `\b` in `browser.keys()` is the Enter or Backspace key, so a newline commits an input's `change`. A carriage return is skipped.
- With Shift held, key actions and Send Keys send and type the shifted character: `browser.keys([Key.Shift, 'a', '1'])` sends `key: 'A'` and `'!'` (was `'a'` and `'1'`), and `addValue(Key.Shift + 'abc')` types `ABC` (was `abc`). `code` and `keyCode` stay the key's.

#### Key actions type text

Key actions type and delete text in the focused field and fire `input`, as in Chrome. Before, the field kept its value. Enter breaks the line in a textarea or contenteditable, Control+A or Meta+A selects all, and the arrow keys change the checked radio button. A test that pressed keys in a field and expected its value to stay the same now sees the typed text.

#### Send Keys presses special keys

Special keys in `setValue()` and `addValue()` press keys instead of being written into the element: `addValue('x' + Key.Enter)` types `x`, then presses Enter, and `Key.Backspace` deletes. Text sent to an element that isn't a text field or contenteditable, such as a checkbox, `<select>` or button, no longer becomes its `value`. Send Keys to a file input fails with `invalid argument`.

#### Enter and Space

- **Enter in a form's input** submits the form, as a user's Enter does. It clicks the form's first submit button, or submits a form that has no submit button and only one text field, so the app's `click` and `submit` handlers run. This applies to key actions and to Send Keys. The page doesn't navigate: Dioxus desktop blocks it.
- **Enter or Space on a focused button** clicks it, so the app's `click` handler runs and a submit or reset button submits or resets its form.

A test that pressed Enter only to commit a value now also submits the form. To keep the old behaviour, cancel the `keydown`, the `submit`, or for Space, its `keyup`.

#### Tab

Tab moves focus in Chrome's order and Shift+Tab moves it back, firing the `change` the field owes. A tab character presses Tab instead of being typed, so `setValue('user\tpass')` fills two fields, and key events for a tab carry `key: 'Tab'` (was `'\t'`). To keep focus where it is, cancel the Tab `keydown`.

#### Release Actions

`releaseActions()` releases held keys and pointer buttons together, latest press first, where it released every key before any button. With Shift held and then a button pressed, the `mouseup` now comes before Shift's `keyup`, as W3C specifies. Each `keyup` and `mouseup` carries the modifiers and buttons still held after it, so that `mouseup` reports `shiftKey: true`. Release Actions sends every event even if one fails, then returns the first error. A test that expected the old order must swap it.

#### Focus on Windows

On Windows, when WebdriverIO launches the app with the embedded driver, the bridge turns on WebView2's focus emulation:

- In a background window, focus moves fire `focus` and `blur`, so the app's handlers for them run where they didn't before.
- The page stays focused and visible: switching windows fires no window `focus` or `blur`, a minimized window fires no `visibilitychange`, and its timers aren't slowed.
- Turning emulation on fires the `focus` a page in a background window missed.

Apps with their own `with_on_window` callback need a change to get it: see [Apps with their own window callback](#apps-with-their-own-window-callback).

### Deeplinks

- **Multiremote:** in a session where two instances run the same app, `triggerDeeplink()` throws on every instance and on the root, because the OS can't send the URL to one copy of the app. It used to resolve, and the URL started another copy of the app or reached whichever copy the OS chose. Test deeplinks without multiremote, or give each instance its own app. See [Multiremote](../deeplink-testing.md#multiremote).
- **Browser mode:** `browser.dioxus.triggerDeeplink()` throws "`browser.dioxus.triggerDeeplink()` is not supported in browser mode.", where it opened the URL through the OS, outside the page under test.

### Browser mode

- Each capability opens its own `devServerUrl`, where every capability used to open the first browser capability's.
- The service stops the run with a `SevereServiceError` when capabilities mix `'native'` and `'browser'`. Set `mode` the same way on every capability.
- `devServer` is a service-level option only. Move it out of `wdio:dioxusServiceOptions` into the service options, or in standalone mode into `startWdioSession()`'s second argument. With a command or object `devServer`, set `devServerUrl` in the service options too.

**Before (v1):**

```ts
capabilities: [
  {
    browserName: 'dioxus',
    'wdio:dioxusServiceOptions': { mode: 'browser', devServer: 'pnpm dev' },
  },
],
services: [['@wdio/dioxus-service', {}]],
```

**After (v2):**

```ts
capabilities: [{ browserName: 'dioxus', 'wdio:dioxusServiceOptions': { mode: 'browser' } }],
services: [['@wdio/dioxus-service', { devServer: 'pnpm dev', devServerUrl: 'http://localhost:8080' }]],
```

See [Auto-managing the dev server](../browser-mode.md#auto-managing-the-dev-server).

### Standalone mode

- `startWdioSession()` no longer sets the session's request timeout to four times `startTimeout`, or retries each request 10 times; both are WebdriverIO's defaults. To change the timeout, pass `connectionRetryTimeout` with the service options.
- `cleanupWdioSession()` runs `after` and `afterSession`, then deletes the session.
- Another session in the same process can't use a command-form `devServer` at the same URL until the first session's `cleanup()` stops it. It used to share the first session's server, which then stopped under it. To share one server, start it yourself and pass `devServerUrl` without `devServer`.

To keep v1's request timeout, pass four times `startTimeout`:

**Before (v1):**

```ts
const browser = await startWdioSession(capabilities, { startTimeout: 30_000 });
```

**After (v2):**

```ts
const browser = await startWdioSession(capabilities, { startTimeout: 30_000, connectionRetryTimeout: 120_000 });
```

See [`startWdioSession`](../api-reference.md#startwdiosessioncapabilities-globaloptions).

## Verification

After updating, verify your migration:

1. **Check your `package.json`**: `@wdio/dioxus-service` is `^2`, and WebdriverIO is 9.33.0+ or 10.2.0+.
2. **Check your `Cargo.toml` and `Cargo.lock`**: `wdio-dioxus` is `"2"`, and `cargo tree -i wdio-dioxus-bridge` shows only 2.x.
3. **Check your config**: no `commandTimeout`, `rootDir`, `webviewOptions` or `driverProvider: 'external'`, and `devServer` only in the service options.
4. **Run your tests**: failures from the embedded driver's new events, keys and focus moves point at the matching section above.
