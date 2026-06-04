# @wdio/electron-service

[![@wdio/electron-service](https://img.shields.io/badge/@wdio-electron--service-9feaf9?labelColor=1a1a1a&style=plastic)](https://www.npmjs.com/package/@wdio/electron-service)
[![Version](https://img.shields.io/npm/v/@wdio/electron-service?color=28a745&labelColor=1a1a1a)](https://www.npmjs.com/package/@wdio/electron-service)
[![Downloads](https://img.shields.io/npm/dw/@wdio/electron-service?color=6f42c1&labelColor=1a1a1a)](https://www.npmjs.com/package/@wdio/electron-service)
[![Downloads (≤ v9)](https://img.shields.io/npm/dw/wdio-electron-service?label=downloads%20(%E2%89%A4%20v9)&color=9e9e9e&labelColor=1a1a1a)](https://www.npmjs.com/package/wdio-electron-service)

**WebdriverIO service for testing Electron applications**

Enables cross-platform E2E testing of Electron apps via the extensive WebdriverIO ecosystem.

Spiritual successor to [Spectron](https://github.com/electron-userland/spectron) ([RIP](https://github.com/electron-userland/spectron/issues/1045)).

> **v10 highlights** — the package is now scoped as `@wdio/electron-service`. v10 adds class mocking (`browser.electron.mock('Tray')`), main- and renderer-process console log capture, deeplink testing (`browser.electron.triggerDeeplink()`), an `electronBuilderConfig` option for projects with multiple build configs, and a `mode: 'browser'` option for testing the renderer in plain Chrome against a Vite dev server without an Electron binary. See the [v10.0.0 release notes](./docs/release-notes/v10.0.0.md) for the full list, or the [v9 → v10 migration guide](./docs/migration/v9-to-v10.md) if you're upgrading.

### Features

Makes testing Electron applications much easier via:

- 🚗 Auto-setup of required Chromedriver (for Electron v26 and above)
- 📦 Automatic path detection of your Electron application
  - Supports [Electron Forge](https://www.electronforge.io/), [Electron Builder](https://www.electron.build/) and unpackaged apps
- 🧩 Access Electron APIs within your tests
- 🕵️ Mocking of Electron APIs via a Vitest-like API
- 🔗 Deeplink/protocol handler testing support
- 📊 Console log capture from main and renderer processes
- 🖥️ Headless testing support
  - Automatic Xvfb integration for Linux environments (requires WebdriverIO 9.19.1+)

## Installation

You will need to install `WebdriverIO`, instructions can be found [here](https://webdriver.io/docs/gettingstarted).

**Note:** WebdriverIO 9.19.1+ is required for automatic Xvfb support via the `autoXvfb` configuration option. For legacy WDIO versions, you'll need to use external tools like `xvfb-maybe` or manually set up Xvfb for headless testing on Linux. See the [Common Issues](./docs/common-issues.md) section for more details on Xvfb setup.

## Quick Start

The recommended way to get up and running quickly is to use the [WDIO configuration wizard](https://webdriver.io/docs/gettingstarted#initiate-a-webdriverio-setup).

### Manual Quick Start

To get started without using the configuration wizard, you will need to install the service and `@wdio/cli`:

```bash
npm install --save-dev @wdio/cli @wdio/electron-service
```

Or use your package manager of choice - pnpm, yarn, etc.

Next, create your WDIO configuration file. For inspiration, see the self-contained [package test apps](../../fixtures/package-tests/) in this repository or the [WDIO configuration reference](https://webdriver.io/docs/configuration).

You will need to add `electron` to your services array and set an Electron capability, e.g.:

_`wdio.conf.ts`_

```ts
export const config = {
  // ...
  services: ["electron"],
  capabilities: [
    {
      browserName: "electron",
    },
  ],
  // ...
};
```

Finally, [run some tests](https://webdriver.io/docs/gettingstarted#run-test) using your configuration file.

This will spin up an instance of your app in the same way that WDIO handles browsers such as Chrome or Firefox. The service works with [WDIO (parallel) multiremote](https://webdriver.io/docs/multiremote) if you need to run additional instances simultaneously, e.g. multiple instances of your app or different combinations of your app and a Web browser.

If you use [Electron Forge](https://www.electronforge.io/) or [Electron Builder](https://www.electron.build/) to package your app then the service will automatically attempt to find the path to your bundled Electron application. You can provide a custom path to the binary via custom service capabilities, e.g.:

_`wdio.conf.ts`_

```ts
export const config = {
  // ...
  capabilities: [
    {
      browserName: "electron",
      "wdio:electronServiceOptions": {
        appBinaryPath: "./path/to/built/electron/app.exe",
        appArgs: ["foo", "bar=baz"],
      },
    },
  ],
  // ...
};
```

See the [configuration doc](./docs/configuration.md#appbinarypath) for how to find your `appBinaryPath` value for the different operating systems supported by Electron.

Alternatively, you can point the service at an unpackaged app by providing the path to the `main.js` script. Electron will need to be installed in your `node_modules`. It is recommended to bundle unpackaged apps using a bundler such as Rollup, Parcel, Webpack, etc.

_`wdio.conf.ts`_

```ts
export const config = {
  // ...
  capabilities: [
    {
      browserName: "electron",
      "wdio:electronServiceOptions": {
        appEntryPoint: "./path/to/bundled/electron/main.bundle.js",
        appArgs: ["foo", "bar=baz"],
      },
    },
  ],
  // ...
};
```

## Chromedriver Configuration

**If your app uses a version of Electron which is lower than v26 then you will need to [manually configure Chromedriver](./docs/configuration.md#user-managed).**

This is because WDIO uses Chrome for Testing to download Chromedriver, which only provides Chromedriver versions of v115 or newer.

## Documentation

### Getting Started
- **[Configuration](./docs/configuration.md)** — service options and Chromedriver setup
- **[Electron APIs](./docs/electron-apis.md)** — accessing and mocking Electron APIs in tests

### Reference
- **[API Reference](./docs/api-reference.md)** — every `browser.electron.*` method and exported helper
- **[Window Management](./docs/window-management.md)** — automatic window focus behaviour

### Operations
- **[Browser Mode](./docs/browser-mode.md)** — test the renderer in Chrome against a Vite dev server, no Electron binary required
- **[Deeplink Testing](./docs/deeplink-testing.md)** — protocol handler tests across platforms
- **[Standalone Mode](./docs/standalone-mode.md)** — using the service without the WDIO test runner
- **[Visual Testing](../../docs/visual-testing.md)** — visual regression with `@wdio/visual-service`
- **[Video Recording](../../docs/video-recording.md)** — record video of test runs with `wdio-video-reporter`
- **[Debugging](./docs/debugging.md)** — log capture, debug namespaces, troubleshooting
- **[Common Issues](./docs/common-issues.md)** — known issues and workarounds

### Migration & Release Notes
- **[v10.0.0 Release Notes](./docs/release-notes/v10.0.0.md)** — full list of v10 changes
- **[v9 → v10 Migration](./docs/migration/v9-to-v10.md)** — required upgrade actions
- **[v8 → v9 Migration](./docs/migration/v8-to-v9.md)**

### Contributing
- **[Development](./docs/development.md)** — local setup, testing, dependency catalogs
- **[Release Management](./docs/release-management.md)** — release labels and workflow

## Development

Read the [development doc](./docs/development.md) if you are interested in contributing.

## Example Integrations

Check out our [Electron boilerplate](https://github.com/webdriverio/electron-boilerplate) project that showcases how to integrate WebdriverIO in an example application. You can also have a look at the [package test apps](../../fixtures/package-tests/), [E2E test apps](../../fixtures/e2e-apps/), and [E2E test suites](../../e2e/) in this repository.

## Support

If you are having issues running WDIO with the service you should check the documented [Common Issues](./docs/common-issues.md) in the first instance, then open a discussion in the [main WDIO forum](https://github.com/webdriverio/webdriverio/discussions).

The Electron service discussion forum is much less active than the WDIO one, but if the issue you are experiencing is specific to Electron or using the service then you can open a discussion [here](https://github.com/webdriverio-community/wdio-electron-service/discussions).
