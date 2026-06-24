# Troubleshooting

Solutions for common issues when testing Tauri applications with WebdriverIO.

## Driver Installation Issues

### "tauri-driver not found"

The service cannot find the tauri-driver executable.

**Solution 1: Enable Auto-Installation**

```typescript
services: [
  ['@wdio/tauri-service', {
    autoInstallTauriDriver: true, // Requires Rust/cargo
  }]
]
```

**Solution 2: Manual Installation**

```bash
# Install tauri-driver via cargo
cargo install tauri-driver

# Verify installation
which tauri-driver  # macOS/Linux
where tauri-driver  # Windows
```

**Solution 3: Specify Path Manually**

If installed in a non-standard location:

```typescript
services: [
  ['@wdio/tauri-service', {
    tauriDriverPath: '/custom/path/tauri-driver'
  }]
]
```

### "WebKitWebDriver not found" (Linux only)

WebKitWebDriver is not installed on your Linux system.

**Supported Distributions**

Install for your distribution:

```bash
# Debian/Ubuntu
sudo apt-get install -y webkit2gtk-driver

# Fedora 40+
sudo dnf install -y webkit2gtk-driver

# Arch Linux
sudo pacman -S webkit2gtk-4.1

# Void Linux
sudo xbps-install -y webkit2gtk-devel
```

**Unsupported Distributions**

- **Alpine Linux**: Cannot build Tauri apps (musl incompatibility). Use Ubuntu, Debian, Fedora, or Arch instead.
- **CentOS/RHEL**: Stream 9 has glib too old (requires 2.70+), Stream 10 removed WebKitGTK. Use **Fedora 40+** instead.
- **openSUSE/SUSE**: No official WebKitWebDriver package. Building from source is complex and not recommended.

### "MSEdgeDriver not found" (Windows only)

The Edge WebDriver for Windows is not found.

**Solution 1: Enable Auto-Download**

```typescript
services: [
  ['@wdio/tauri-service', {
    autoDownloadEdgeDriver: true  // Default: true
  }]
]
```

**Solution 2: Manual Download**

1. Check your WebView2 version:
   - Build your app: `cargo build --release`
   - Right-click the .exe → Properties → Details
   - Note the "File version" (e.g., 143.0.3650.139)

2. Download matching MSEdgeDriver from [Microsoft Edge WebDriver](https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/)

3. Add to PATH or specify in config:

```typescript
services: [
  ['@wdio/tauri-service', {
    autoDownloadEdgeDriver: false
  }]
]
```

See [Edge WebDriver (Windows)](./edge-webdriver-windows.md) for detailed setup.

## Plugin Issues

### "Tauri plugin not available"

The plugin required for testing is not detected.

**Check 1: Plugin Registered in Rust**

Edit `src-tauri/src/main.rs`:

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_wdio::init())  // This line required
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Check 2: Frontend Import Present**

Ensure the import is in your HTML or main JS file:

```html
<script type="module">
  import '@wdio/tauri-plugin';
</script>
```

**Check 3: withGlobalTauri Enabled**

Edit `src-tauri/tauri.conf.json`:

```json
{
  "app": {
    "withGlobalTauri": true
  }
}
```

**Check 4: Permissions Configured**

Edit `src-tauri/capabilities/default.json`:

```json
{
  "permissions": [
    "core:default",
    "core:window:default",
    "wdio:default"
  ]
}
```

**Check 5: Rebuild Application**

```bash
cd src-tauri
cargo clean
cargo build --release
```

See [Plugin Setup](./plugin-setup.md) for complete installation guide.

### "window.wdioTauri is undefined"

The frontend plugin didn't initialize.

**Solution 1: Add Delay for Initialization**

```typescript
it('should have plugin', async () => {
  // Wait for plugin to initialize
  await browser.pause(500);

  const hasPlugin = await browser.tauri.execute(() => {
    return typeof window.wdioTauri !== 'undefined';
  });

  expect(hasPlugin).toBe(true);
});
```

**Solution 2: Check Import Timing**

Make sure the plugin is imported **before** tests run:
- In `index.html` for standard Tauri apps
- In your main framework entry point (main.ts, main.js)
- Not inside an iframe or separate context

**Solution 3: Verify Plugin Loaded**

```typescript
it('should verify plugin is available', async () => {
  const available = await browser.tauri.execute(() => {
    return 'wdioTauri' in window;
  });

  expect(available).toBe(true);
});
```

### Mocking Doesn't Work

Commands aren't being mocked.

**Check 1: Plugin is Available**

```typescript
const available = await browser.tauri.execute(() => {
  return 'wdioTauri' in window;
});

if (!available) {
  throw new Error('Plugin not available - cannot mock');
}
```

**Check 2: Mock Set Up Before Call**

```typescript
// ✅ Correct - mock first, then call
const mock = await browser.tauri.mock('my_command');
await mock.mockReturnValue('test');
await browser.tauri.execute(({ core }) => core.invoke('my_command'));

// ❌ Wrong - calling before mocking
await browser.tauri.execute(({ core }) => core.invoke('my_command'));
const mock = await browser.tauri.mock('my_command');
```

**Check 3: Use Correct Command Name**

```typescript
// Make sure command name matches exactly
const mock = await browser.tauri.mock('get_user');  // Must match your command name
await mock.mockReturnValue({ id: 1 });
```

## Application Issues

### "Application not found at path"

The Tauri app binary cannot be found.

**Solution 1: Verify Binary Exists**

```bash
# Windows
if exist "src-tauri\target\release\my-app.exe" echo "Found"

# Linux/macOS
ls -la src-tauri/target/release/my-app
```

**Solution 2: Build the Application**

```bash
cd src-tauri
cargo build --release
```

**Solution 3: Use Correct Path**

Update `wdio.conf.ts`:

```typescript
services: [
  ['@wdio/tauri-service', {
    appBinaryPath: './src-tauri/target/release/my-app.exe',  // Windows
    // or
    appBinaryPath: './src-tauri/target/release/my-app',     // Linux/macOS
  }]
]
```

**Solution 4: Use Absolute Path**

```typescript
import path from 'path';

services: [
  ['@wdio/tauri-service', {
    appBinaryPath: path.resolve('./src-tauri/target/release/my-app.exe')
  }]
]
```

### Commands Timing Out

Operations take too long or timeout unexpectedly.

**Solution 1: Increase Command Timeout**

```typescript
services: [
  ['@wdio/tauri-service', {
    commandTimeout: 60000  // 60 seconds instead of default 10s
  }]
]
```

**Solution 2: Increase Start Timeout**

```typescript
services: [
  ['@wdio/tauri-service', {
    startTimeout: 60000  // Allow more time for app to start
  }]
]
```

**Solution 3: Wait for App to Be Ready**

```typescript
it('should wait for app', async () => {
  // Give app time to fully initialize
  await browser.pause(1000);

  // Then run test
  const element = await browser.$('button');
  expect(element).toBeDefined();
});
```

**Solution 4: Check App Logs**

Enable logging to see what's happening:

```typescript
services: [
  ['@wdio/tauri-service', {
    captureBackendLogs: true,
    captureFrontendLogs: true,
    logLevel: 'debug'
  }]
]
```

### "Port already in use"

Multiple tests are conflicting on the same port.

**Solution 1: Change tauri-driver Port**

```typescript
services: [
  ['@wdio/tauri-service', {
    tauriDriverPort: 4445  // Instead of default 4444
  }]
]
```

**Solution 2: Auto-Assign Ports for Multiremote**

```typescript
maxInstances: 3  // Each worker gets unique port (4444, 4445, 4446)
```

**Solution 3: Kill Process Using Port**

```bash
# Linux/macOS
lsof -ti:4444 | xargs kill -9

# Windows (PowerShell)
Get-Process -Id (Get-NetTCPConnection -LocalPort 4444).OwningProcess | Stop-Process -Force
```

## Platform Issues

### Embedded WebDriver server never becomes ready

`'embedded'` is the default provider on every platform, and it requires `tauri-plugin-wdio-webdriver` in your app. If the plugin is missing or not registered, the embedded server never starts and the session times out waiting for it.

**Solution 1: Add the embedded plugin (recommended)**

1. Install `tauri-plugin-wdio-webdriver` in your Tauri app:
   ```bash
   cd src-tauri && cargo add tauri-plugin-wdio-webdriver
   ```
2. Register it in your Rust code (debug builds) and keep the default embedded provider:
   ```typescript
   services: [['@wdio/tauri-service', {
     driverProvider: 'embedded',
   }]]
   ```
   The embedded server listens on port 4445 by default; override it with the `embeddedPort` option or the `TAURI_WEBDRIVER_PORT` env var if needed.

**Solution 2: Use the external tauri-driver instead**

```typescript
services: [['@wdio/tauri-service', {
  driverProvider: 'external',
  autoInstallTauriDriver: true,
}]]
```

See [Platform Support](./platform-support.md) for per-platform details.

### macOS: Embedded WebDriver Not Ready

macOS has no external WebDriver driver, so the `embedded` provider (the default) or `crabnebula` is your only option there. If `tauri-plugin-wdio-webdriver` isn't installed, the embedded server never starts and the service times out waiting for it.

**Solution:** Ensure `tauri-plugin-wdio-webdriver` is installed and registered:

```rust
#[cfg(debug_assertions)]
let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
```

See [Plugin Setup](./plugin-setup.md) for the full setup guide.

---

## Multi-Window Issues

### Window Label Not Found

**Error:** `Window label "settings" not found. Available windows: main, dialog`

**Why this happens:** The window label you specified doesn't exist in your Tauri application.

**Solutions:**
1. Check available windows with `browser.tauri.listWindows()`
2. Verify the window label matches exactly (case-sensitive)
3. Ensure the window is created before your test runs

```typescript
// Debug: List available windows
const windows = await browser.tauri.listWindows();
console.log('Available:', windows);
```

### Per-Call WindowLabel Not Taking Effect

**Issue:** Using `{ windowLabel: 'popup' }` in execute call still uses the main window.

**Why this happens:** The sentinel is required to distinguish options from script arguments. Plain objects are treated as user arguments, not options.

**Solutions:**
1. Verify the window exists: `const windows = await browser.tauri.listWindows();`
2. Use `browser.tauri.switchWindow(label)` to change the session default
3. Check that @wdio/tauri-plugin is installed and registered in your Tauri app
4. Use `withExecuteOptions()` wrapper for per-call windowLabel:

```typescript
import { withExecuteOptions } from '@wdio/tauri-service';

const result = await browser.tauri.execute(
  (tauri) => tauri.core.invoke('get_data'),
  withExecuteOptions({ windowLabel: 'popup' })
);
```

```typescript
// wdio.conf.ts
export const config = {
  capabilities: [{
    'wdio:tauriServiceOptions': {
      driverProvider: 'embedded',
    },
  }],
};
```

---

## Debug Mode

### Enable Debug Logging

Get more detailed information about what the service is doing:

```typescript
services: [
  ['@wdio/tauri-service', {
    logLevel: 'debug',  // Verbose logging
    commandTimeout: 60000
  }]
]
```

### Verbose Test Output

```bash
npx wdio run wdio.conf.ts --logLevel debug
```

### Check Service Status

```typescript
it('should check service', async () => {
  const service = browser.getService('@wdio/tauri-service');
  console.log('Service:', service);
});
```

## Performance Issues

### Tests Running Slow

**Solution 1: Disable Unnecessary Log Capture**

```typescript
services: [
  ['@wdio/tauri-service', {
    captureBackendLogs: false,
    captureFrontendLogs: false,  // Logs add overhead
  }]
]
```

**Solution 2: Increase Log Level**

```typescript
services: [
  ['@wdio/tauri-service', {
    backendLogLevel: 'warn',  // Skip debug/info logs
    frontendLogLevel: 'warn',
  }]
]
```

**Solution 3: Run Tests Serially**

```typescript
// wdio.conf.ts
export const config = {
  maxInstances: 1,  // Run one test at a time
};
```

## CI/CD Issues

### Tests Fail in CI But Pass Locally

**Common Causes:**

1. **Missing WebDriver on CI**
   - Install webkit2gtk-driver on Linux CI
   - Download MSEdgeDriver on Windows CI

2. **Display Server Missing on Linux CI**
   - Use Xvfb for headless testing:
     ```bash
     xvfb-run -a npm run test:e2e
     ```

3. **Different Binary on CI**
   - Ensure build happens before tests: `cargo build --release`
   - Verify binary path matches CI environment

4. **Environment Variables**
   - Set `APP_BINARY` or similar if using env-based paths:
     ```bash
     APP_BINARY="./src-tauri/target/release/my-app" npm run test:e2e
     ```

### Example GitHub Actions Setup

```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - uses: dtolnay/rust-toolchain@stable

      - name: Install webkit2gtk-driver
        run: sudo apt-get install -y webkit2gtk-driver

      - name: Install dependencies
        run: npm install

      - name: Build Tauri app
        run: npm run tauri build

      - name: Run tests with Xvfb
        run: xvfb-run -a npm run test:e2e
```

## Getting Help

If you're still stuck:

1. **Check [Configuration](./configuration.md)** for all available options
2. **Review [Usage Examples](./usage-examples.md)** for correct patterns
3. **See [Plugin Setup](./plugin-setup.md)** for plugin requirements
4. **Check [Platform Support](./platform-support.md)** for platform-specific issues
5. **Enable debug logging** to see detailed output
6. **Open a discussion** in the [GitHub Discussions](https://github.com/webdriverio/desktop-mobile/discussions) or [WDIO forum](https://github.com/webdriverio/webdriverio/discussions)
