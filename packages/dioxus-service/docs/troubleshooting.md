# Troubleshooting

Solutions for common issues when testing Dioxus applications with WebdriverIO.

## Bridge Issues

### "Bridge not available" or execute always returns undefined

The `wdio-dioxus-bridge` crate is not wired into your app.

**Check 1: Bridge crate in dependencies**

```toml
# Cargo.toml
[dependencies]
wdio-dioxus-bridge = "1"
```

**Check 2: Bridge installed in `main.rs`**

```rust
fn main() {
    let mut config = dioxus::desktop::Config::new();
    #[cfg(debug_assertions)]
    {
        config = wdio_dioxus_bridge::install(config);
    }
    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}
```

**Check 3: Debug build used for testing**

The bridge is only compiled in debug builds. Ensure you are using `cargo build` (not `cargo build --release`) and the binary path in your config points to `target/debug/my_app`, not `target/release/my_app`.

**Check 4: Rebuild application**

```bash
cargo clean
cargo build
```

See [Bridge Setup](./plugin-setup.md) for the complete installation guide.

---

## Driver Installation Issues

### "wdio-dioxus-driver not found" (`'external'` provider, Windows)

The service cannot find the wdio-dioxus-driver executable.

**Solution 1: Enable Auto-Installation**

```typescript
services: [['@wdio/dioxus-service', {
  driverProvider: 'external',
  autoInstallDioxusDriver: true,
}]]
```

**Solution 2: Manual Installation**

```bash
cargo install wdio-dioxus-driver
```

**Solution 3: Specify Path Manually**

```typescript
services: [['@wdio/dioxus-service', {
  driverProvider: 'external',
  dioxusDriverPath: '/custom/path/wdio-dioxus-driver',
}]]
```

### "MSEdgeDriver not found" (Windows, `'external'` provider)

**Solution 1: Enable Auto-Download**

```typescript
services: [['@wdio/dioxus-service', {
  driverProvider: 'external',
  autoDownloadEdgeDriver: true,  // Default: true
}]]
```

**Solution 2: Manual Download**

1. Check your WebView2 version (right-click your binary → Properties → Details)
2. Download matching MSEdgeDriver from [Microsoft Edge WebDriver](https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/)
3. Add to PATH

See [Edge WebDriver (Windows)](./edge-webdriver-windows.md) for detailed setup.

---

## Provider Issues

### "external provider not supported on Linux"

`'external'` is blocked on Linux in v1 — an upstream Dioxus PR is pending. Use `driverProvider: 'embedded'` instead.

```typescript
services: [['@wdio/dioxus-service', {
  driverProvider: 'embedded',  // The only supported option on Linux
}]]
```

### "external provider not supported on macOS"

`'external'` is not supported on macOS. Use `driverProvider: 'embedded'`.

### "No driverProvider configured" or service fails to start

Set `driverProvider` explicitly:

```typescript
services: [['@wdio/dioxus-service', {
  driverProvider: 'embedded',  // Recommended everywhere
}]]
```

---

## Application Issues

### "Application not found at path"

The Dioxus app binary cannot be found.

**Solution 1: Verify Binary Exists**

```bash
ls -la target/debug/my_app         # Linux/macOS
dir target\debug\my_app.exe        # Windows
```

**Solution 2: Build the Application**

```bash
cargo build  # Debug build (bridge active)
```

**Solution 3: Use Correct Path**

```typescript
services: [['@wdio/dioxus-service', {
  appBinaryPath: './target/debug/my_app',   // Linux/macOS
  // or
  appBinaryPath: './target/debug/my_app.exe',  // Windows
}]]
```

**Solution 4: Use Absolute Path**

```typescript
import path from 'path';

services: [['@wdio/dioxus-service', {
  appBinaryPath: path.resolve('./target/debug/my_app'),
}]]
```

### Debug vs. Release Build Mismatch

The bridge is only compiled into debug builds. If you point `appBinaryPath` at a release binary, the bridge will not be present and `browser.dioxus.execute()` will fail.

Always use `cargo build` (without `--release`) for testing.

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

**Error:** `Window label "settings" not found. Available windows: main`

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
   - Ensure `cargo build` (not `cargo build --release`) is run in CI
   - Verify the binary path in `wdio.conf.ts` points to `target/debug/`, not `target/release/`

4. **Environment Variables**
   ```bash
   APP_BINARY="./target/debug/my_app" npm run test:e2e
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
3. **See [Bridge Setup](./plugin-setup.md)** for bridge requirements
4. **Check [Platform Support](./platform-support.md)** for platform-specific issues
5. **Enable debug logging** to see detailed output
6. **Open a discussion** in the [GitHub Discussions](https://github.com/webdriverio/desktop-mobile/discussions)
