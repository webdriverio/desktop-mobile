# Deeplink Testing

The service provides the ability to test custom protocol handlers and deeplinks in your Tauri application using the `browser.tauri.triggerDeeplink()` method.

## Overview

### What is Deeplink Testing?

Deeplink testing allows you to verify that your Tauri application correctly handles custom protocol URLs (e.g., `myapp://action?param=value`). This is essential when your app registers as a protocol handler and needs to respond to URLs opened from external sources.

### When Should You Use It?

Use `browser.tauri.triggerDeeplink()` when you need to:
- Test that your app correctly handles custom protocol URLs
- Verify deeplink parameter parsing and routing logic
- Test protocol handler registration and activation, on the providers that open the URL through the OS (see [How the Deeplink Reaches Your App](#how-the-deeplink-reaches-your-app))
- Validate deeplink-driven workflows in your application

## Prerequisites

### Tauri Deep Link Plugin

Your Tauri app must have the `@tauri-apps/plugin-deep-link` plugin installed and configured. See the [official Tauri deep linking documentation](https://v2.tauri.app/plugin/deep-linking/) for setup instructions.

### Protocol Registration

Your app must register its custom protocol scheme in `tauri.conf.json` under the `deep-link` plugin configuration:

```json
{
  "plugins": {
    "deep-link": {
      "desktop": {
        "schemes": [
          "myapp"
        ]
      }
    }
  }
}
```

### Single Instance on Windows and Linux

With the `external` provider, and CrabNebula on Windows and Linux, `triggerDeeplink()` opens the URL through the OS, which starts a second instance of your app with the URL as an argument. Register the [single-instance plugin](https://v2.tauri.app/plugin/single-instance/) with its `deep-link` feature, so that instance hands the URL to the running app's deep-link handlers and exits.

The plugin allows one copy of the app at a time, so multiremote and `maxInstances` above 1 can only start one. To keep those working, register the plugin only for deeplink runs. The instance the OS starts for a URL doesn't get the service's `env`, so also register the plugin when the app is launched with one of your URLs:

```toml
# src-tauri/Cargo.toml
tauri-plugin-single-instance = { version = "2", features = ["deep-link"] }
```

```rust
let deeplink_run = std::env::var("ENABLE_SINGLE_INSTANCE").is_ok()
    || std::env::args().any(|arg| arg.starts_with("myapp://"));

let mut builder = tauri::Builder::default();
if deeplink_run {
    builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}));
}
builder = builder.plugin(tauri_plugin_deep_link::init());
```

Then set `ENABLE_SINGLE_INSTANCE` for deeplink runs with the service's `env` option, for example `env: { ENABLE_SINGLE_INSTANCE: 'true' }`.

## Basic Usage

### Simple Example

```typescript
describe('Protocol Handler Tests', () => {
  it('should handle custom protocol deeplinks', async () => {
    await browser.tauri.triggerDeeplink('myapp://open?file=test.txt');

    await browser.waitUntil(
      async () => {
        const openedFile = await browser.tauri.execute(() => {
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

```typescript
it('should preserve query parameters', async () => {
  await browser.tauri.triggerDeeplink('myapp://action?param1=value1&name=John%20Doe');

  await browser.waitUntil(
    async () => (await browser.tauri.execute(() => globalThis.lastDeeplinkParams?.name)) === 'John Doe',
    {
      timeout: 5000,
      timeoutMsg: 'App did not handle the deeplink',
    },
  );
  const receivedParams = await browser.tauri.execute(() => {
    return globalThis.lastDeeplinkParams;
  });

  expect(receivedParams.param1).toBe('value1');
});
```

### Error Handling

```typescript
it('should reject invalid protocols', async () => {
  await expect(browser.tauri.triggerDeeplink('https://example.com')).rejects.toThrow('Invalid deeplink protocol');
});

it('should reject malformed URLs', async () => {
  await expect(browser.tauri.triggerDeeplink('not a url')).rejects.toThrow('Invalid deeplink URL');
});
```

## How the Deeplink Reaches Your App

How `triggerDeeplink()` delivers the URL depends on the driver provider:

| Provider                                          | Delivery                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `embedded` (all platforms), `crabnebula` on macOS | `tauri-plugin-wdio` emits the deep-link plugin's `deep-link://new-url` event on the app's main thread    |
| `external`, `crabnebula` on Windows and Linux     | Opens the URL through the OS: `rundll32.exe url.dll,FileProtocolHandler` on Windows, `gio open` on Linux |

Either way, your app's `onOpenUrl` (frontend) and `on_open_url` (Rust) handlers receive the URL, so handle deep links there. On Windows and Linux, the OS route needs the [single-instance plugin](#single-instance-on-windows-and-linux).

The in-app event skips the OS, so a few things differ from a real launch:

- The plugin's `getCurrent()` doesn't change.
- No second instance starts, so a single-instance callback that reads the URL from its arguments doesn't run. With the single-instance plugin's `deep-link` feature, those URLs reach `onOpenUrl` too, so handle them there.
- Your app's capabilities must allow `wdio:allow-emit-deep-link`, which `wdio:default` includes.
- Rust `on_open_url` handlers run on the main thread on every platform, as a real deep link runs them on macOS and Windows. On Linux, a real deep link runs them on the single-instance plugin's D-Bus thread. `triggerDeeplink()` returns without waiting for them, so wait for their effect in your test.

## App Implementation

### Frontend Deep Link Listener

Listen for deep links with the plugin's `onOpenUrl`:

```typescript
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';

await onOpenUrl((urls) => {
  for (const url of urls) {
    console.log('Received deeplink:', url);

    const parsed = new URL(url);

    globalThis.lastDeeplinkUrl = url;

    const action = parsed.hostname;
    const params = Object.fromEntries(parsed.searchParams);

    switch (action) {
      case 'open':
        if (params.file) {
          globalThis.lastOpenedFile = params.file;
        }
        break;
      case 'action':
        globalThis.lastDeeplinkParams = params;
        break;
    }
  }
});
```

### Backend Handler (Optional)

You can also handle deep links in the Rust backend with `on_open_url`:

```rust
use tauri_plugin_deep_link::DeepLinkExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            app.deep_link().on_open_url(|event| {
                for url in event.urls() {
                    println!("Received deep link: {url}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## Common Issues

### Deeplinks Not Received in App

**Symptom:** The deeplink is triggered but your app doesn't receive it.

**Possible Causes and Solutions:**

1. **Scheme not configured:**
   - Check that `plugins.deep-link.desktop.schemes` in `tauri.conf.json` lists your scheme (see [Protocol Registration](#protocol-registration))
   - On the OS route (`external`, and CrabNebula on Windows and Linux), check your app is registered as the scheme's handler
   - On Windows and Linux with the OS route, check the single-instance plugin is registered for the run, with its `deep-link` feature (see [Single Instance on Windows and Linux](#single-instance-on-windows-and-linux))

2. **Deep link listener not set up:**
   - Ensure `onOpenUrl()` (frontend) or `on_open_url` (Rust) is set up
   - Verify the listener is set up before triggering the deeplink

3. **Deep link parsed incorrectly:**
   - Check console logs to see if the URL is being received
   - Verify URL parsing logic handles your URL format

### Invalid Deeplink Protocol Error

**Symptom:** Error: "Invalid deeplink protocol: https. Expected a custom protocol."

**Cause:** You're trying to use `triggerDeeplink()` with http/https/file protocols.

**Solution:** Only use custom protocol schemes:

```typescript
// Correct - custom protocol
await browser.tauri.triggerDeeplink('myapp://action');

// Incorrect - web protocol
await browser.tauri.triggerDeeplink('https://example.com'); // Throws error

// Incorrect - file protocol
await browser.tauri.triggerDeeplink('file:///path/to/file'); // Throws error
```

### Timing Issues

**Symptom:** Tests fail intermittently because the app hasn't processed the deeplink yet.

**Solution:** Always use `waitUntil` to wait for the app to process the deeplink:

```typescript
await browser.tauri.triggerDeeplink('myapp://action');

await browser.waitUntil(
  async () => {
    const processed = await browser.tauri.execute(() => {
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

## See Also

- [Tauri Deep Linking Documentation](https://v2.tauri.app/plugin/deep-linking/)
- [API Reference](./api-reference.md) for complete method documentation
- [Usage Examples](./usage-examples.md) for additional patterns
