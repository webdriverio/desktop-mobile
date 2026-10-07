# Quick Start Guide

Get up and running with WebdriverIO and Dioxus E2E testing in minutes.

## Prerequisites

### Required Software

1. **Node.js 18+** - Download from [nodejs.org](https://nodejs.org)

2. **Rust Toolchain** - Required for building Dioxus apps
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. **Dioxus CLI (`dx`)** - Builds the app and bundles the files it loads with `asset!()`. Install the version that matches your `dioxus` crate:
   ```bash
   cargo binstall dioxus-cli   # or: cargo install dioxus-cli --locked
   ```

### Platform-Specific Requirements

#### Windows

- **Microsoft Visual C++ Build Tools** - Download from [Microsoft Visual C++](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- The `'embedded'` provider (recommended) requires no additional setup.
- The `'external'` provider isn't available yet ([#713](https://github.com/webdriverio/desktop-mobile/issues/713)); use `'embedded'`.

#### Linux

- **WebKitGTK Development Libraries** - Required to build Dioxus desktop apps:
  ```bash
  # Debian/Ubuntu
  sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

  # Fedora
  sudo dnf install -y webkit2gtk4.1-devel gtk3-devel

  # Arch Linux
  sudo pacman -S webkit2gtk-4.1 gtk3
  ```

Use the `'embedded'` provider. `'external'` isn't available yet and on Linux also needs an upstream Dioxus change ([#712](https://github.com/webdriverio/desktop-mobile/issues/712)).

#### macOS

✅ **Supported** - Use the embedded WebDriver provider (`driverProvider: 'embedded'`, the default) for native macOS testing without external dependencies. `'external'` is not supported on macOS. See [Platform Support](./platform-support.md) for details.

## Setting Up a Dioxus App

### Create a Minimal Dioxus Desktop App

```bash
mkdir my-dioxus-app
cd my-dioxus-app
cargo init --name my_app
```

Edit `Cargo.toml`:

```toml
[package]
name = "my_app"
version = "0.1.0"
edition = "2021"

[dependencies]
dioxus = { version = "0.7", features = ["desktop"] } # your Dioxus version (the bridge tracks the latest release)
wdio-dioxus-embedded-driver = "1"
```

Edit `src/main.rs`:

```rust
use dioxus::prelude::*;

fn main() {
    let mut config = dioxus::desktop::Config::new();

    #[cfg(debug_assertions)]
    {
        config = wdio_dioxus_embedded_driver::install(config);
    }

    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}

#[component]
fn App() -> Element {
    rsx! {
        h1 { "Hello, Dioxus!" }
    }
}
```

## The Embedded Driver

The `wdio-dioxus-embedded-driver` crate is **required** for testing. It runs the WebDriver server that the service connects to, and installs `wdio-dioxus-bridge`, which enables `browser.dioxus.execute()`, mocking, and log capture.

Calling `wdio_dioxus_bridge::install(config)` on its own is not enough: it doesn't start the WebDriver server, so the service can't connect.

The `#[cfg(debug_assertions)]` guard ensures the driver and bridge are compiled out of release builds. See [App Setup](./app-setup.md) for the full rationale and setup options.

## Building the Dioxus App

```bash
# Build for testing (debug build, driver and bridge are active)
dx build --desktop

# Or release build (driver and bridge compiled out, for production)
dx build --desktop --release
```

Build with `dx` rather than `cargo build`. `dx` bundles the files your app loads with `asset!()`; a plain `cargo build` binary can't resolve those paths, so stylesheets, images and fonts fail to load during tests. If your app doesn't use `asset!()`, `cargo build` also works, and the binary is at `target/debug/my_app`.

`dx` prints the bundle path when the build finishes. The debug binary is at:

| Platform | Binary path |
|----------|-------------|
| macOS | `target/dx/my_app/debug/macos/MyApp.app/Contents/MacOS/my_app` |
| Linux | `target/dx/my_app/debug/linux/app/my_app` |
| Windows | `target\dx\my_app\debug\windows\app\my_app.exe` |

## WebdriverIO Installation

### 1. Install WebdriverIO

```bash
npm install --save-dev @wdio/cli @wdio/dioxus-service
```

### 2. Create Configuration

Create `wdio.conf.ts`:

```typescript
// dx puts the binary in a different place on each OS
const appPaths: Record<string, string> = {
  darwin: './target/dx/my_app/debug/macos/MyApp.app/Contents/MacOS/my_app',
  linux: './target/dx/my_app/debug/linux/app/my_app',
  win32: './target/dx/my_app/debug/windows/app/my_app.exe',
};

export const config = {
  runner: 'local',
  specs: ['./test/specs/**/*.spec.ts'],
  maxInstances: 1,

  services: [['@wdio/dioxus-service', {
    driverProvider: 'embedded',  // Recommended on all platforms
  }]],

  capabilities: [{
    browserName: 'dioxus',
    'dioxus:options': {
      application: appPaths[process.platform],  // Path to debug binary
    },
  }],

  logLevel: 'info',
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
};
```

### 3. Create a Test

Create `test/specs/example.spec.ts`:

```typescript
describe('My Dioxus App', () => {
  it('should display hello world', async () => {
    await browser.pause(500);

    const heading = await browser.$('h1');
    expect(await heading.getText()).toBe('Hello, Dioxus!');
  });

  it('should execute Dioxus commands', async () => {
    const mock = await browser.dioxus.mock('get_platform_info');
    await mock.mockReturnValue({ platform: 'linux', arch: 'x86_64' });

    const result = await browser.dioxus.execute(({ invoke }) => {
      return invoke('get_platform_info');
    });

    expect(result).toHaveProperty('platform');
  });

  it('should mock Dioxus commands', async () => {
    const mock = await browser.dioxus.mock('get_user');
    await mock.mockReturnValue({ id: 1, name: 'Test User' });

    const user = await browser.dioxus.execute(({ invoke }) => {
      return invoke('get_user');
    });

    expect(user).toEqual({ id: 1, name: 'Test User' });
  });
});
```

## Running Tests

### Run All Tests

```bash
npx wdio run wdio.conf.ts
```

### Run Specific Test File

```bash
npx wdio run wdio.conf.ts --spec test/specs/example.spec.ts
```

### Run with Debug Logging

```bash
npx wdio run wdio.conf.ts --logLevel debug
```

## Troubleshooting

### "Embedded WebDriver server did not become ready" or "Bridge not available"

The embedded driver is not wired into your app. Make sure:

1. Add to `[dependencies]` in `Cargo.toml`:
   ```toml
   wdio-dioxus-embedded-driver = "1"
   ```

2. Call `wdio_dioxus_embedded_driver::install(config)` in `main.rs` inside a `#[cfg(debug_assertions)]` block. `wdio_dioxus_bridge::install(config)` alone doesn't start the WebDriver server.

3. Build in debug mode (`dx build --desktop`, not `dx build --desktop --release`).

4. Nothing else is listening on the embedded port (`4444` by default). Set `embeddedPort` in the service options to use a different one.

### Styles or images are missing during tests

The app was built with `cargo build`, which doesn't bundle the files loaded with `asset!()`. Build with `dx build --desktop` and point `dioxus:options.application` at the `dx` output (see [Building the Dioxus App](#building-the-dioxus-app)).

### "Application not found at path"

The `appBinaryPath` or `dioxus:options.application` is wrong. Verify:

1. You built the app: `dx build --desktop`
2. The path exists: `dx` prints it when the build finishes (see [Building the Dioxus App](#building-the-dioxus-app))
3. Update the path in `wdio.conf.ts` if needed

### "driverProvider: 'external' is not supported"

`'external'` isn't available yet on any platform ([#713](https://github.com/webdriverio/desktop-mobile/issues/713)). Use `driverProvider: 'embedded'`, the default.

## Next Steps

1. **Add more tests** - See [Usage Examples](./usage-examples.md) for patterns
2. **Advanced features** - Read about [Mocking](./api-reference.md#browserdioxusmockcommand) and [Log Forwarding](./log-forwarding.md)
3. **Configure the service** - See [Configuration](./configuration.md) for all options
4. **Debug issues** - Check [Troubleshooting](./troubleshooting.md)

## Common Patterns

### Test Custom Dioxus Commands

```typescript
it('should call custom commands', async () => {
  const result = await browser.dioxus.execute(({ invoke }) => {
    return invoke('my_custom_command', { param: 'value' });
  });

  expect(result).toBeDefined();
});
```

### Capture Logs

Enable log capture in `wdio.conf.ts`:

```typescript
services: [['@wdio/dioxus-service', {
  captureBackendLogs: true,
  captureFrontendLogs: true,
  backendLogLevel: 'debug',
  frontendLogLevel: 'debug',
}]],
```

### Multiremote Testing

Run multiple instances of your app:

```typescript
capabilities: [
  {
    browserName: 'dioxus',
    'dioxus:options': {
      application: appPaths[process.platform],
    },
  },
  {
    browserName: 'dioxus',
    'dioxus:options': {
      application: appPaths[process.platform],
    },
  },
],
```

### CI/CD Integration

Example GitHub Actions workflow:

```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest  # or windows-latest / macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: dtolnay/rust-toolchain@stable

      - name: Install Linux dependencies
        if: runner.os == 'Linux'
        run: sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

      - name: Install dependencies
        run: npm install

      - uses: cargo-bins/cargo-binstall@main

      - name: Install Dioxus CLI
        run: cargo binstall dioxus-cli --no-confirm

      - name: Build Dioxus app
        run: dx build --desktop

      - name: Run tests (Linux needs a virtual display for desktop apps)
        if: runner.os == 'Linux'
        run: xvfb-run -a npm run test:e2e

      - name: Run tests
        if: runner.os != 'Linux'
        run: npm run test:e2e
```

## See Also

- [Configuration Reference](./configuration.md)
- [API Reference](./api-reference.md)
- [App Setup](./app-setup.md)
- [Platform Support](./platform-support.md)
- [Troubleshooting](./troubleshooting.md)
- [WebdriverIO Documentation](https://webdriver.io/docs)
- [Dioxus Documentation](https://dioxuslabs.com/learn)
