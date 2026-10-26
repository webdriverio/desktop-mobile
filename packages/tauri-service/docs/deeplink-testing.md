# Deeplink Testing

The service provides the ability to test custom protocol handlers and deeplinks in your Tauri application using the `browser.tauri.triggerDeeplink()` method.

## Overview

### What is Deeplink Testing?

Deeplink testing allows you to verify that your Tauri application correctly handles custom protocol URLs (e.g., `myapp://action?param=value`). This is essential when your app registers as a protocol handler and needs to respond to URLs opened from external sources.

### When Should You Use It?

Use `browser.tauri.triggerDeeplink()` when you need to:
- Test that your app correctly handles custom protocol URLs
- Verify deeplink parameter parsing and routing logic
- Test protocol handler registration and activation
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
  await browser.tauri.triggerDeeplink('myapp://action?param1=value1&param2=value2&array[]=a&array[]=b');

  const receivedParams = await browser.tauri.execute(() => {
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
  await expect(browser.tauri.triggerDeeplink('https://example.com')).rejects.toThrow('Invalid deeplink protocol');
});

it('should reject malformed URLs', async () => {
  await expect(browser.tauri.triggerDeeplink('not a url')).rejects.toThrow('Invalid deeplink URL');
});
```

## Platform Behavior

The service handles platform-specific differences automatically:

### Windows

- Uses `cmd /c start` command to trigger the deeplink
- No URL modification needed

### macOS

- Uses `open` command to trigger the deeplink
- No URL modification needed

### Linux

- Uses `xdg-open` command to trigger the deeplink
- No URL modification needed

## App Implementation

### Frontend Deep Link Listener

Your app needs to listen for deep links in the frontend:

```typescript
import { listen } from '@tauri-apps/plugin-deep-link';

listen('myapp://', (url) => {
  console.log('Received deeplink:', url);

  const parsed = new URL(url);

  globalThis.lastDeeplinkUrl = url.toString();

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
});
```

### Backend Handler (Optional)

For more complex scenarios, you can also handle deep links in the Rust backend:

```rust
use tauri_plugin_deep_link::DeepLinkExt;

#[tauri::main]
async fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            app.handle().register_uri_scheme_protocol("myapp", |request| {
                let url = request.url();
                println!("Received deep link: {}", url);
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
1. **Protocol not registered:**
   - Verify `protocol.register` is set in `tauri.conf.json`
   - Check your app is properly registered as the handler

2. **Deep link listener not set up:**
   - Ensure `listen()` from `@tauri-apps/plugin-deep-link` is called
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
