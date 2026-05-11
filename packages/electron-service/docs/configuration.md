# Configuration

This document covers all configuration options for the WDIO Electron Service, including service options and Chromedriver configuration.

## Service Configuration

The service can be configured by setting `wdio:electronServiceOptions` either on the service level or capability level, in which capability level configurations take precedence, e.g. the following WebdriverIO configuration:

_`wdio.conf.ts`_

```ts
export const config = {
  // ...
  services: [
    [
      'electron',
      {
        appBinaryPath: '/foo/bar/myApp'
      },
    ],
  ],
  capabilities: [
    {
      'browserName': 'electron',
      'wdio:electronServiceOptions': {
        appBinaryPath: '/foo/bar/myOtherApp'
        appArgs: ['foo', 'bar'],
      },
    },
  ],
  // ...
};
```

...would result in the following configuration object:

```json
{
  "appBinaryPath": "/foo/bar/myOtherApp",
  "appArgs": ["foo", "bar"]
}
```

## Service Options

The service supports the following configuration options:

### `appArgs`:

An array of string arguments to be passed through to the app on execution of the test run. Electron [command line switches](https://www.electronjs.org/docs/latest/api/command-line-switches) and some [Chromium switches](https://peter.sh/experiments/chromium-command-line-switches) can be used here.

Type: `string[]`

### `appBinaryPath`:

The path to the Electron binary of the app for testing. In most cases the service will determine the path to your app automatically [(check here)](#automatic-detection-of-app-binary), but if this fails for some reason, e.g. your app is in a different repository from your tests, then it is recommended to set this value manually.

If you manually set the path to the Electron binary, the path will be in different formats depending on the build tool you are using, how that tool is configured, and which OS you are building the app on.

Here are some examples of binary paths using default build configurations for a hypothetical app called `myApp` which is built in the `workspace/myApp` directory:

#### MacOS (Arm)

```ts
'/workspace/myApp/dist-electron/mac-arm64/myApp.app/Contents/MacOS/myApp'; // Electron Builder
'/workspace/myApp/out/myApp-darwin-arm64/myApp.app/Contents/MacOS/myApp'; // Electron Forge
```

#### MacOS (Intel)

```ts
'/workspace/myApp/dist-electron/mac-x64/myApp.app/Contents/MacOS/myApp'; // Electron Builder
'/workspace/myApp/out/myApp-darwin-x64/myApp.app/Contents/MacOS/myApp'; // Electron Forge
```

#### MacOS (Universal)

```ts
'/workspace/myApp/dist-electron/mac-universal/myApp.app/Contents/MacOS/myApp'; // Electron Builder
'/workspace/myApp/out/myApp-darwin-universal/myApp.app/Contents/MacOS/myApp'; // Electron Forge
```

#### Linux

```ts
'/workspace/myApp/dist-electron/linux-unpacked/myApp'; // Electron Builder
'/workspace/myApp/out/myApp-linux-x64/myApp'; // Electron Forge
```

#### Windows

```ts
'C:\\workspace\\myApp\\dist-electron\\win-unpacked\\myApp.exe'; // Electron Builder
'C:\\workspace\\myApp\\out\\myApp-win32-x64\\myApp.exe'; // Electron Forge
```

Note:

- The above examples assume electron-builder's `"directories": { "output": "dist-electron" }` config (default is `"dist"`). Your actual binary path depends on your electron-builder configuration.
- Electron Forge uses a standardised output directory which can be represented as `out/{appName}-{OS}-{arch}`

Type: `string`

### `appEntryPoint`:

The path to the unpackaged entry point of the app for testing, e.g. your `main.js`. You will need Electron installed to use this feature. The `appEntryPoint` value overrides `appBinaryPath` if both are set.

**Warning - Deeplink Testing:**

`appEntryPoint` cannot be used for protocol handler testing on Windows or Linux. Protocol handlers on these platforms require an OS-registered executable binary to function correctly with the `browser.electron.triggerDeeplink()` method. You must use a packaged binary instead (either by setting `appBinaryPath` or letting the service auto-detect it). macOS works with both packaged binaries and script-based apps.

See the [Deeplink Testing guide](./deeplink-testing.md) for complete setup instructions.

Type: `string`

### `electronBuilderConfig`:

Path to a custom electron-builder configuration file. This is useful when you have multiple configurations (e.g., `electron-builder-staging.config.js`) that extend a common base configuration, and you need to tell the service which one to use for binary path detection.

When this option is provided, the service will load this specific configuration file and resolve any `extends` chain to determine the output settings.

Type: `string`
Example: `'config/electron-builder-staging.config.js'`

### `devServerUrl`:

The URL of the Vite (or webpack) dev server to navigate to when `mode` is `'browser'`. Must be a valid URL; the service throws a `SevereServiceError` at startup if the value is missing or malformed.

Type: `string`

Required when: `mode: 'browser'`

Example: `'http://localhost:5173'`

See the [Browser Mode Guide](./browser-mode.md) for full setup instructions.

### `mode`:

Controls which test execution mode the service uses.

Type: `'native' | 'browser'`

Default: `'native'`

- **`'native'`** (default) — launches your packaged Electron app via Chromedriver, establishes a CDP bridge to the main process, and provides the full `browser.electron.*` API surface.
- **`'browser'`** — skips binary detection, Chromedriver setup, and the CDP bridge entirely. The service sets `browserName` to `'chrome'` and navigates to `devServerUrl`. IPC calls are intercepted at the `window.electron.ipcRenderer` JavaScript boundary, making it suitable for fast renderer-only tests against a running dev server.

All capabilities in a session must use the same mode; mixing modes across capabilities throws a `SevereServiceError`.

Can be set at the global service level or overridden per capability via `wdio:electronServiceOptions`.

See the [Browser Mode Guide](./browser-mode.md) for a complete walkthrough.

### `clearMocks`:

Calls .mockClear() on all mocked APIs before each test. This will clear mock history, but not reset its implementation.

Type: `boolean`
Default: `false`

### `resetMocks`:

Calls .mockReset() on all mocked APIs before each test. This will clear mock history and reset its implementation to an empty function (will return undefined).

Type: `boolean`
Default: `false`

### `restoreMocks`:

Calls .mockRestore() on all mocked APIs before each test. This will restore the original API function, the mock will be removed.

Type: `boolean`
Default: `false`

### `cdpBridgeTimeout`:

Timeout in milliseconds for any request using CdpBridge to the node debugger.

Type: `number`
Default: `10000` (10 seconds)

### `cdpBridgeWaitInterval`:

Interval in milliseconds to wait between attempts to connect to the node debugger.

Type: `number`
Default: `100`

### `cdpBridgeRetryCount`:

Number of attempts to connect to the node debugger before giving up.

Type: `number`
Default: `3`

### `apparmorAutoInstall`:

Control automatic installation of AppArmor profiles on Linux if needed. This helps resolve Electron startup issues on Ubuntu 24.04+ and other AppArmor-enabled Linux distributions where unprivileged user namespace restrictions prevent Electron from starting.

- `false` (default): Never install; warn and continue without AppArmor profile
- `true`: Install only if running as root (no sudo)
- `'sudo'`: Install if root or via non-interactive sudo (`sudo -n`) if available

Type: `boolean | 'sudo'`

Default: `false`

**Note:** This feature requires appropriate system permissions. When enabled, the service will attempt to create and load a custom AppArmor profile for your Electron binary if the system has AppArmor restrictions that would prevent Electron from starting.

### `captureMainProcessLogs`:

Enable capture of Electron main process console logs. When enabled, console output from `console.log()`, `console.warn()`, `console.error()`, etc. in the main process will be forwarded to WDIO logs with the `[Electron:MainProcess]` prefix.

Uses Chrome DevTools Protocol (CDP) `Runtime.consoleAPICalled` events to capture logs in real-time. Requires the `EnableNodeCliInspectArguments` Electron fuse to be enabled.

Type: `boolean`
Default: `false`

Example:

```ts
export const config = {
  services: [
    ['electron', {
      captureMainProcessLogs: true,
      mainProcessLogLevel: 'info'
    }]
  ]
};
```

### `captureRendererLogs`:

Enable capture of Electron renderer process console logs. When enabled, console output from `console.log()`, `console.warn()`, `console.error()`, etc. in renderer processes (browser windows) will be forwarded to WDIO logs with the `[Electron:Renderer]` prefix.

Uses Puppeteer CDP sessions to capture logs from all renderer targets. Unlike main process logs, renderer logs work independently and do NOT require the `EnableNodeCliInspectArguments` fuse or main process CDP bridge.

Type: `boolean`
Default: `false`

Example:

```ts
export const config = {
  services: [
    ['electron', {
      captureRendererLogs: true,
      rendererLogLevel: 'info'
    }]
  ]
};
```

### `mainProcessLogLevel`:

Minimum log level for main process logs. Only logs at or above this level will be captured and forwarded.

Log level priority (from lowest to highest): `trace` < `debug` < `info` < `warn` < `error`

Type: `'trace' | 'debug' | 'info' | 'warn' | 'error'`
Default: `'info'`

Example:

```ts
export const config = {
  services: [
    ['electron', {
      captureMainProcessLogs: true,
      mainProcessLogLevel: 'warn' // Only capture warn and error logs
    }]
  ]
};
```

### `rendererLogLevel`:

Minimum log level for renderer process logs. Only logs at or above this level will be captured and forwarded.

Log level priority (from lowest to highest): `trace` < `debug` < `info` < `warn` < `error`

Type: `'trace' | 'debug' | 'info' | 'warn' | 'error'`
Default: `'info'`

Example:

```ts
export const config = {
  services: [
    ['electron', {
      captureRendererLogs: true,
      rendererLogLevel: 'debug' // Capture debug, info, warn, and error logs
    }]
  ]
};
```

### `logDir`:

Directory path for log file output in standalone mode. When using `startWdioSession()` without the WDIO test runner, logs will be written to timestamped files in this directory instead of being forwarded to the WDIO logger.

In test runner mode (normal WDIO usage), this option is ignored and logs are forwarded to the WDIO logger under your configured `outputDir`.

Type: `string`
Default: `undefined` (no file logging)

Example:

```ts
import { startWdioSession } from '@wdio/electron-service';

const browser = await startWdioSession([{
  browserName: 'electron',
  'wdio:electronServiceOptions': {
    appBinaryPath: '/path/to/binary',
    captureMainProcessLogs: true,
    captureRendererLogs: true,
    logDir: './logs'  // Logs written to ./logs/wdio-{timestamp}.log
  }
}]);
```

## Log Output Format

### Test Runner Mode

Logs are forwarded to WDIO's logger and appear in your test output with appropriate prefixes:

```
[Electron:MainProcess] Application started
[Electron:Renderer] Page loaded successfully
[Electron:MainProcess:app1] Multiremote instance log
```

### Standalone Mode

Logs are written to timestamped files with full metadata:

```
2025-12-29T19:07:00.123Z INFO electron-service:service: [Electron:MainProcess] Application started
2025-12-29T19:07:01.456Z WARN electron-service:service: [Electron:Renderer] Deprecated API used
```

## Multiremote Support

When using multiremote configurations, logs automatically include the instance ID:

```ts
export const config = {
  capabilities: {
    app1: {
      capabilities: {
        browserName: 'electron',
        'wdio:electronServiceOptions': {
          appBinaryPath: '/path/to/app1',
          captureMainProcessLogs: true
        }
      }
    },
    app2: {
      capabilities: {
        browserName: 'electron',
        'wdio:electronServiceOptions': {
          appBinaryPath: '/path/to/app2',
          captureMainProcessLogs: true
        }
      }
    }
  }
};
```

Output:

```
[Electron:MainProcess:app1] App 1 started
[Electron:MainProcess:app2] App 2 started
```

## Log Capture Requirements

**Main Process Logs:**

- Requires the `EnableNodeCliInspectArguments` Electron fuse to be enabled
- Requires CDP bridge connection to main process
- If CDP bridge is unavailable (e.g., fuse disabled), main process log capture will be disabled with a warning

**Renderer Process Logs:**

- Uses Puppeteer CDP sessions - works independently of main process CDP bridge
- Does NOT require the `EnableNodeCliInspectArguments` fuse
- Will continue to work even if main process CDP bridge is unavailable

This means you can capture renderer logs even when the CDP bridge is unavailable for the main process.

## Automatic detection of App binary

The service will automatically determine the path to the Electron binary of your app based on the configuration of supported build tools.

If you want to manually set this value, you can specify the [`appBinaryPath`](#appbinarypath) option.

### Build tool compatibility

The v10 release is exercised in CI against:

- **electron-builder** 26.x
- **@electron-forge/cli** 7.x

Other 2.x and 7.x versions generally work because the layout of `dist-electron/` and `out/` paths has been stable across these majors. If you run into a detection issue with a specific version, please open an issue with your build tool config so the path resolver can be updated.

### Supported config locations:

##### Electron Builder

- `package.json` (config values are read from `build`)
- `electron-builder.{json,json5,yaml,yml,toml,js,ts,mjs,cjs,mts,cts}`
- `electron-builder.config.{json,json5,yaml,yml,toml,js,ts,mjs,cjs,mts,cts}`
- Custom config file specified via [`electronBuilderConfig`](#electronbuilderconfig)

**Note:** The service supports the [`extends`](https://www.electron.build/configuration/configuration#extends) option in electron-builder configurations. It will recursively resolve and merge extended configurations to determine the final build settings.

##### Electron Forge

- `package.json` (config values are read from `config.forge`)
- `forge.config.js`
- `custom.config.js` (e.g. when `"config": { "forge": "./custom-config.js" }` is specified in package.json)

---

## Chromedriver Configuration

`wdio-electron-service` needs Chromedriver to work. The Chromedriver version needs to be appropriate for the version of Electron that your app was built with, you can either let the service handle this (default) or manage it yourself.

### Service Managed

If you are not specifying a Chromedriver binary then the service will download and use the appropriate version for your app's Electron version. The Electron version of your app is determined by the version of `electron` or `electron-nightly` in your `package.json`, however you may want to override this behaviour - for instance, if the app you are testing is in a different repo from the tests. You can specify the Electron version manually by setting the `browserVersion` capability, as shown in the example configuration below:

_`wdio.conf.ts`_

```ts
export const config = {
  // ...
  services: ['electron'],
  capabilities: [
    {
      browserName: 'electron',
      browserVersion: '28.0.0',
    },
  ],
  // ...
};
```

### User Managed

In order to manage Chromedriver yourself you can install it directly or via some other means like [`electron-chromedriver`](https://github.com/electron/chromedriver), in this case you will need to tell WebdriverIO where your Chromedriver binary is through its custom [`wdio:chromedriverOptions`](https://webdriver.io/docs/capabilities#webdriverio-capabilities-to-manage-browser-driver-options) capability.

For example, in order to use WDIO with an Electron v19 app, you will have to download Chromedriver `102.0.5005.61` from https://chromedriver.chromium.org/downloads. You should then specify the binary path in the WDIO config as follows:

_`wdio.conf.ts`_

```ts
export const config = {
  // ...
  services: ['electron'],
  capabilities: [
    {
      'browserName': 'electron',
      'wdio:chromedriverOptions': {
        binary: '/Users/wdio/Downloads/chromedriver', // path to Chromedriver you just downloaded
      },
    },
  ],
  // ...
};
```
