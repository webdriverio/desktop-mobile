# Usage Examples

Practical examples for testing Tauri applications with WebdriverIO.

## Basic Usage

### Element Interactions

Standard WebDriver element interactions work with Tauri apps:

```typescript
describe('Tauri App Interactions', () => {
  it('should interact with form elements', async () => {
    // Find elements by selector
    const input = await browser.$('input[name="username"]');
    await input.setValue('test_user');

    const button = await browser.$('button[type="submit"]');
    await button.click();

    // Wait for element and check visibility
    const result = await browser.$('.result');
    await result.waitForDisplayed();

    const text = await result.getText();
    expect(text).toBe('Success!');
  });

  it('should handle multiple elements', async () => {
    const buttons = await browser.$$('button');
    expect(buttons).toHaveLength(5);

    // Interact with each button
    for (const button of buttons) {
      const text = await button.getText();
      console.log('Button text:', text);
    }
  });

  it('should navigate and wait', async () => {
    // Navigate within the app
    const link = await browser.$('a[href="#settings"]');
    await link.click();

    // Wait for page to load
    const settings = await browser.$('.settings-panel');
    await settings.waitForDisplayed({ timeout: 5000 });
  });
});
```

## Tauri API Access

### Execute JavaScript in App Context

Use `browser.tauri.execute()` to run JavaScript with access to Tauri APIs:

```typescript
describe('Tauri API Access', () => {
  it('should access window location', async () => {
    const url = await browser.tauri.execute(() => {
      return window.location.href;
    });
    console.log('Current URL:', url);
  });

  it('should access Tauri invoke API', async () => {
    const result = await browser.tauri.execute(({ core }) => {
      return core.invoke('get_config');
    });
    expect(result).toBeDefined();
  });

  it('should use async operations', async () => {
    const data = await browser.tauri.execute(async ({ core }) => {
      const user = await core.invoke('get_user');
      const permissions = await core.invoke('get_user_permissions', { userId: user.id });
      return { user, permissions };
    });

    expect(data.user).toBeDefined();
    expect(data.permissions).toBeInstanceOf(Array);
  });

  it('should execute with parameters', async () => {
    const username = 'test_user';
    const result = await browser.tauri.execute(
      (args) => {
        return { received: args.username };
      },
      { username },
    );

    expect(result.received).toBe('test_user');
  });

  it('should handle errors', async () => {
    try {
      await browser.tauri.execute(() => {
        throw new Error('Test error');
      });
    } catch (error) {
      expect(error.message).toContain('Test error');
    }
  });
});
```

## Mocking Tauri Commands

### Mock Backend Commands

Mock Tauri commands to test frontend behavior without backend:

```typescript
describe('Command Mocking', () => {
  it('should mock a simple command', async () => {
    // Set up mock
    const mock = await browser.tauri.mock('get_app_version');
    await mock.mockReturnValue('1.2.3');

    // Call the mocked command
    const version = await browser.tauri.execute(({ core }) => {
      return core.invoke('get_app_version');
    });

    expect(version).toBe('1.2.3');
  });

  it('should mock command with arguments', async () => {
    const mock = await browser.tauri.mock('get_user');
    await mock.mockReturnValue({ id: 1, name: 'John Doe' });

    const user = await browser.tauri.execute(({ core }) => {
      return core.invoke('get_user', { userId: 123 });
    });

    expect(user).toEqual({ id: 1, name: 'John Doe' });
  });

  it('should track mock calls', async () => {
    const mock = await browser.tauri.mock('save_data');
    await mock.mockReturnValue({ success: true });

    // Call the command multiple times
    await browser.tauri.execute(({ core }) => {
      core.invoke('save_data', { data: 'test1' });
      core.invoke('save_data', { data: 'test2' });
    });

    expect(mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('should mock command with implementation', async () => {
    const mock = await browser.tauri.mock('calculate');
    await mock.mockImplementation((a, b) => {
      return a + b;
    });

    const result = await browser.tauri.execute(({ core }) => {
      return core.invoke('calculate', { a: 5, b: 3 });
    });

    expect(result).toBe(8);
  });

  it('should handle errors in mocks', async () => {
    const mock = await browser.tauri.mock('risky_operation');
    await mock.mockRejectedValue(new Error('Operation failed'));

    try {
      await browser.tauri.execute(({ core }) => {
        return core.invoke('risky_operation');
      });
    } catch (error) {
      expect(error.message).toBe('Operation failed');
    }
  });

  it('should restore mocks after test', async () => {
    const mock = await browser.tauri.mock('get_data');
    await mock.mockReturnValue({ mocked: true });

    // Restore original behavior
    await mock.mockRestore();

    // Now calls the real command
    const result = await browser.tauri.execute(({ core }) => {
      return core.invoke('get_data');
    });

    // Result should be from actual backend
    expect(result).toBeDefined();
  });
});
```

## Testing Custom Commands

### Invoke Custom Tauri Commands

Test commands you've defined in your Tauri backend:

```typescript
describe('Custom Tauri Commands', () => {
  it('should call custom command with simple return', async () => {
    const greeting = await browser.tauri.execute(({ core }) => {
      return core.invoke('greet', { name: 'Tauri' });
    });

    expect(greeting).toBe('Hello, Tauri!');
  });

  it('should call command returning object', async () => {
    const config = await browser.tauri.execute(({ core }) => {
      return core.invoke('get_config');
    });

    expect(config).toHaveProperty('version');
    expect(config).toHaveProperty('isDev');
  });

  it('should handle command with file paths', async () => {
    const result = await browser.tauri.execute(({ core }) => {
      return core.invoke('read_project_file', {
        path: './src/main.rs',
      });
    });

    expect(result).toContain('fn main()');
  });

  it('should handle command timeout', async () => {
    try {
      await browser.tauri.execute(async ({ core }) => {
        // Simulate a slow operation
        return core.invoke('slow_operation');
      });
    } catch (error) {
      // Handle timeout
      console.log('Command timed out:', error.message);
    }
  });
});
```

## Testing with Logs

### Capture and Verify Logs

Test that your app produces expected logs:

```typescript
describe('Log Capture', () => {
  before(async () => {
    // Enable log capture in wdio.conf.ts:
    // captureBackendLogs: true,
    // captureFrontendLogs: true,
    // backendLogLevel: 'debug',
    // frontendLogLevel: 'debug',
  });

  it('should verify console logs', async () => {
    // Clear previous logs
    const logs = await browser.getLogs('browser');

    // Perform action that logs
    await browser.$('button').click();

    // Get new logs
    const newLogs = await browser.getLogs('browser');

    const hasExpectedLog = newLogs.some((log) => log.message.includes('Button clicked'));
    expect(hasExpectedLog).toBe(true);
  });

  it('should track debug logs', async () => {
    await browser.tauri.execute(() => {
      console.debug('Debug message from test');
    });

    const logs = await browser.getLogs('browser');
    const debugLogs = logs.filter((log) => log.level === 'DEBUG');

    expect(debugLogs.length).toBeGreaterThan(0);
  });
});
```

## Multiremote Testing

### Testing Multiple App Instances

Test interactions between multiple Tauri app instances:

```typescript
describe('Multiremote - Multiple App Instances', () => {
  it('should interact with both app instances', async () => {
    // Access first app instance
    const app1Button = await browser.app1.$('button[data-testid="send"]');
    await app1Button.click();

    // Access second app instance
    const app2Input = await browser.app2.$('input[data-testid="message"]');
    const text = await app2Input.getValue();

    expect(text).toBe('Message from app1');
  });

  it('should mock different commands per instance', async () => {
    // Mock command on first app
    const mock1 = await browser.app1.tauri.mock('get_user');
    await mock1.mockReturnValue({ id: 1, name: 'User1' });

    // Mock different value on second app
    const mock2 = await browser.app2.tauri.mock('get_user');
    await mock2.mockReturnValue({ id: 2, name: 'User2' });

    // Verify each app gets its mocked value
    const user1 = await browser.app1.tauri.execute(({ core }) => {
      return core.invoke('get_user');
    });

    const user2 = await browser.app2.tauri.execute(({ core }) => {
      return core.invoke('get_user');
    });

    expect(user1.id).toBe(1);
    expect(user2.id).toBe(2);
  });

  it('should clear mocks independently', async () => {
    // Set up mocks on both instances
    const mock1 = await browser.app1.tauri.mock('get_config');
    await mock1.mockReturnValue({ version: '1.0.0' });

    const mock2 = await browser.app2.tauri.mock('get_config');
    await mock2.mockReturnValue({ version: '2.0.0' });

    // Clear only app1's mocks
    await browser.app1.tauri.clearAllMocks();

    // app1 now calls real command, app2 still mocked
    const config2 = await browser.app2.tauri.execute(({ core }) => {
      return core.invoke('get_config');
    });

    expect(config2.version).toBe('2.0.0');
  });
});
```

## Multi-Window Testing

### Testing Multiple Tauri Windows

Test interactions with multiple windows in a single Tauri app:

```typescript
import { withExecuteOptions } from '@wdio/tauri-service';

describe('Multi-Window Testing', () => {
  it('should list available windows', async () => {
    const windows = await browser.tauri.listWindows();
    console.log('Available windows:', windows);
    expect(windows).toContain('main');
    expect(windows).toContain('settings');
  });

  it('should switch between windows', async () => {
    // Start in main window
    const mainContent = await browser.tauri.execute(() => {
      return document.querySelector('h1')?.textContent;
    });
    expect(mainContent).toBe('Main Window');

    // Switch to settings window
    await browser.tauri.switchWindow('settings');

    // Now executing in settings context
    const settingsContent = await browser.tauri.execute(() => {
      return document.querySelector('h1')?.textContent;
    });
    expect(settingsContent).toBe('Settings');

    // Switch back to main
    await browser.tauri.switchWindow('main');
  });

  it('should execute in specific window without switching', async () => {
    // Use per-call windowLabel to target a specific window
    const result = await browser.tauri.execute(
      (tauri) => tauri.core.invoke('get_window_data'),
      withExecuteOptions({ windowLabel: 'popup' }),
    );
    expect(result).toEqual({ source: 'popup' });
  });

  it('should handle non-existent window gracefully', async () => {
    await expect(browser.tauri.switchWindow('nonexistent')).rejects.toThrow(
      'Window label "nonexistent" not found. Available windows: main, settings, popup',
    );
  });
});
```

**Configuration:** You can also set a default window in your WDIO config:

```typescript
// wdio.conf.ts
export const config = {
  capabilities: [
    {
      browserName: 'tauri',
      'wdio:tauriServiceOptions': {
        windowLabel: 'settings', // Default to settings window
      },
    },
  ],
};
```

---

## Common Testing Patterns

### Wait for Async Operations

```typescript
it('should wait for async data load', async () => {
  // Trigger data fetch
  const loadButton = await browser.$('button[data-testid="load"]');
  await loadButton.click();

  // Wait for loading state to disappear
  const spinner = await browser.$('.loading-spinner');
  await spinner.waitForDisplayed({ reverse: true, timeout: 5000 });

  // Verify data appeared
  const data = await browser.$('.data-content');
  expect(await data.isDisplayed()).toBe(true);
});
```

### Test Error Handling

```typescript
it('should display error message on failure', async () => {
  const mock = await browser.tauri.mock('fetch_data');
  await mock.mockRejectedValue(new Error('Network error'));

  // Trigger action that uses mocked command
  const button = await browser.$('button[data-testid="fetch"]');
  await button.click();

  // Verify error message displayed
  const error = await browser.$('.error-message');
  await error.waitForDisplayed();

  const text = await error.getText();
  expect(text).toContain('Network error');
});
```

### Test Form Validation

```typescript
it('should validate form input', async () => {
  const input = await browser.$('input[name="email"]');

  // Test invalid input
  await input.setValue('invalid-email');
  let error = await browser.$('.email-error');
  expect(await error.isDisplayed()).toBe(true);

  // Test valid input
  await input.setValue('user@example.com');
  error = await browser.$('.email-error');
  expect(await error.isDisplayed()).toBe(false);
});
```

### Test State Persistence

```typescript
it('should persist state across reload', async () => {
  // Set app state
  await browser.tauri.execute(async ({ core }) => {
    await core.invoke('set_user_preference', { theme: 'dark' });
  });

  // Reload the app (simulate)
  await browser.execute(() => window.location.reload());

  // Verify state persisted
  const theme = await browser.tauri.execute(({ core }) => {
    return core.invoke('get_user_preference', { key: 'theme' });
  });

  expect(theme).toBe('dark');
});
```

## See Also

- [API Reference](./api-reference.md) for complete API documentation
- [Configuration](./configuration.md) for testing setup options
- [Log Forwarding](./log-forwarding.md) for logging patterns
- [Plugin Setup](./plugin-setup.md) for plugin configuration
- [Troubleshooting](./troubleshooting.md) for common issues
