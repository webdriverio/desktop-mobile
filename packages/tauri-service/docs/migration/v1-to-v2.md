# Migration Guide: v1 → v2

What changes when you upgrade from v1 to v2, and what to do about it.

v2 covers three packages that ship together: the service (`@wdio/tauri-service`), the plugin (`@wdio/tauri-plugin` and the `tauri-plugin-wdio` crate) and the embedded WebDriver (the `tauri-plugin-wdio-webdriver` crate).

## What's New in v2

Most of the changes make the embedded driver behave as Chrome does under chromedriver: its events, keys and focus, and element references in script results. Mocks also see the app's own `invoke()` calls. For the full list, see the [v2.0.0 release notes](../release-notes/v2.0.0.md). New features are additive and need no migration.

### WebdriverIO v10

v2 runs on WebdriverIO v10 as well as v9. Moving to v10 is optional. If you do, see WebdriverIO's [From v9 to v10](https://webdriver.io/docs/v10-migration) guide for the changes in your own tests, such as a strict `$`, the removal of `multiremotebrowser` and `executeAsync`, and Mocha 12. Two of v10's changes show in a Tauri app:

- **Linux display:** WebdriverIO starts a display server itself, Weston if it's installed and Xvfb otherwise, so no `xvfb-run` wrapper is needed. The `embedded` and `external` providers are tested on both and need no setting. An app with X11-only dependencies sets `displayServer: 'xvfb'`. Local runs on a Linux desktop now show the app instead of a hidden Xvfb. See [Linux Without a Display](../quick-start.md#linux-without-a-display).
- **Async `browser.execute()`:** `browser.execute(async () => …)` is awaited on WebKit-based drivers, where v9 didn't await it. That covers Tauri on macOS and Linux.

## Breaking Changes

### Requirements

#### WebdriverIO 9.33.0+

v2 needs WebdriverIO 9.33.0+ on v9, or 10.2.0+ on v10 (`^9.33.0 || ^10.2.0`), the first releases with the Node.js floors below.

#### Node.js

Every package needs Node.js 22 (22.23.4+), 24 (24.22.1+) or 26 (26.12.1+). Node.js 23.x and 25.x aren't supported. Older versions trust the compromised eMudhra intermediate CAs.

#### WebdriverIO packages are optional peers

`webdriverio`, `@wdio/globals` and `@wdio/types` are now optional peer dependencies of the service, where they used to be exact 9.x dependencies. They need WebdriverIO 9.33.0+ or 10.2.0+, the first releases with the new Node.js floors.

- **Testrunner mode:** nothing new to install. `@wdio/cli` and `@wdio/local-runner` provide all of them, and the service uses those copies. Update `@wdio/cli` and its packages to 9.33.0+ or 10.2.0+.
- **Standalone mode** (no testrunner): install `webdriverio` and `@wdio/globals` next to the service. The service's entry point imports `@wdio/globals`, and its own dependencies used to bring both.
- **pnpm with hoisting turned off, or Yarn Plug'n'Play:** these don't let a package see what it hasn't declared, so list `webdriverio`, `@wdio/types` and `@wdio/globals` as direct dependencies, even in testrunner mode.

They're optional rather than required because npm and pnpm install a missing required peer at the newest version in range, so a project even one release behind got a second copy of each package.

#### Update the service, the plugin and the embedded driver together

The v2 service relies on v2 of the plugin and of the embedded driver. For example, mocks reach the app's own `invoke()` calls through the v2 frontend plugin, `triggerDeeplink()` calls a command that only the v2 crate has, and element references in `browser.tauri.execute()` results need the v2 embedded driver. Update all of them at once.

**Before (v1):**

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri-plugin-wdio = "1"
tauri-plugin-wdio-webdriver = "1"
```

```json
{
  "devDependencies": {
    "@wdio/tauri-plugin": "^1.5.1",
    "@wdio/tauri-service": "^1.5.1"
  }
}
```

**After (v2):**

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri-plugin-wdio = "2"
tauri-plugin-wdio-webdriver = "2"
```

```json
{
  "devDependencies": {
    "@wdio/tauri-plugin": "^2.0.0",
    "@wdio/tauri-service": "^2.0.0"
  }
}
```

Leave out `tauri-plugin-wdio-webdriver` if you use the `external` or `crabnebula` provider.

#### Tauri 2.10 and Rust

Both crates require `tauri` 2.10 or later. `tauri-plugin-wdio` used to declare 2.0.0, which was never tested. `tauri-plugin-wdio-webdriver` already required 2.10, so most apps, which use the default `embedded` provider, already meet it.

The crates also declare the Rust versions they build with: `tauri-plugin-wdio` needs Rust 1.77.2+ and `tauri-plugin-wdio-webdriver` Rust 1.83+.

#### `@tauri-apps/api` is a peer of `@wdio/tauri-plugin`

`@wdio/tauri-plugin` now takes the app's `@tauri-apps/api` (2.10+) as a peer, where it brought an exact 2.12.1 of its own, so an app on another version got a second copy. It also no longer brings `@tauri-apps/plugin-log`, which nothing imported. Install `@tauri-apps/api` in the app if it isn't there already, and add `@tauri-apps/plugin-log` yourself if your app imports it.

### Configuration and Options

#### `driverProvider: 'official'` is removed

Use `'external'`, which `'official'` already mapped to. Any value other than `'embedded'`, `'external'` or `'crabnebula'` now stops the run with `driverProvider must be 'embedded', 'external' or 'crabnebula'`, where it used to fall back to `tauri-driver`.

**Before (v1):**

```ts
services: [['@wdio/tauri-service', { driverProvider: 'official' }]],
```

**After (v2):**

```ts
services: [['@wdio/tauri-service', { driverProvider: 'external' }]],
```

#### `commandTimeout` is removed

The service accepted `commandTimeout`, and `createTauriCapabilities()` took one, but it never took effect. To bound each WebDriver request, set WebdriverIO's `connectionRetryTimeout`.

**Before (v1):**

```ts
export const config = {
  services: [['@wdio/tauri-service', { commandTimeout: 60000 }]],
};
```

**After (v2):**

```ts
export const config = {
  connectionRetryTimeout: 60000,
  services: ['@wdio/tauri-service'],
};
```

#### `rootDir` is removed

`rootDir` did nothing in the Tauri service, so remove it from the service options and from `wdio:tauriServiceOptions`. In standalone mode, `startWdioSession(capabilities, { rootDir })` becomes `startWdioSession(capabilities)`.

#### `appArgs` and `env` reach the app with every provider

With the `external` and `crabnebula` providers, [`appArgs`](../configuration.md#appargs-string-optional) and [`env`](../configuration.md#env-recordstring-string-optional) now reach the app, where they were dropped. Remove any you set but didn't want applied.

`tauri:options.args`, when set, replaces `appArgs`, with the `embedded` provider too. Make it the app's full argument list, or remove it and use `appArgs`.

#### Driver options that are service-level only

`tauriDriverPort`, `autoDownloadEdgeDriver` and `edgeDriverVersion` are read only from the service options. Move them out of `wdio:tauriServiceOptions`. In standalone mode, pass `tauriDriverPort` to `startWdioSession()`'s second argument.

**Before (v1):**

```ts
capabilities: [
  {
    'wdio:tauriServiceOptions': { tauriDriverPort: 4500 },
  },
],
```

**After (v2):**

```ts
services: [['@wdio/tauri-service', { tauriDriverPort: 4500 }]],
```

#### `webviewOptions` no longer takes `width` or `height`

[`tauri:options.webviewOptions`](../configuration.md#webviewoptions-windows-external-provider) now takes msedgedriver's WebView2 options only. `width` and `height` never had an effect, so remove them.

#### `embeddedPort` is a preferred port

[`embeddedPort`](../configuration.md#embeddedport-number-optional) is now the port the service tries first. A busy port is skipped for a free one, each further app prefers the next port up, and the service connects to whichever port it chose.

#### A failing `onPrepare` or `onWorkerStart` stops the run

A launcher failure, such as an app binary that isn't found or a driver that doesn't start, now stops the run, where WebdriverIO used to log it and carry on.

### Mocking

#### Mocks see the commands the app invokes

In native mode, a mock now also applies to the commands the app invokes itself, through `@tauri-apps/api`'s `invoke()`, `window.__TAURI__.core.invoke` or `emit()`. Those calls used to reach Rust.

A test that leaves a mock registered while it drives the app now gets the mock's value in the app. Restore the mock (`mockRestore()` or `browser.tauri.restoreAllMocks()`) before the app's own call should reach Rust. This needs v2 of `@wdio/tauri-plugin` and `@wdio/tauri-service` together.

#### Bulk mock operations try every mock, then throw

A failed bulk mock operation now attempts every mock, then throws one error listing every failure. In `beforeTest` (`clearMocks`, `resetMocks`, `restoreMocks`), WebdriverIO reports that as a `BeforeTest` hook failure and still runs the test. `clearAllMocks()`, `resetAllMocks()` and `restoreAllMocks()` reject, so they fail the test that calls them. They used to stop at the first failure and skip the rest.

#### `undefined` arguments stay `undefined`

A mock's recorded calls keep `undefined` arguments, nested ones included, where they used to become `null`. `invoke('cmd')` with no args records `[undefined]`.

**Before (v1):**

```ts
expect(mock).toHaveBeenCalledWith(null);
```

**After (v2):**

```ts
expect(mock).toHaveBeenCalledWith(undefined);
```

#### Browser-mode mocks get only the args

In browser mode, a mock gets only the args, as in native mode, and no longer Tauri's `InvokeOptions`. An implementation that reads `headers` gets `undefined`. Each call records `[args]`, so drop the trailing `null` from assertions.

**Before (v1):**

```ts
expect(mock).toHaveBeenCalledWith({ name: 'Ada' }, null);
```

**After (v2):**

```ts
expect(mock).toHaveBeenCalledWith({ name: 'Ada' });
```

#### `withImplementation()` waits for a returned promise

A [`withImplementation()`](../api-reference.md#withimplementationimplfn-callbackfn) callback that returns a promise keeps the temporary implementation until the promise settles, where it used to be restored as soon as the callback returned. The callback takes only the framework object, and `browser.tauri.execute()` and `withImplementation()` resolve to the callback's awaited return type.

### Scripts and `execute()`

#### A `browser.tauri.execute()` script's first argument

A [`browser.tauri.execute()`](../api-reference.md#browsertauriexecutescript-args) script's first argument is `{ core: { invoke } }`. `TauriAPIs` no longer declares `app`, `window` or `event`, which were never passed. `core.invoke` takes a command and at most an args object.

**Before (v1):**

```ts
await browser.tauri.execute(async (tauri) => tauri.app?.getVersion());
```

**After (v2):**

```ts
await browser.tauri.execute((tauri) => tauri.core.invoke('plugin:app|version'));
```

The `@deprecated` `executeTauriCommand()` and its helpers (`executeTauriCommandWithTimeout`, `executeTauriCommands`, `executeTauriCommandsParallel`, `isTauriApiAvailable`, `getTauriVersion`, `getTauriAppInfo` and the `TauriCommandContext` type) are removed. The package's `exports` never exposed them; use `browser.tauri.execute()`.

#### `browser.execute()` returns elements as references

With the `embedded` provider, `browser.execute()` returns a DOM element or shadow root in its result as a W3C reference, as chromedriver does, where it returned `null` or `{}`. Any iterable with a numeric `length`, such as a `NodeList`, comes back as an array. Pass the reference to `browser.$()`, or return a plain value such as the element's ID.

#### `browser.tauri.execute()` returns elements as references

`browser.tauri.execute()` does the same:

- **`embedded` provider:** a DOM element or shadow root comes back as a W3C reference, and any iterable with a numeric `length`, such as a `NodeList`, as an array. An element argument that has left the document fails with `stale element reference`.
- **`external` and `crabnebula` providers:** the script runs in the session's current window through WebDriver, so an element comes back as a W3C reference, and a `NodeList` as an array of references, where they came back as `{}`. A script for another window, chosen with `windowLabel`, still runs through the plugin and returns `{}` for elements. After `switchToFrame()`, the script runs in that frame. A script's error comes through as its own message, without the `Promise error: Failed to execute script:` prefix.

A test that compared such a result with `{}` or with an object keyed by index needs a reference or an array instead.

### Embedded Driver Behaviour

These changes are in `tauri-plugin-wdio-webdriver`, so they apply to the `embedded` provider, the default. Each brings the driver closer to Chrome driven by chromedriver. The [Keyboard Events](../../../tauri-plugin-webdriver/README.md#keyboard-events) section of the crate's README has the full rules.

#### `change` fires when focus leaves the field

Clear and Send Keys no longer fire `change` while the field keeps focus. It fires when focus leaves the field, before `blur` and before any `blur` or `focusout` listener the page adds, or when Enter commits an input. A test that waits for `change` right after `setValue()` or `addValue()` must move focus first, with `el.click()` on another element or `browser.keys(Key.Tab)`. Pointer actions don't move focus in this driver, so `browser.action()`, `doubleClick()`, and `click()` with `x`, `y` or `button` don't fire it.

#### Clear blurs the field, fires no `input` and refuses non-editable elements

Clear leaves the field blurred, as W3C specifies. As in chromedriver, it fires `change` whenever it empties a field, including one Send Keys typed into from empty, and no `input`. After `clearValue()`, or `setValue('')`, an app that updates its state only on `input`, such as Vue's `v-model`, doesn't see the field emptied; `setValue()` still fires `input` when its typing changes the field. It refuses a disabled or read-only field, or an element that isn't a text field or contenteditable, such as a checkbox or a `<select>`, with `invalid element state`, as chromedriver does. That includes a web component's host element that delegates focus to an input inside it: target the inner input instead.

#### Key codes, newlines and Backspace

Letters, digits and punctuation send the browser's `keyCode`, `code` and Shift: `a` is `keyCode` 65, not 97, and `!` is `code: 'Digit1'` with `shiftKey: true`. A newline or `\b` in `browser.keys()` or `setValue()` text is the Enter or Backspace key, so a newline commits an input's `change`, and a carriage return is skipped. `Key.Enter` keeps `code: 'Enter'`. Update handlers or assertions that matched the old values.

#### Shift sends the shifted character

With Shift held, a key that a US keyboard shifts sends and types the shifted character, in key actions and Send Keys. `browser.keys([Key.Shift, 'a', '1'])` sends `key: 'A'` and `'!'`, where it sent `'a'` and `'1'`, and `addValue(Key.Shift + 'abc')` types `ABC`. `code` and `keyCode` stay the key's.

#### Tab moves focus

Tab moves focus in Chrome's order, and Shift+Tab moves it back, firing the `change` the field owes. A tab character presses Tab instead of being typed, so `setValue('user\tpass')` fills two fields. Key events for a tab carry `key: 'Tab'`, where they carried `'\t'`. To keep focus where it is, cancel the Tab `keydown`.

#### Enter submits the form

Enter in a form's input submits the form, as a user's Enter does. It clicks the form's first submit button, or submits a form that has no submit button and only one text field. The app's `click` and `submit` handlers run, and a `submit` no handler cancels navigates the page. A test that pressed Enter only to commit a value now also submits the form. To keep the old behaviour, cancel the `keydown` or the `submit`.

#### Enter and Space click a focused button

Enter or Space on a focused button clicks it, so the app's `click` handler runs, and a submit or reset button submits or resets its form. To keep the old behaviour, cancel the `keydown`, or Space's `keyup`.

#### Element Click fires pointer and mouse events

Element Click (`el.click()` with no options) fires `pointerdown`, `mousedown`, `pointerup` and `mouseup` before `click`, as a user's click does, so the app's pointer and mouse handlers run. It moves focus as a click does, so it also fires the `change` and `blur` of the field it leaves. Its `click` has `isPrimary: false`, as Chrome's does.

#### Fields edited by `browser.keys()` owe a `change`

A field edited by `browser.keys()` owes a `change` too, which fires when focus leaves it, before `blur`, if its value changed. When a `keydown` handler moves focus, a key types or deletes in the newly focused element.

#### `releaseActions()` releases in reverse press order

`releaseActions()` releases held keys and pointer buttons together, latest press first, where it released every key before any button. With Shift held and then a button pressed, the `mouseup` now comes before Shift's `keyup`, as W3C specifies. A test that expected the old order must swap it.

#### Windows: page focus is emulated

On Windows, the driver emulates page focus in WebView2, so the app behaves as if its window has OS focus:

- In a background window, focus moves now fire `focus` and `blur`, so the app's handlers for them run.
- Switching windows fires no window `focus` or `blur`, a minimized window fires no `visibilitychange`, and its timers aren't slowed.
- For a page in a background window, the driver fires the `focus` the page missed when emulation turns on.

### Deeplinks

#### `triggerDeeplink()` emits the deep-link plugin's event

With the `embedded` provider, and CrabNebula on macOS, `triggerDeeplink()` has `tauri-plugin-wdio` emit the deep-link plugin's `deep-link://new-url` event on the app's main thread. The app's `onOpenUrl` / `on_open_url` handlers receive it, and `triggerDeeplink()` doesn't wait for them. It no longer writes `window.receivedDeeplinks` or `window.deeplinkCount`: read what your handler records instead. See [How the Deeplink Reaches Your App](../deeplink-testing.md#how-the-deeplink-reaches-your-app).

The app's capabilities need `wdio:allow-emit-deep-link`, which `wdio:default` includes. If you list the plugin's permissions one by one, add it:

**Before (v1):**

```json
{
  "permissions": [
    "core:default",
    "wdio:allow-execute"
  ]
}
```

**After (v2):**

```json
{
  "permissions": [
    "core:default",
    "wdio:allow-execute",
    "wdio:allow-emit-deep-link"
  ]
}
```

#### Multiremote deeplinks

- With CrabNebula on Windows and Linux, multiremote `triggerDeeplink()` opens the URL with the OS command, as single sessions already did.
- With the `external` provider, and CrabNebula on Windows and Linux, `triggerDeeplink()` now throws in a multiremote session where two instances run the same app. It used to resolve without delivering anything: the OS can't send the URL to either instance, and starts another copy of the app instead. Use the `embedded` provider, or test deeplinks without multiremote. See [Multiremote](../deeplink-testing.md#multiremote).

### Standalone Mode

- **Peers:** install `webdriverio` and `@wdio/globals` next to the service; see [WebdriverIO packages are optional peers](#webdriverio-packages-are-optional-peers).
- **Request timeout:** [`startWdioSession()`](../api-reference.md#startwdiosessioncapabilities-globaloptions) no longer sets the session's request timeout to four times `startTimeout`, or retries each request 10 times; both are WebdriverIO's defaults now. To change the timeout, pass `connectionRetryTimeout` with the service options.
- **Cleanup:** [`cleanupWdioSession()`](../api-reference.md#cleanupwdiosessionbrowser) runs the service's `after` and `afterSession`, then deletes the session. Call it instead of `browser.deleteSession()`.
- **`rootDir` and `tauriDriverPort`:** drop `rootDir`, and pass `tauriDriverPort` in the second argument; see [`rootDir` is removed](#rootdir-is-removed) and [Driver options that are service-level only](#driver-options-that-are-service-level-only).
- **Browser-mode dev server:** another session in the same process can't use a command-form `devServer` at the same URL until the first session's `cleanupWdioSession()` stops it. It used to share the first session's server, which then stopped under it.

**Before (v1):**

```ts
const browser = await startWdioSession(capabilities, { rootDir: process.cwd() });
// ...
await browser.deleteSession();
```

**After (v2):**

```ts
const browser = await startWdioSession(capabilities, { connectionRetryTimeout: 120000 });
// ...
await cleanupWdioSession(browser);
```

### Browser Mode

#### Each capability opens its own `devServerUrl`

Each capability opens its own `devServerUrl`, where every capability used to open the first browser capability's. Capabilities that mix `'native'` and `'browser'` stop the run with a `SevereServiceError`, so set `mode` the same way on every capability.

#### `devServer` is a service-level option

Move [`devServer`](../browser-mode.md#auto-managing-the-dev-server) out of `wdio:tauriServiceOptions` into the service options, or in standalone mode into `startWdioSession()`'s second argument. With a command or object `devServer`, set `devServerUrl` in the service options too.

**Before (v1):**

```ts
capabilities: [
  {
    'wdio:tauriServiceOptions': {
      mode: 'browser',
      devServer: 'pnpm dev',
      devServerUrl: 'http://localhost:1420',
    },
  },
],
```

**After (v2):**

```ts
services: [
  [
    '@wdio/tauri-service',
    { mode: 'browser', devServer: 'pnpm dev', devServerUrl: 'http://localhost:1420' },
  ],
],
```

### Multiremote

#### Each instance has its own mocks

Each instance's `browser.tauri.mock()` gets its own mock. `clearAllMocks()`, `resetAllMocks()`, `restoreAllMocks()` and `isMockFunction()` on an instance only touch that instance's mocks, while on the root they cover every instance. `resetMocks` and `restoreMocks` work in multiremote too. A test that relied on one instance's `mock()` or bulk call reaching another instance's mocks must call it on that instance, or on the root.

#### Instance options take effect

- `clearMocks`, `resetMocks` and `restoreMocks` set in an instance's `wdio:tauriServiceOptions` now apply to that instance's mocks, where they were ignored. Service-level settings still apply to every instance that doesn't set its own.
- A `windowLabel` set in an instance's `wdio:tauriServiceOptions` sets that instance's default window, where it was ignored.

#### One `driverProvider` per run

Capabilities or instances that resolve to different `driverProvider` values stop the run with a `SevereServiceError`. Set [`driverProvider`](../configuration.md#driverprovider-embedded--external--crabnebula-optional) once in the service options, or to the same value everywhere. An unset `driverProvider` is `'embedded'`.

## Verification

After updating:

1. **Check your versions:** `@wdio/tauri-service` and `@wdio/tauri-plugin` at 2.x, `tauri-plugin-wdio` and `tauri-plugin-wdio-webdriver` at `"2"`, `tauri` at 2.10+, and WebdriverIO at 9.33.0+ or 10.2.0+.
2. **Check your Node.js version:** 22.23.4+, 24.22.1+ or 26.12.1+.
3. **Search your config** for `'official'`, `commandTimeout`, `rootDir`, `webviewOptions.width` or `height`, and `devServer` or `tauriDriverPort` inside `wdio:tauriServiceOptions`.
4. **Run your tests**, and look first at tests that wait for `change`, check key codes, press Enter or Tab, assert mock calls with `null`, or read elements from `execute()` results.

If something fails, see [Troubleshooting](../troubleshooting.md).
