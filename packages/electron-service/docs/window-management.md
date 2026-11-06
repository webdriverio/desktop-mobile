# Window Management

The service automatically tracks the active Electron `BrowserWindow` and ensures WebdriverIO commands target it. You can write tests against your app without manually shuffling window handles when the renderer changes (for example, splash screen → main window).

## How It Works

Before each WebdriverIO command, the service inspects all Electron page targets via Puppeteer. If the active target differs from the one currently selected, it calls `browser.switchToWindow()` on your behalf and records the new handle on `browser.electron.windowHandle`.

This runs on the WDIO `beforeCommand` hook, so the switch happens transparently between commands without any explicit setup.

### When the Switch Triggers

The service evaluates window state before every command **except** the four that already deal in window state directly:

- `getWindowHandle`
- `getWindowHandles`
- `switchToWindow`
- `execute`

Internal `browser.electron.execute` calls are also skipped to avoid recursion.

### Multiremote

In multiremote mode the service evaluates each Electron instance independently. Non-Electron instances (e.g., a Chrome browser running alongside the app) are ignored so they keep their own window state.

## `browser.electron.windowHandle`

The currently selected window handle is exposed on the browser:

```ts
const handle = browser.electron.windowHandle;
```

The service updates it any time it auto-switches windows. You generally don't need to read it directly — it's primarily an internal hook used by `ensureActiveWindowFocus()` to detect changes — but it is useful when debugging unexpected window state.

## Example

```ts
// Test script - the service automatically handles window focus
await expect(browser).toHaveTitle('Splash Screen');

// Electron main process - switching a new window
splashWindow.hide();
const mainWindow = new BrowserWindow({
  /* some options */
});
splashWindow.destroy();

// Test script - the service automatically switches to the new window
await expect(browser).toHaveTitle('Main Window');
```

## Manual Window Control

When you need explicit control (e.g. a popup that should remain open while you assert against the parent), use the standard WebdriverIO window APIs. The service won't fight you — `switchToWindow` is in the exclusion list above, so the next command runs against whatever window you selected.

```ts
describe('Settings window', () => {
  it('should save settings in popup window', async () => {
    // Open settings popup
    await browser.click('#open-settings-button');

    // Get window handles and switch to popup
    const handles = await browser.getWindowHandles();
    expect(handles).toHaveLength(2); // Verify popup opened
    await browser.switchToWindow(handles[1]);

    // Modify settings and save
    await browser.click('#save-settings');

    // Return to main window
    await browser.switchToWindow(handles[0]);
  });
});
```

## Troubleshooting

### Test commands target the wrong window

The service decides which window is "active" by asking Puppeteer for all `page` targets and picking the first one that's still valid. When several windows are open simultaneously, that ordering may not match your intent. Use `browser.switchToWindow()` explicitly in those cases.

### `windowHandle` is `undefined`

This means Puppeteer reported zero page targets when the service last checked — typically during early startup before the renderer has loaded, or after all windows have been destroyed. Wait for at least one `BrowserWindow` to be ready before issuing renderer-side commands.

### Window focus management disabled warning

A log entry like `Failed to get Puppeteer for instance ..., window focus management disabled` means the service couldn't open a CDP session for that instance (typically a non-Electron multiremote peer). Other instances continue to work; the affected instance simply skips automatic switching.
