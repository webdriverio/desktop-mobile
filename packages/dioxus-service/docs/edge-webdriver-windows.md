# Edge WebDriver Management for Windows

## Overview

On Windows, Dioxus applications use Microsoft Edge WebView2, which requires `msedgedriver.exe` for WebDriver automation when using the `'external'` driver provider. The dioxus-service automatically handles Edge WebDriver version matching to prevent version mismatch errors.

This document only applies to the `'external'` driver provider on Windows. The `'embedded'` provider (recommended) has no Edge WebDriver dependency.

## The Problem

Tests using `driverProvider: 'external'` fail on Windows when the Edge browser version doesn't match the installed msedgedriver version:

```
Error: This version of Microsoft Edge WebDriver only supports Microsoft Edge version 144.
Current browser version is 143.0.3650.139
```

## The Solution

When `driverProvider: 'external'` and `autoDownloadEdgeDriver: true`, the dioxus-service automatically:
1. **Detects** your Edge browser (WebView2) version
2. **Checks** if a matching msedgedriver.exe exists
3. **Downloads** the correct version if needed
4. **Configures** PATH to use the downloaded driver

## Configuration

### Auto-Download (Recommended)

By default, auto-download is **enabled** for the `'external'` provider:

```typescript
services: [
  ['@wdio/dioxus-service', {
    driverProvider: 'external',
    appBinaryPath: './target/debug/my_app.exe',
    // autoDownloadEdgeDriver: true (default)
  }]
]
```

### Manual Management

Disable auto-download if you prefer to manage drivers yourself:

```typescript
services: [
  ['@wdio/dioxus-service', {
    driverProvider: 'external',
    appBinaryPath: './target/debug/my_app.exe',
    autoDownloadEdgeDriver: false,
  }]
]
```

With auto-download disabled, you must ensure msedgedriver matches your Edge version manually.

## How It Works

### 1. Version Detection

The service detects the WebView2/Edge version from:
- Windows Registry: `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}`

### 2. Driver Check

Checks if msedgedriver.exe in PATH matches the detected Edge version (major version comparison).

### 3. Download & Install

If a mismatch is detected:
- Downloads msedgedriver from `https://msedgedriver.azureedge.net/{version}/`
- Caches in temp directory: `%TEMP%\msedgedriver\{majorVersion}\`
- Adds to process PATH for test execution

## Troubleshooting

### "Could not detect Edge version"

**Cause:** Edge not installed or registry keys missing.

**Solution:** Install Microsoft Edge from https://www.microsoft.com/edge

### "Failed to download msedgedriver"

**Causes:**
- Network/proxy issues
- Microsoft's CDN temporarily unavailable

**Solutions:**
1. Check internet connection and proxy settings
2. Retry — CDN may be temporarily down
3. Download manually from https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/
4. Place `msedgedriver.exe` in PATH

### "Version mismatch" even after download

**Cause:** Another msedgedriver.exe earlier in PATH is being used.

**Solution:** Check PATH order:
```powershell
where msedgedriver.exe
```
Ensure the correct version appears first.

### CI/GitHub Actions Issues

GitHub Actions runners may have outdated Edge. Update if needed:

```yaml
- name: Update Edge (if needed)
  if: runner.os == 'Windows'
  run: choco upgrade microsoft-edge -y

- name: Run tests
  run: npm run test:e2e
```

## Manual Driver Management

If you disable auto-download:

### Check Edge Version
```powershell
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}" /v pv
```

### Download Matching Driver
1. Visit https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/
2. Download the version matching your Edge major version
3. Extract `msedgedriver.exe`
4. Add to PATH or place in project directory

### Verify Installation
```powershell
msedgedriver.exe --version
```

## Cache Location

Downloaded drivers are cached at:
```
%TEMP%\msedgedriver\{majorVersion}\msedgedriver.exe
```

Example: `C:\Users\YourName\AppData\Local\Temp\msedgedriver\143\msedgedriver.exe`

## Platform Notes

- **Windows**: Edge driver management runs when `driverProvider: 'external'`
- **Linux**: `'external'` provider is blocked in v1 — use `'embedded'`
- **macOS**: `'external'` provider is not supported — use `'embedded'`

## Recommendation

Use `driverProvider: 'embedded'` for the simplest Windows setup — it works on all platforms without any external driver or Edge WebDriver management.

## See Also

- [Platform Support](./platform-support.md) for the full provider matrix
- [Configuration](./configuration.md) for `autoDownloadEdgeDriver` and related options
- [Troubleshooting](./troubleshooting.md) for common issues
