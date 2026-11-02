# Edge WebDriver Management for Windows

## Overview

On Windows, Tauri applications use Microsoft Edge WebView2, which requires `msedgedriver.exe` for WebDriver automation. The tauri-service automatically handles Edge WebDriver version matching to prevent version mismatch errors.

## The Problem

Tauri tests fail on Windows when your Edge browser version doesn't match the installed msedgedriver version:

```
Error: This version of Microsoft Edge WebDriver only supports Microsoft Edge version 144.
Current browser version is 143.0.3650.139
```

## The Solution

The tauri-service automatically:
1. **Detects** your Edge browser version from Windows registry
2. **Checks** if a matching msedgedriver.exe exists
3. **Downloads** the correct version if needed (enabled by default)
4. **Passes** the matching driver to tauri-driver by path, unless you set `nativeDriverPath`

## Configuration

msedgedriver is machine-wide, so `autoDownloadEdgeDriver` and `edgeDriverVersion` are service-level options only. You can't set them in a capability.

### Auto-Download (Recommended)

By default, auto-download is **enabled**. Just use the service normally:

```javascript
// wdio.conf.js
export const config = {
  services: [
    [
      'tauri',
      {
        application: './path/to/your-app.exe',
        // autoDownloadEdgeDriver: true (default)
      },
    ],
  ],
};
```

### Manual Management

Disable auto-download if you prefer to manage drivers yourself:

```javascript
export const config = {
  services: [
    [
      'tauri',
      {
        application: './path/to/your-app.exe',
        autoDownloadEdgeDriver: false,
      },
    ],
  ],
};
```

With auto-download disabled, you must ensure msedgedriver matches your Edge version manually.

## How It Works

### 1. Version Detection

The service detects Edge version from:
- Windows Registry: `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}`
- WMIC query: `wmic datafile where name="C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" get Version`

### 2. Driver Check

Checks if msedgedriver.exe in PATH matches the detected Edge version (major version comparison).

### 3. Download & Install

If mismatch detected:
- Downloads msedgedriver from `https://msedgedriver.azureedge.net/{version}/`
- Caches in temp directory: `%TEMP%\msedgedriver\{majorVersion}\`
- Passes it to tauri-driver by path, so a `PATH` in the app's `env` can't hide it. A `nativeDriverPath` you set takes precedence.

## Fixed-version WebView2 runtimes

By default the service matches msedgedriver to the machine's **Evergreen** WebView2 runtime (read from the registry). But a Tauri app can ship against a **fixed-version WebView2 runtime** — a supported distribution mode (`bundle.windows.webviewInstallMode: "fixedRuntime"`, or the `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` environment variable). When the app renders with a fixed runtime that differs from the installed Evergreen, matching against Evergreen downloads the wrong driver and session creation fails:

```
session not created: This version of Microsoft Edge WebDriver only supports Microsoft Edge version 150
Current browser version is 149.0.4022.98 ... tauri-e2e-app.exe
```

The service resolves the target version in this precedence order:
1. **Explicit pin** — the `edgeDriverVersion` service option, or the `EDGEDRIVER_VERSION` environment variable, is used as the exact msedgedriver version verbatim (a CI escape hatch for the next Evergreen drift that breaks automation).
2. **Fixed-version runtime folder** — if `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` is set, the runtime version is read from the `msedgewebview2.exe` in that folder, and the driver is matched to it. This is read from the first capability's `env` option (or the service-level one) first, then `process.env`, which is what the app gets.
3. **Evergreen** — the installed runtime from the registry (the default, and the canary that catches runtime regressions).

### Pin the exact driver version

```javascript
services: [
  [
    'tauri',
    {
      application: './dist/my-app.exe',
      edgeDriverVersion: '149.0.4022.98', // or set EDGEDRIVER_VERSION in the environment
    },
  ],
];
```

### Drive a fixed-version runtime

```javascript
services: [
  [
    'tauri',
    {
      application: './dist/my-app.exe',
      env: {
        // The app renders with this runtime; the driver is matched to it automatically.
        WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: 'C:\\path\\to\\fixed-version-runtime',
      },
    },
  ],
];
```

> Windows-only. macOS (WKWebView) and Linux (WebKitGTK) have no separately-versioned driver to mismatch.

## Troubleshooting

### "Could not detect Edge version"

**Cause**: Edge not installed or registry keys missing

**Solution**: Install Microsoft Edge from https://www.microsoft.com/edge

### "Failed to download msedgedriver"

**Causes**:
- Network/proxy issues
- Microsoft's CDN temporarily unavailable
- Invalid Edge version format

**Solutions**:
1. Check internet connection and proxy settings
2. Retry - CDN may be temporarily down
3. Manual download from https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/
4. Place `msedgedriver.exe` in PATH

### "Version mismatch" even after download

**Cause**: `nativeDriverPath` points at a different msedgedriver.exe. The service uses it over the driver it checked.

**Solution**: Remove `nativeDriverPath`, or point it at a driver that matches your WebView2 version

### CI/GitHub Actions Issues

**Symptom**: Download works locally but fails in CI

**Causes**:
- GitHub Actions runners may have outdated Edge
- Network restrictions

**Solutions**:
```yaml
# .github/workflows/test.yml
- name: Update Edge (if needed)
  if: runner.os == 'Windows'
  run: |
    choco upgrade microsoft-edge -y

- name: Run tests
  run: pnpm test:e2e
```

## Platform Behavior

- **Windows**: Edge driver check runs automatically
- **Linux**: Skipped (Tauri uses WebKitGTK)
- **macOS**: Skipped (Tauri uses WKWebView)

## API Reference

### Service Options

Both options are service-level only, on `TauriServiceGlobalOptions`.

```typescript
interface TauriServiceGlobalOptions {
  /**
   * Automatically download and configure matching msedgedriver on Windows
   * @default true
   * @platform Windows only
   */
  autoDownloadEdgeDriver?: boolean;
  /**
   * Pin the exact msedgedriver version to download, bypassing runtime detection.
   * Also honoured via the EDGEDRIVER_VERSION environment variable.
   * @platform Windows only
   */
  edgeDriverVersion?: string;
}
```

### Example Configurations

#### Default (Auto-Download Enabled)

```javascript
services: [
  [
    'tauri',
    {
      application: './dist/my-app.exe',
    },
  ],
];
```

#### Explicit Configuration

```javascript
services: [
  [
    'tauri',
    {
      application: './dist/my-app.exe',
      autoDownloadEdgeDriver: true,
      tauriDriverPort: 4444,
    },
  ],
];
```

#### Disable Auto-Download

```javascript
services: [
  [
    'tauri',
    {
      application: './dist/my-app.exe',
      autoDownloadEdgeDriver: false,
    },
  ],
];
```

## Manual Driver Management

If you disable auto-download, ensure msedgedriver matches your Edge version:

### Check Edge Version

```powershell
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}" /v pv
```

### Download Matching Driver

1. Visit https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/
2. Download version matching your Edge major version
3. Extract `msedgedriver.exe`
4. Add to PATH or place in project directory

### Verify Installation

```powershell
msedgedriver.exe --version
# Should output: MSEdgeDriver 143.x.xxxx.xx
```

## Development Notes

### File Structure

- `src/edgeDriverManager.ts` - Edge driver detection and download logic
- `src/launcher.ts` - Integration point in onPrepare hook
- `src/types.ts` - TypeScript interfaces

### Cache Location

Downloaded drivers are cached at:
```
%TEMP%\msedgedriver\{majorVersion}\msedgedriver.exe
```

Example: `C:\Users\YourName\AppData\Local\Temp\msedgedriver\143\msedgedriver.exe`

### Logging

Enable debug logs to troubleshoot:
```javascript
export const config = {
  logLevel: 'debug',
  services: ['tauri'],
};
```

Look for logs prefixed with `[tauri-service:edge-driver]`
