# Quick Start Guide

Get up and running with WebdriverIO and Dioxus E2E testing in minutes.

## Prerequisites

### Required Software

1. **Node.js 18+** - Download from [nodejs.org](https://nodejs.org)

2. **Rust Toolchain** - Required for building Dioxus apps
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

### Platform-Specific Requirements

#### Windows

- **Microsoft Visual C++ Build Tools** - Download from [Microsoft Visual C++](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- The `'embedded'` provider (recommended) requires no additional setup.
- The `'external'` provider requires `wdio-dioxus-driver` and msedgedriver — see [Edge WebDriver (Windows)](./edge-webdriver-windows.md).

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

The `'embedded'` provider is the only supported provider on Linux in v1. `'external'` is blocked pending an upstream Dioxus PR — see [Platform Support](./platform-support.md).

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
dioxus = { version = "0.6", features = ["desktop"] }

[dev-dependencies]
wdio-dioxus-bridge = "1"
```

Edit `src/main.rs`:

```rust
use dioxus::prelude::*;

fn main() {
    let mut config = dioxus::desktop::Config::new();

    #[cfg(debug_assertions)]
    {
        config = wdio_dioxus_bridge::install(config);
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

## Bridge Setup

The `wdio-dioxus-bridge` crate is **required** for testing — it enables `browser.dioxus.execute()`, mocking, and log capture.

The `#[cfg(debug_assertions)]` guard ensures the bridge is compiled out of release builds. See [Bridge Setup](./plugin-setup.md) for the full rationale and setup options.

## Building the Dioxus App

```bash
# Build for testing (debug build, bridge is active)
cargo build

# Or release build (bridge compiled out, for production)
cargo build --release
```

The debug binary is at:
- `target/debug/my_app` (Linux/macOS)
- `target\debug\my_app.exe` (Windows)

## WebdriverIO Installation

### 1. Install WebdriverIO

```bash
npm install --save-dev @wdio/cli @wdio/dioxus-service
```

### 2. Create Configuration

Create `wdio.conf.ts`:

```typescript
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
      application: './target/debug/my_app',  // Path to debug binary
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
    const result = await browser.dioxus.execute(({ invoke }) => {
      return invoke('get_platform_info');
    });

    console.log('Platform info:', result);
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

### "Bridge not available" or execute returns undefined

The `wdio-dioxus-bridge` crate is not wired into your app. Make sure:

1. Add to `[dev-dependencies]` in `Cargo.toml`:
   ```toml
   wdio-dioxus-bridge = "1"
   ```

2. Call `wdio_dioxus_bridge::install(config)` in `main.rs` inside a `#[cfg(debug_assertions)]` block.

3. Build in debug mode (`cargo build`, not `cargo build --release`).

### "Application not found at path"

The `appBinaryPath` or `dioxus:options.application` is wrong. Verify:

1. You built the app: `cargo build`
2. The path exists: `./target/debug/my_app`
3. Update the path in `wdio.conf.ts` if needed

### Tests timeout on Windows (`'external'` provider)

Edge WebDriver version mismatch. See [Edge WebDriver (Windows)](./edge-webdriver-windows.md).

### Linux: "external provider not supported"

`'external'` is blocked on Linux in v1. Use `driverProvider: 'embedded'` instead.

## Next Steps

1. **Add more tests** - See [Usage Examples](./usage-examples.md) for patterns
2. **Advanced features** - Read about [Mocking](./api-reference.md#mock-functions) and [Log Forwarding](./log-forwarding.md)
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
      application: './target/debug/my_app',
    },
  },
  {
    browserName: 'dioxus',
    'dioxus:options': {
      application: './target/debug/my_app',
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
        run: sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev

      - name: Install dependencies
        run: npm install

      - name: Build Dioxus app
        run: cargo build

      - name: Run tests
        run: npm run test:e2e
```

## See Also

- [Configuration Reference](./configuration.md)
- [API Reference](./api-reference.md)
- [Bridge Setup](./plugin-setup.md)
- [Platform Support](./platform-support.md)
- [Troubleshooting](./troubleshooting.md)
- [WebdriverIO Documentation](https://webdriver.io/docs)
- [Dioxus Documentation](https://dioxuslabs.com/learn/0.6/)
