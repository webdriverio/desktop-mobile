# Usage Examples

Practical examples for testing Dioxus applications with WebdriverIO.

## Basic Usage

### Element Interactions

Standard WebDriver element interactions work with Dioxus apps:

```typescript
describe('Dioxus App Interactions', () => {
  it('should interact with form elements', async () => {
    const input = await browser.$('input[name="username"]');
    await input.setValue('test_user');

    const button = await browser.$('button[type="submit"]');
    await button.click();

    const result = await browser.$('.result');
    await result.waitForDisplayed();

    const text = await result.getText();
    expect(text).toBe('Success!');
  });

  it('should handle multiple elements', async () => {
    const buttons = await browser.$$('button');
    expect(buttons).toHaveLength(5);

    for (const button of buttons) {
      const text = await button.getText();
      console.log('Button text:', text);
    }
  });
});
```

## Execute API

### Execute JavaScript in App Context

Use `browser.dioxus.execute()` to run JavaScript with access to Dioxus IPC:

```typescript
describe('Dioxus API Access', () => {
  it('should access Dioxus invoke API', async () => {
    const result = await browser.dioxus.execute(({ invoke }) => {
      return invoke('get_config');
    });
    expect(result).toBeDefined();
  });

  it('should use async operations', async () => {
    const data = await browser.dioxus.execute(async ({ invoke }) => {
      const user = await invoke('get_user');
      const permissions = await invoke('get_user_permissions', { userId: (user as any).id });
      return { user, permissions };
    });

    expect(data.user).toBeDefined();
    expect(data.permissions).toBeInstanceOf(Array);
  });

  it('should execute with parameters', async () => {
    const username = 'test_user';
    const result = await browser.dioxus.execute(
      (dx, name) => ({ received: name }),
      username
    );

    expect(result.received).toBe('test_user');
  });

  it('should handle errors', async () => {
    try {
      await browser.dioxus.execute(() => {
        throw new Error('Test error');
      });
    } catch (error) {
      expect(error.message).toContain('Test error');
    }
  });
});
```

## Mocking Dioxus Commands

### Mock Backend Commands

```typescript
describe('Command Mocking', () => {
  it('should mock a simple command', async () => {
    const mock = await browser.dioxus.mock('get_app_version');
    await mock.mockReturnValue('1.2.3');

    const version = await browser.dioxus.execute(({ invoke }) => {
      return invoke('get_app_version');
    });

    expect(version).toBe('1.2.3');
  });

  it('should mock command with arguments', async () => {
    const mock = await browser.dioxus.mock('get_user');
    await mock.mockReturnValue({ id: 1, name: 'John Doe' });

    const user = await browser.dioxus.execute(({ invoke }) => {
      return invoke('get_user', { userId: 123 });
    });

    expect(user).toEqual({ id: 1, name: 'John Doe' });
  });

  it('should track mock calls', async () => {
    const mock = await browser.dioxus.mock('save_data');
    await mock.mockReturnValue({ success: true });

    await browser.dioxus.execute(async ({ invoke }) => {
      await invoke('save_data', { data: 'test1' });
      await invoke('save_data', { data: 'test2' });
    });

    await mock.update();
    expect(mock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('should handle errors in mocks', async () => {
    const mock = await browser.dioxus.mock('risky_operation');
    await mock.mockRejectedValue(new Error('Operation failed'));

    try {
      await browser.dioxus.execute(({ invoke }) => {
        return invoke('risky_operation');
      });
    } catch (error) {
      expect(error.message).toBe('Operation failed');
    }
  });

  it('should restore mocks after test', async () => {
    const mock = await browser.dioxus.mock('get_data');
    await mock.mockReturnValue({ mocked: true });

    await mock.mockRestore();

    // Now calls the real command
    const result = await browser.dioxus.execute(({ invoke }) => {
      return invoke('get_data');
    });

    expect(result).toBeDefined();
  });
});
```

## Testing Custom Commands

```typescript
describe('Custom Dioxus Commands', () => {
  it('should call custom command with simple return', async () => {
    const greeting = await browser.dioxus.execute(({ invoke }) => {
      return invoke('greet', { name: 'Dioxus' });
    });

    expect(greeting).toBe('Hello, Dioxus!');
  });

  it('should call command returning object', async () => {
    const config = await browser.dioxus.execute(({ invoke }) => {
      return invoke('get_config');
    });

    expect(config).toHaveProperty('version');
    expect(config).toHaveProperty('isDev');
  });
});
```

## Log Capture

```typescript
describe('Log Capture', () => {
  it('should verify console logs', async () => {
    // Log capture enabled in wdio.conf.ts:
    // captureBackendLogs: true
    // captureFrontendLogs: true

    const logs = await browser.getLogs('browser');

    await browser.$('button').click();

    const newLogs = await browser.getLogs('browser');
    const hasExpectedLog = newLogs.some(log =>
      log.message.includes('Button clicked')
    );
    expect(hasExpectedLog).toBe(true);
  });
});
```

## Multi-Window Testing

```typescript
describe('Multi-Window Testing', () => {
  it('should list available windows', async () => {
    const windows = await browser.dioxus.listWindows();
    console.log('Available windows:', windows);
    expect(windows).toContain('main');
    expect(windows).toContain('settings');
  });

  it('should switch between windows', async () => {
    const mainContent = await browser.dioxus.execute(() => {
      return document.querySelector('h1')?.textContent;
    });
    expect(mainContent).toBe('Main Window');

    await browser.dioxus.switchWindow('settings');

    const settingsContent = await browser.dioxus.execute(() => {
      return document.querySelector('h1')?.textContent;
    });
    expect(settingsContent).toBe('Settings');

    await browser.dioxus.switchWindow('main');
  });

  it('should handle non-existent window gracefully', async () => {
    await expect(browser.dioxus.switchWindow('nonexistent')).rejects.toThrow(
      'Window label "nonexistent" not found'
    );
  });
});
```

Configuration for a default window:

```typescript
// wdio.conf.ts
capabilities: [{
  browserName: 'dioxus',
  'wdio:dioxusServiceOptions': {
    windowLabel: 'settings',  // Default to settings window
  },
}]
```

## Deeplink Testing

```typescript
describe('Deeplink Tests', () => {
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

## Multiremote Testing

```typescript
describe('Multiremote — Multiple App Instances', () => {
  it('should mock different commands per instance', async () => {
    const mock1 = await browser.app1.dioxus.mock('get_user');
    await mock1.mockReturnValue({ id: 1, name: 'User1' });

    const mock2 = await browser.app2.dioxus.mock('get_user');
    await mock2.mockReturnValue({ id: 2, name: 'User2' });

    const user1 = await browser.app1.dioxus.execute(({ invoke }) => {
      return invoke('get_user');
    });

    const user2 = await browser.app2.dioxus.execute(({ invoke }) => {
      return invoke('get_user');
    });

    expect(user1.id).toBe(1);
    expect(user2.id).toBe(2);
  });
});
```

## Standalone Session

Use `startWdioSession` to manage a session outside of the WebdriverIO test runner:

```typescript
import { startWdioSession } from '@wdio/dioxus-service';

const browser = await startWdioSession({
  browserName: 'dioxus',
  'dioxus:options': {
    application: './target/debug/my_app',
  },
  'wdio:dioxusServiceOptions': {
    driverProvider: 'embedded',
  },
});

const heading = await browser.$('h1');
console.log(await heading.getText());

await browser.deleteSession();
```

## Common Testing Patterns

### Wait for Async Operations

```typescript
it('should wait for async data load', async () => {
  const loadButton = await browser.$('button[data-testid="load"]');
  await loadButton.click();

  const spinner = await browser.$('.loading-spinner');
  await spinner.waitForDisplayed({ reverse: true, timeout: 5000 });

  const data = await browser.$('.data-content');
  expect(await data.isDisplayed()).toBe(true);
});
```

### Test Error Handling

```typescript
it('should display error message on failure', async () => {
  const mock = await browser.dioxus.mock('fetch_data');
  await mock.mockRejectedValue(new Error('Network error'));

  const button = await browser.$('button[data-testid="fetch"]');
  await button.click();

  const error = await browser.$('.error-message');
  await error.waitForDisplayed();

  const text = await error.getText();
  expect(text).toContain('Network error');
});
```

### Test State Persistence

```typescript
it('should persist state across reload', async () => {
  await browser.dioxus.execute(async ({ invoke }) => {
    await invoke('set_user_preference', { theme: 'dark' });
  });

  await browser.execute(() => window.location.reload());

  const theme = await browser.dioxus.execute(({ invoke }) => {
    return invoke('get_user_preference', { key: 'theme' });
  });

  expect(theme).toBe('dark');
});
```

## See Also

- [API Reference](./api-reference.md) for complete API documentation
- [Configuration](./configuration.md) for testing setup options
- [Log Forwarding](./log-forwarding.md) for logging patterns
- [Bridge Setup](./plugin-setup.md) for bridge configuration
- [Troubleshooting](./troubleshooting.md) for common issues
