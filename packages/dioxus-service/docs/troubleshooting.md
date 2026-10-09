# Troubleshooting

Solutions for common issues when testing Dioxus applications with WebdriverIO.

## Bridge Issues

### "Embedded WebDriver server did not become ready", "Bridge not available", or execute always returns undefined

The embedded driver is not wired into your app. It runs the WebDriver server the service connects to and installs the `wdio-dioxus-bridge` crate.

**Check 1: Embedded driver crate in dependencies**

```toml
# Cargo.toml
[dependencies]
wdio-dioxus-embedded-driver = "1"
```

**Check 2: Embedded driver installed in `main.rs`**

```rust
fn main() {
    let mut config = dioxus::desktop::Config::new();
    #[cfg(debug_assertions)]
    {
        config = wdio_dioxus_embedded_driver::install(config);
    }
    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}
```

`wdio_dioxus_bridge::install(config)` on its own doesn't start the WebDriver server, so the service times out waiting for it.

**Check 3: Debug build used for testing**

The driver and bridge are only compiled in debug builds. Ensure you are using `dx build --desktop` (not `dx build --desktop --release`) and the binary path in your config points to the `debug` output, not the `release` one.

**Check 4: Port is free**

The embedded driver listens on port `4444` by default. If another process already holds that port, the service can't reach your app. Stop the other process, or set `embeddedPort` in the service options.

**Check 5: Rebuild application**

```bash
cargo clean
dx build --desktop
```

See [App Setup](./app-setup.md) for the complete installation guide.

### Styles or images are missing during tests

The app was built with `cargo build`. Files loaded with `asset!()` are only bundled by `dx`; in a plain `cargo build` binary their paths point at files that don't exist, so they fail to load. Build with `dx build --desktop` and point `appBinaryPath` or `dioxus:options.application` at the `dx` output (see [App Setup](./app-setup.md#step-3-build-in-debug-mode) for the path on each platform).

### Compilation errors from `wdio-dioxus-bridge`

`wdio-dioxus-bridge` tracks the latest Dioxus release; the exact version it supports is its own `dioxus-desktop` dependency — see the bridge's [dependencies on crates.io](https://crates.io/crates/wdio-dioxus-bridge).

1. Update your Rust toolchain: `rustup update`
2. Clear the Cargo cache: `cargo clean && dx build --desktop`
3. Pin your `dioxus` to the same minor as the bridge's `dioxus-desktop` dependency (link above)

---

## Application Issues

### "Application not found at path"

The Dioxus app binary cannot be found.

**Solution 1: Verify Binary Exists**

```bash
ls -la target/dx/my_app/debug/linux/app/my_app                      # Linux
ls -la target/dx/my_app/debug/macos/MyApp.app/Contents/MacOS/my_app  # macOS
dir target\dx\my_app\debug\windows\app\my_app.exe                   # Windows
```

**Solution 2: Build the Application**

```bash
dx build --desktop  # Debug build (driver and bridge active)
```

`dx` prints the bundle path when the build finishes.

**Solution 3: Use Correct Path**

```typescript
services: [['@wdio/dioxus-service', {
  appBinaryPath: './target/dx/my_app/debug/linux/app/my_app',   // Linux
  // or
  appBinaryPath: './target/dx/my_app/debug/macos/MyApp.app/Contents/MacOS/my_app',   // macOS
  // or
  appBinaryPath: './target/dx/my_app/debug/windows/app/my_app.exe',  // Windows
}]]
```

**Solution 4: Use Absolute Path**

```typescript
import path from 'path';

services: [['@wdio/dioxus-service', {
  appBinaryPath: path.resolve('./target/dx/my_app/debug/linux/app/my_app'),
}]]
```

### Debug vs. Release Build Mismatch

The driver and bridge are only compiled into debug builds. If you point `appBinaryPath` at a release binary, they will not be present and the service can't connect.

Always use `dx build --desktop` (without `--release`) for testing.

### Commands Timing Out

**Solution 1: Increase Start Timeout**

```typescript
services: [['@wdio/dioxus-service', {
  startTimeout: 60000,  // Allow more time for app to start
}]]
```

**Solution 2: Increase Status Poll Timeout**

For slow CI environments:

```typescript
services: [['@wdio/dioxus-service', {
  statusPollTimeout: 5000,  // Default: 2000
}]]
```

**Solution 3: Wait for App to Be Ready**

```typescript
it('should wait for app', async () => {
  await browser.pause(1000);
  const element = await browser.$('button');
  expect(element).toBeDefined();
});
```

### "Port already in use"

**Solution 1: Change Embedded Port**

```typescript
services: [['@wdio/dioxus-service', {
  embeddedPort: 4446,  // Instead of default 4445
}]]
```

**Solution 2: Kill Process Using Port**

```bash
# Linux/macOS
lsof -ti:4445 | xargs kill -9

# Windows (PowerShell)
Get-Process -Id (Get-NetTCPConnection -LocalPort 4445).OwningProcess | Stop-Process -Force
```

---

## Mocking Issues

### Mocking Doesn't Work

**Check 1: Mock Set Up Before Call**

```typescript
// Correct — mock first, then call
const mock = await browser.dioxus.mock('my_command');
await mock.mockReturnValue('test');
await browser.dioxus.execute(({ invoke }) => invoke('my_command'));

// Wrong — calling before mocking
await browser.dioxus.execute(({ invoke }) => invoke('my_command'));
const mock = await browser.dioxus.mock('my_command');
```

**Check 2: Correct Command Name**

```typescript
// Command name must match exactly what your app passes to invoke()
const mock = await browser.dioxus.mock('get_user');
await mock.mockReturnValue({ id: 1 });
```

---

## Multi-Window Issues

### Window Label Not Found

**Error:** `window label "window-1" not found. Available: main`

**Solution:**

```typescript
// Debug: list available windows
const windows = await browser.dioxus.listWindows();
console.log('Available:', windows);
```

Verify the window label matches exactly (case-sensitive) and the window is created before your test runs.

---

## Linux Headless Issues

### "X11 connection refused" or "Cannot open display"

```bash
# Install Xvfb
sudo apt-get install -y xvfb

# Run tests headless
xvfb-run -a npx wdio run wdio.conf.ts
```

---

## CI/CD Issues

### Tests Fail in CI But Pass Locally

**Common Causes:**

1. **Missing Linux build dependencies**
   ```bash
   sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev
   ```

2. **Display server missing on Linux CI**
   ```bash
   xvfb-run -a npm run test:e2e
   ```

3. **Release binary used instead of debug**
   - Ensure `dx build --desktop` (not `dx build --desktop --release`) is run in CI
   - Verify the binary path in `wdio.conf.ts` points to the `debug` output, not the `release` one

4. **Environment Variables**
   ```bash
   APP_BINARY="./target/dx/my_app/debug/linux/app/my_app" npm run test:e2e
   ```

### macOS: Commands Stall or Time Out on CI

On a headless macOS runner, WKWebView can suspend the page of a window that isn't visible. The bridge runs its command loop in the page, so commands stall until they time out, usually between specs.

Dioxus doesn't yet let apps turn this off. [DioxusLabs/dioxus#5587](https://github.com/DioxusLabs/dioxus/pull/5587) adds `Config::with_background_throttling`. Until it's released, you can patch `dioxus-desktop` with that change, as this repo's e2e app does (see the `[patch.crates-io]` block in [`fixtures/e2e-apps/dioxus/Cargo.toml`](../../../fixtures/e2e-apps/dioxus/Cargo.toml)), and disable throttling only under automation:

```rust
#[cfg(debug_assertions)]
{
    if wdio_dioxus_embedded_driver::automation::is_requested() {
        config = config.with_background_throttling(
            dioxus::desktop::wry::BackgroundThrottlingPolicy::Disabled,
        );
    }
    config = wdio_dioxus_embedded_driver::install(config);
}
```

---

## Debug Mode

### Enable Debug Logging

```typescript
services: [['@wdio/dioxus-service', {
  captureBackendLogs: true,
  captureFrontendLogs: true,
}]]
```

### Verbose Test Output

```bash
npx wdio run wdio.conf.ts --logLevel debug
```

---

## Getting Help

If you're still stuck:

1. **Check [Configuration](./configuration.md)** for all available options
2. **Review [Usage Examples](./usage-examples.md)** for correct patterns
3. **See [App Setup](./app-setup.md)** for what the app needs
4. **Check [Platform Support](./platform-support.md)** for platform-specific issues
5. **Enable debug logging** to see detailed output
6. **Open a discussion** in the [GitHub Discussions](https://github.com/webdriverio/desktop-mobile/discussions)
