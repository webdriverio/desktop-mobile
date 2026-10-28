# Quick Start Guide

Get up and running with WebdriverIO and Tauri E2E testing in minutes.

## Prerequisites

### Required Software

1. **Node.js 22.19+** - Download from [nodejs.org](https://nodejs.org)

2. **Rust Toolchain** - Required for building Tauri apps and tauri-driver

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. **Tauri CLI** - Install globally or as dev dependency

   ```bash
   npm install -g @tauri-apps/cli
   # or
   cargo install tauri-cli
   ```

### Platform-Specific Requirements

#### Windows

- **Microsoft Visual C++ Build Tools** - Download from [Microsoft Visual C++](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- **Edge WebDriver** - Only for the `external` provider, which manages it for you (see [Edge WebDriver Windows](./edge-webdriver-windows.md))

#### Linux

- **Tauri's build dependencies** - See [Tauri's Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux).

- **WebKitWebDriver** - Only for the `external` and `crabnebula` providers. The default `embedded` provider doesn't need it.

  ```bash
  # Ubuntu 26.04+, Debian 13+
  sudo apt-get install -y webkitgtk-webdriver

  # Ubuntu 24.04 and older, Debian 12
  sudo apt-get install -y webkit2gtk-driver

  # Fedora 40+
  sudo dnf install -y webkitgtk6.0

  # Arch Linux
  sudo pacman -S webkitgtk-6.0

  # Void Linux
  sudo xbps-install -y libwebkit2gtk41
  ```

- **Supported distributions** - Debian 12+, Ubuntu 22.04+, Fedora 40+, Arch Linux and Void Linux. See [Troubleshooting](./troubleshooting.md#webkitwebdriver-not-found-linux-only) for the ones that aren't.

- **A display** - See [Linux Without a Display](#linux-without-a-display) for CI and other headless machines.

#### macOS

✅ **Supported** - The default `embedded` provider needs no external driver. See [Plugin Setup](./plugin-setup.md) for the plugin it needs.

## Setting Up a Tauri App

### Fastest Way: Use Tauri CLI

```bash
npm create tauri-app@latest
```

Follow the prompts and select your preferred frontend framework.

### Manual Setup

Create a minimal Tauri app:

```bash
mkdir my-tauri-app
cd my-tauri-app

# Create frontend (use any framework or plain HTML)
mkdir src
echo '<h1>Hello, Tauri!</h1>' > src/index.html

# Create Rust backend
cargo init --name my_app src-tauri
cd src-tauri

# Add Tauri to Cargo.toml
# [dependencies]
# tauri = { version = "2.9", features = ["shell-open"] }
# tauri-build = "2.0"
```

### Essential Files

Create the minimal required files for a Tauri app:

**`src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**`src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "my-app",
  "version": "0.1.0",
  "identifier": "com.mycompany.myapp",
  "build": {
    "frontendDist": "../src",
    "beforeDevCommand": "echo 'dev server running'",
    "beforeBuildCommand": "echo 'building frontend'"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "My App",
        "width": 800,
        "height": 600
      }
    ]
  }
}
```

**`src-tauri/Cargo.toml`** - Add:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-wdio = "1"
tauri-plugin-wdio-webdriver = "1"

[build-dependencies]
tauri-build = "2"
```

**`src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

## Tauri Plugin Setup

Your app needs two plugins: `tauri-plugin-wdio`, for mocking, `execute` and log capture, and `tauri-plugin-wdio-webdriver`, the WebDriver server the default `embedded` provider connects to. Both are in the `Cargo.toml` above. The WebDriver server plugin is only registered in debug builds, so release builds never start it.

### Complete Plugin Setup

1. **Already added to Cargo.toml** (see above)

2. **Register in `src-tauri/src/main.rs`**

```rust
fn main() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_wdio::init());

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

3. **Create `src-tauri/capabilities/default.json`**

```json
{
  "identifier": "default",
  "windows": [
    "main"
  ],
  "permissions": [
    "core:default",
    "core:window:default",
    "wdio:default",
    "wdio-webdriver:default"
  ]
}
```

4. **Import frontend plugin in `src/index.html`**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>My App</title>
  </head>
  <body>
    <h1>Hello, Tauri!</h1>

    <!-- Import WebdriverIO Tauri plugin (required for testing) -->
    <script type="module">
      import '@wdio/tauri-plugin';
    </script>
  </body>
</html>
```

For detailed plugin setup and troubleshooting, see [Plugin Setup](./plugin-setup.md).

## Building the Tauri App

Test a debug build: the WebDriver server plugin is only registered in debug builds, so a release build can't start a session with the default `embedded` provider.

```bash
npm run tauri build -- --debug
```

The binary is at `src-tauri/target/debug/my-app` (`my-app.exe` on Windows), named after your app in `Cargo.toml`.

A release build works with the `external` provider, and with `crabnebula` on Windows and Linux. To test a release build with `embedded`, register the WebDriver plugin behind a feature flag instead, as [Plugin Setup](./plugin-setup.md#should-i-include-the-plugin-in-production) shows for `tauri-plugin-wdio`.

## WebdriverIO Installation

### 1. Install WebdriverIO

```bash
npm install --save-dev @wdio/cli @wdio/tauri-service
```

### 2. Initialize Configuration

Use the WebdriverIO CLI setup wizard:

```bash
npx wdio config
```

Or manually create `wdio.conf.ts`:

```typescript
export const config = {
  runner: 'local',
  specs: ['./test/specs/**/*.spec.ts'],
  maxInstances: 1,

  // Tauri service configuration
  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath: './src-tauri/target/debug/my-app.exe', // Adjust for your OS/app name
        driverProvider: 'embedded', // Default — embedded WebDriver, no external drivers needed
        // driverProvider: 'external',  // Use external tauri-driver (explicit opt-in)
        // driverProvider: 'crabnebula',  // Use CrabNebula (requires paid API key)
      },
    ],
  ],

  // Capabilities
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: './src-tauri/target/debug/my-app.exe', // Path to built binary
      },
    },
  ],

  // Logging
  logLevel: 'info',
  bail: 0,
  baseUrl: 'http://localhost:4444',
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  // Test configuration
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
describe('My Tauri App', () => {
  it('should display hello world', async () => {
    // Wait for the app to fully load
    await browser.pause(500);

    // Find and check a heading
    const heading = await browser.$('h1');
    expect(await heading.getText()).toBe('Hello, Tauri!');
  });

  it('should execute Tauri commands', async () => {
    // Execute JavaScript in the Tauri frontend context with access to Tauri APIs
    const result = await browser.tauri.execute(({ core }) => {
      return core.invoke('get_platform_info');
    });

    console.log('Platform info:', result);
  });

  it('should mock Tauri commands', async () => {
    // Mock a Tauri command
    const mock = await browser.tauri.mock('get_user');
    await mock.mockReturnValue({ id: 1, name: 'Test User' });

    // Execute code that uses the mocked command
    const user = await browser.tauri.execute(({ core }) => {
      return core.invoke('get_user');
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

### Run in Watch Mode

```bash
npx wdio run wdio.conf.ts --watch
```

### Run with Debug Logging

```bash
npx wdio run wdio.conf.ts --logLevel debug
```

## Troubleshooting

### "Cannot find module '@wdio/tauri-plugin'"

The frontend plugin import is failing. Make sure:
1. Install the peer dependencies:

   ```bash
   npm install --save-dev @wdio/tauri-plugin
   ```

2. The import is in your HTML/JS entry point before tests run

### "tauri-driver not found" or "No driverProvider configured"

The service couldn't determine which driver to use, or couldn't find tauri-driver. Solutions:
1. **Use embedded provider** (no external driver needed):

   ```typescript
   driverProvider: 'embedded'
   ```

   Requires `tauri-plugin-wdio-webdriver` in your Tauri app. It is the default on every platform when `driverProvider` is unset.

2. **Install tauri-driver manually** (if using `driverProvider: 'external'`):

   ```bash
   cargo install tauri-driver
   ```

3. **Or enable auto-install** in `wdio.conf.ts`:

   ```typescript
   driverProvider: 'external',
   autoInstallTauriDriver: true
   ```

### "Application not found at path"

The `appBinaryPath` is wrong. Verify:
1. You built a debug binary: `npm run tauri build -- --debug`
2. The path exists: `./src-tauri/target/debug/my-app.exe`
3. Update the path in `wdio.conf.ts` if needed

### Tests timeout on Windows

Edge WebDriver version mismatch. The service auto-manages this, but if issues persist:
1. See [Edge WebDriver (Windows)](./edge-webdriver-windows.md)
2. Check your Edge version: Settings → About Microsoft Edge
3. Verify the driver version matches

### "Test failed with Firefox" Error

Make sure you're using `browserName: 'tauri'` in capabilities, not other browsers.

## Next Steps

1. **Add more tests** - See [Usage Examples](./usage-examples.md) for patterns
2. **Advanced features** - Read about [Mocking](./api-reference.md#mock-functions) and [Logging](./log-forwarding.md)
3. **Configure the service** - See [Configuration](./configuration.md) for all options
4. **Debug issues** - Check [Troubleshooting](./troubleshooting.md)

## Common Patterns

### Test Custom Tauri Commands

```typescript
it('should call custom commands', async () => {
  const result = await browser.tauri.execute(({ core }) => {
    return core.invoke('my_custom_command', { param: 'value' });
  });

  expect(result).toBeDefined();
});
```

### Capture Logs

Enable log capture in `wdio.conf.ts`:

```typescript
services: [['@wdio/tauri-service', {
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
    browserName: 'tauri',
    'tauri:options': {
      application: './src-tauri/target/debug/my-app.exe',
    },
  },
  {
    browserName: 'tauri',
    'tauri:options': {
      application: './src-tauri/target/debug/my-app.exe',
    },
  },
],
```

### CI/CD Integration

Example GitHub Actions workflow:

```yaml
name: E2E Tests
on: [ push, pull_request ]

jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ ubuntu-latest, windows-latest, macos-latest ]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: "22"
      - uses: dtolnay/rust-toolchain@stable

      - name: Install Linux dependencies
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev xvfb

      - name: Install dependencies
        run: npm install

      - name: Build Tauri app
        run: npm run tauri build -- --debug

      - name: Run tests
        run: npm run test:e2e
```

On WebdriverIO v9, the Linux tests also need `xvfb-run`; see [Linux Without a Display](#linux-without-a-display).

### Linux Without a Display

Install Xvfb or Weston:

```bash
sudo apt-get install -y xvfb              # Debian/Ubuntu, or: weston
sudo dnf install -y xorg-x11-server-Xvfb  # Fedora, or: weston
```

With WebdriverIO v10 you don't need a wrapper or any config: when no display is set, WebdriverIO starts a display server before the service starts your app, Weston if it's installed and Xvfb otherwise. The `embedded` and `external` providers are tested on both. If your app has X11-only dependencies, set `displayServer: 'xvfb'` so WebdriverIO doesn't pick Weston:

```typescript
export const config = {
  displayServer: 'xvfb',
  // ...
};
```

With WebdriverIO v9, its virtual display only covers the test workers, not the service that starts your app, so wrap the whole run:

```bash
xvfb-run -a npm run test:e2e
```

## See Also

- [Configuration Reference](./configuration.md)
- [API Reference](./api-reference.md)
- [Plugin Setup](./plugin-setup.md)
- [Troubleshooting](./troubleshooting.md)
- [WebdriverIO Documentation](https://webdriver.io/docs)
- [Tauri Documentation](https://v2.tauri.app)
