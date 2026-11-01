# Deeplink Testing

The service provides the ability to test custom protocol handlers and deeplinks in your Electron application using the `browser.electron.triggerDeeplink()` method. This feature automatically handles platform-specific differences, particularly on Windows where deeplinks would normally launch a new instance instead of reaching the test instance.

## Overview

### What is Deeplink Testing?

Deeplink testing allows you to verify that your Electron application correctly handles custom protocol URLs (e.g., `myapp://action?param=value`). This is essential when your app registers as a protocol handler and needs to respond to URLs opened from external sources like web browsers, emails, or other applications.

### Why is it Needed?

Testing protocol handlers presents unique challenges:
- **Windows Issue**: On Windows, triggering a deeplink normally launches a new app instance instead of routing to the running test instance. This happens because the test instance and the externally-triggered instance use different user data directories.
- **Test Automation**: You need a programmatic way to trigger deeplinks without manual intervention.
- **Cross-Platform Testing**: Different platforms use different mechanisms to trigger protocol handlers.

### When Should You Use It?

Use `browser.electron.triggerDeeplink()` when you need to:
- Test that your app correctly handles custom protocol URLs
- Verify deeplink parameter parsing and routing logic
- Ensure single-instance behavior works correctly
- Test protocol handler registration and activation
- Validate deeplink-driven workflows in your application

## Basic Usage

### Simple Example

```typescript
describe('Protocol Handler Tests', () => {
  it('should handle custom protocol deeplinks', async () => {
    // Trigger the deeplink
    await browser.electron.triggerDeeplink('myapp://open?file=test.txt');

    // Wait for app to process it
    await browser.waitUntil(
      async () => {
        const openedFile = await browser.electron.execute(() => {
          return globalThis.lastOpenedFile;
        });
        return openedFile === 'test.txt';
      },
      {
        timeout: 5000,
        timeoutMsg: 'App did not handle the deeplink',
      },
    );
  });
});
```

### Complex URL Parameters

The method preserves all URL parameters, including complex query strings:

```typescript
it('should preserve query parameters', async () => {
  await browser.electron.triggerDeeplink('myapp://action?param1=value1&param2=value2&array[]=a&array[]=b');

  const receivedParams = await browser.electron.execute(() => {
    return globalThis.lastDeeplinkParams;
  });

  expect(receivedParams.param1).toBe('value1');
  expect(receivedParams.param2).toBe('value2');
  expect(receivedParams.array).toEqual(['a', 'b']);
});
```

### Error Handling

```typescript
it('should reject invalid protocols', async () => {
  await expect(browser.electron.triggerDeeplink('https://example.com')).rejects.toThrow('Invalid deeplink protocol');
});

it('should reject malformed URLs', async () => {
  await expect(browser.electron.triggerDeeplink('not a url')).rejects.toThrow('Invalid deeplink URL');
});
```

## Platform Behavior

The service handles platform-specific differences automatically:

### Windows

**Behavior:**
- Uses `cmd /c start` command to trigger the deeplink
- Automatically appends the test instance's `userData` directory as a query parameter
- Cannot use script-based apps (`appEntryPoint`) - requires packaged binary

**URL Modification:**
```typescript
// Input URL
'myapp://test?foo=bar';

// URL triggered on Windows (userData appended automatically)
'myapp://test?foo=bar&userData=/tmp/electron-test';
```

**Why This is Needed:**

On Windows, when a protocol URL is opened, the OS launches the registered application binary. Without the userData parameter, this creates a new instance with a different user data directory, preventing Electron's single-instance lock from working correctly. By appending the userData parameter, your app can use the same directory as the test instance, allowing the single-instance lock to route the deeplink to the test instance.

### macOS

**Behavior:**
- Uses `open` command to trigger the deeplink
- No URL modification needed (OS handles single-instance automatically)
- No special configuration required

**URL Modification:**
```typescript
// URL passed unchanged
'myapp://test?foo=bar';
```

### Linux

**Behavior:**
- Uses `gio open` command to trigger the deeplink
- Automatically appends the test instance's `userData` directory as a query parameter (like Windows)
- Cannot use script-based apps (`appEntryPoint`) - requires packaged binary

**URL Modification:**
```typescript
// Input URL
'myapp://test?foo=bar';

// URL triggered on Linux (userData appended automatically)
'myapp://test?foo=bar&userData=/tmp/electron-test';
```

**Why This is Needed:**

Similar to Windows, Linux requires the userData parameter to ensure the deeplink-triggered instance uses the same user data directory as the test instance, enabling Electron's single-instance lock to route the deeplink correctly.

## Setup Requirements

### 1. Service Configuration

#### Windows & Linux Configuration

On Windows and Linux, you **must use a packaged binary** (not `appEntryPoint`). Script-based apps cannot register protocol handlers at the OS level.

_`wdio.conf.ts`_

```typescript
export const config = {
  capabilities: [
    {
      browserName: 'electron',
      'wdio:electronServiceOptions': {
        // Use packaged binary (auto-detected or explicit)
        appBinaryPath: './dist/win-unpacked/MyApp.exe',

        // Optional but recommended: Explicit user data directory
        appArgs: ['--user-data-dir=/tmp/test-user-data'],
      },
    },
  ],
};
```

**Important Notes:**
- `appEntryPoint` will NOT work for protocol handler testing on Windows/Linux
- You must use `appBinaryPath` or let the service auto-detect your binary
- The service will warn you if you're using `appEntryPoint` with protocol handlers
- See [Service Configuration](./configuration.md#appbinarypath) for help finding your app binary path

#### macOS Configuration

macOS works with both packaged binaries and script-based apps:

_`wdio.conf.ts`_

```typescript
export const config = {
  capabilities: [
    {
      browserName: 'electron',
      'wdio:electronServiceOptions': {
        // Either works on macOS
        appBinaryPath: './dist/mac/MyApp.app/Contents/MacOS/MyApp',
        // OR
        appEntryPoint: './dist/main.js',
      },
    },
  ],
};
```

### 2. Protocol Handler Registration

Your app must register as a protocol handler. This is typically done in your main process:

```typescript
import { app } from 'electron';

// Register protocol handler
if (process.defaultApp) {
  // Development: Include path to main file
  app.setAsDefaultProtocolClient('myapp', process.execPath, [path.resolve(process.argv[1])]);
} else {
  // Production: No additional arguments needed
  app.setAsDefaultProtocolClient('myapp');
}
```

**Note:** Replace `'myapp'` with your custom protocol scheme.

### 3. Single Instance Lock

Your app must implement single-instance lock to receive deeplinks:

```typescript
import { app } from 'electron';

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is running, quit this one
  app.quit();
} else {
  // This is the primary instance, handle second-instance events
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Focus window if minimized
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }

    // Handle the deeplink from commandLine
    const url = commandLine.find((arg) => arg.startsWith('myapp://'));
    if (url) {
      handleDeeplink(url);
    }
  });
}
```

## App Implementation

### Complete Example (All Platforms)

Here's a complete implementation that works on Windows, macOS, and Linux:

_`main.ts`_

```typescript
import { app, BrowserWindow } from 'electron';
import path from 'path';

// ===== WINDOWS & LINUX: Parse userData from deeplink (MUST be before app.ready) =====
if (process.platform === 'win32' || process.platform === 'linux') {
  const url = process.argv.find((arg) => arg.startsWith('myapp://'));
  if (url) {
    try {
      const parsed = new URL(url);
      const userDataPath = parsed.searchParams.get('userData');
      if (userDataPath) {
        // Set user data directory to match test instance
        app.setPath('userData', userDataPath);
      }
    } catch (error) {
      console.error('Failed to parse deeplink URL:', error);
    }
  }
}

// ===== Single Instance Lock =====
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Focus the main window if it exists
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }

    // Find and handle deeplink from command line
    const url = commandLine.find((arg) => arg.startsWith('myapp://'));
    if (url) {
      handleDeeplink(url);
    }
  });

  // Standard app initialization
  app.whenReady().then(createWindow);
}

// ===== Protocol Handler Registration =====
if (process.defaultApp) {
  app.setAsDefaultProtocolClient('myapp', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('myapp');
}

// ===== Application Setup =====
let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile('index.html');

  // Handle deeplink on macOS (open-url event)
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeeplink(url);
  });

  // Handle initial deeplink on Windows/Linux (from argv)
  const url = process.argv.find((arg) => arg.startsWith('myapp://'));
  if (url) {
    handleDeeplink(url);
  }
}

// ===== Deeplink Handler =====
function handleDeeplink(url: string) {
  console.log('Received deeplink:', url);

  try {
    const parsed = new URL(url);

    // IMPORTANT: Remove userData parameter before processing
    // (This parameter is only for Windows single-instance routing)
    parsed.searchParams.delete('userData');

    const cleanUrl = parsed.toString();

    // Store for test verification (optional)
    if (!globalThis.receivedDeeplinks) {
      globalThis.receivedDeeplinks = [];
    }
    globalThis.receivedDeeplinks.push(cleanUrl);

    // Your actual deeplink handling logic here
    const action = parsed.hostname; // e.g., 'open' from 'myapp://open'
    const params = Object.fromEntries(parsed.searchParams);

    switch (action) {
      case 'open':
        // Handle 'myapp://open?file=...'
        if (params.file) {
          openFile(params.file);
        }
        break;

      case 'action':
        // Handle 'myapp://action?...'
        performAction(params);
        break;

      default:
        console.warn('Unknown deeplink action:', action);
    }

    // Notify renderer process if needed
    if (mainWindow) {
      mainWindow.webContents.send('deeplink-received', cleanUrl);
    }
  } catch (error) {
    console.error('Failed to parse deeplink:', error);
  }
}

function openFile(filePath: string) {
  console.log('Opening file:', filePath);
  // Your file opening logic
}

function performAction(params: Record<string, string>) {
  console.log('Performing action with params:', params);
  // Your action logic
}
```

## Common Issues

### Deeplink Launches New Instance (Windows/Linux)

**Symptom:** On Windows or Linux, triggering a deeplink creates a new application instance instead of routing to the test instance.

**Cause:** The test instance and the deeplink-triggered instance are using different user data directories, preventing Electron's single-instance lock from working.

**Solution:**
1. Ensure you're using a packaged binary (not `appEntryPoint`) in your WDIO configuration
2. Verify your app parses the `userData` parameter on Windows and Linux:

```typescript
if (process.platform === 'win32' || process.platform === 'linux') {
  const url = process.argv.find((arg) => arg.startsWith('myapp://'));
  if (url) {
    const parsed = new URL(url);
    const userDataPath = parsed.searchParams.get('userData');
    if (userDataPath) {
      app.setPath('userData', userDataPath);
    }
  }
}
```

3. Make sure this code runs **before** `app.whenReady()` or any other app initialization

For more details, see the [Common Issues guide](./common-issues.md).

### Warning: "Using appEntryPoint with protocol handlers"

**Symptom:** You see a warning in your test logs about using `appEntryPoint` with protocol handlers on Windows or Linux.

**Cause:** Protocol handlers on Windows and Linux require a registered executable binary at the OS level. Script-based apps (`appEntryPoint`) cannot register as protocol handlers.

**Solution:** Use `appBinaryPath` (or let the service auto-detect it) instead of `appEntryPoint`:

```typescript
// Before (doesn't work for protocol handlers on Windows/Linux)
'wdio:electronServiceOptions': {
  appEntryPoint: './dist/main.js'
}

// After (works correctly)
'wdio:electronServiceOptions': {
  appBinaryPath: './dist/linux-unpacked/MyApp'
  // OR let the service auto-detect your binary
}
```

### Warning: "No user data directory detected"

**Symptom:** You see a warning about missing user data directory.

**Cause:** The service couldn't detect a user data directory from your app configuration.

**Solution:** Explicitly set the user data directory in your app args:

```typescript
'wdio:electronServiceOptions': {
  appBinaryPath: './dist/win-unpacked/MyApp.exe',
  appArgs: ['--user-data-dir=/tmp/my-test-user-data']
}
```

### Invalid Deeplink Protocol Error

**Symptom:** Error: "Invalid deeplink protocol: https. Expected a custom protocol."

**Cause:** You're trying to use `triggerDeeplink()` with http/https/file protocols, which aren't custom protocols.

**Solution:** Only use custom protocol schemes:

```typescript
// Correct - custom protocol
await browser.electron.triggerDeeplink('myapp://action');

// Incorrect - web protocol
await browser.electron.triggerDeeplink('https://example.com'); // Throws error

// Incorrect - file protocol
await browser.electron.triggerDeeplink('file:///path/to/file'); // Throws error
```

### Deeplinks Not Received in App

**Symptom:** The deeplink is triggered but your app doesn't receive it.

**Possible Causes and Solutions:**
1. **Protocol not registered:**
   - Verify `app.setAsDefaultProtocolClient()` is called
   - Check your app's package.json has correct protocol configuration

2. **Missing second-instance handler:**
   - Ensure you've implemented `app.on('second-instance', ...)` handler
   - Verify the handler is checking for your protocol in `commandLine`

3. **macOS open-url handler missing:**
   - Add `app.on('open-url', ...)` handler for macOS
   - Call `event.preventDefault()` in the handler

4. **Deeplink parsed incorrectly:**
   - Check console logs to see if the URL is being received
   - Verify URL parsing logic handles your URL format

### Timing Issues

**Symptom:** Tests fail intermittently because the app hasn't processed the deeplink yet.

**Solution:** Always use `waitUntil` to wait for the app to process the deeplink:

```typescript
await browser.electron.triggerDeeplink('myapp://action');

// Wait for app to process
await browser.waitUntil(
  async () => {
    const processed = await browser.electron.execute(() => {
      return globalThis.deeplinkProcessed;
    });
    return processed === true;
  },
  {
    timeout: 5000,
    timeoutMsg: 'App did not process the deeplink within 5 seconds',
  },
);
```
