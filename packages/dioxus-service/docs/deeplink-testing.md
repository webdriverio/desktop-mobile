# Deeplink Testing

The service provides the ability to test custom protocol handlers and deeplinks in your Dioxus application using the `browser.dioxus.triggerDeeplink()` method.

## Overview

### What Is Deeplink Testing?

Deeplink testing allows you to verify that your Dioxus application correctly handles custom protocol URLs (e.g., `myapp://action?param=value`). This is essential when your app registers as a protocol handler and needs to respond to URLs opened from external sources.

### When Should You Use It?

Use `browser.dioxus.triggerDeeplink()` when you need to:

- Test that your app correctly handles custom protocol URLs
- Verify deeplink parameter parsing and routing logic
- Test protocol handler registration and activation
- Validate deeplink-driven workflows in your application

## Prerequisites

### Protocol Registration

Your Dioxus app must register its custom protocol scheme with the operating system. The mechanism depends on your app's packaging setup — consult your OS or Dioxus desktop documentation for registering a URL scheme handler.

## Basic Usage

### Simple Example

```typescript
describe('Protocol Handler Tests', () => {
  it('should handle custom protocol deeplinks', async () => {
    await browser.dioxus.triggerDeeplink('myapp://open?file=test.txt');

    await browser.waitUntil(async () => {
      const openedFile = await browser.dioxus.execute(() => {
        return globalThis.lastOpenedFile;
      });
      return openedFile === 'test.txt';
    }, {
      timeout: 5000,
      timeoutMsg: 'App did not handle the deeplink',
    });
  });
});
```

### Complex URL Parameters

```typescript
it('should preserve query parameters', async () => {
  await browser.dioxus.triggerDeeplink(
    'myapp://action?param1=value1&param2=value2'
  );

  const receivedParams = await browser.dioxus.execute(() => {
    return globalThis.lastDeeplinkParams;
  });

  expect(receivedParams.param1).toBe('value1');
  expect(receivedParams.param2).toBe('value2');
});
```

### Error Handling

```typescript
it('should reject invalid protocols', async () => {
  await expect(
    browser.dioxus.triggerDeeplink('https://example.com')
  ).rejects.toThrow('Invalid deeplink protocol');
});
```

## Platform Behavior

The service handles platform-specific differences automatically:

### Windows

- Uses `cmd /c start` to trigger the deeplink.

### macOS

- Uses `open` to trigger the deeplink.

### Linux

- Uses `xdg-open` to trigger the deeplink.

## App Implementation

Your Dioxus app needs to listen for deeplinks. The implementation depends on how you register the URL scheme. A typical pattern:

```rust
use dioxus::prelude::*;

#[component]
fn App() -> Element {
    let deeplink = use_signal(|| String::new());

    // Listen for OS deeplink events via your URL scheme handler mechanism
    // and update the `deeplink` signal

    rsx! {
        div {
            p { "Last deeplink: {deeplink}" }
        }
    }
}
```

Store deeplink data in a globally accessible location so tests can read it via `browser.dioxus.execute()`.

## Common Issues

### Deeplinks Not Received in App

**Symptom:** The deeplink is triggered but your app doesn't receive it.

**Possible Causes:**

1. **Protocol not registered** — verify your app is registered as the handler for the scheme.
2. **Listener not set up before trigger** — ensure your deeplink listener is active before calling `triggerDeeplink()`.
3. **Timing** — the OS may take a moment to route the deeplink to your running app.

### Timing Issues

**Solution:** Use `waitUntil` to wait for the app to process the deeplink:

```typescript
await browser.dioxus.triggerDeeplink('myapp://action');

await browser.waitUntil(async () => {
  const processed = await browser.dioxus.execute(() => {
    return globalThis.deeplinkProcessed;
  });
  return processed === true;
}, {
  timeout: 5000,
  timeoutMsg: 'App did not process the deeplink within 5 seconds',
});
```

### Invalid Protocol Error

Only use custom protocol schemes — not `https`, `http`, or `file`:

```typescript
// Correct — custom protocol
await browser.dioxus.triggerDeeplink('myapp://action');

// Incorrect — web protocol (throws)
await browser.dioxus.triggerDeeplink('https://example.com');
```

## See Also

- [API Reference](./api-reference.md) for complete method documentation
- [Usage Examples](./usage-examples.md) for additional patterns
