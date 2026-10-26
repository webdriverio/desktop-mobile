# Electron APIs

This guide covers how to work with Electron APIs in your tests, including accessing APIs from the main process and mocking them for testing.

## Accessing Electron APIs

The service provides access to Electron APIs from the main process using the Chrome DevTools Protocol (CDP). You can access these APIs by using the `browser.electron.execute()` method in your test suites.

### Execute Scripts

Arbitrary scripts can be executed within the context of your Electron application main process using `browser.electron.execute()`. This allows Electron APIs to be accessed in a fluid way, in case you wish to manipulate your application at runtime or trigger certain events.

For example, a message modal can be triggered from a test via:

```ts
await browser.electron.execute(
  (electron, param1, param2, param3) => {
    const appWindow = electron.BrowserWindow.getFocusedWindow();
    electron.dialog.showMessageBox(appWindow, {
      message: 'Hello World!',
      detail: `${param1} + ${param2} + ${param3} = ${param1 + param2 + param3}`,
    });
  },
  1,
  2,
  3,
);
```

...which results in the application displaying the following alert:

![Execute Demo](../.github/assets/execute-demo.png "Execute Demo")

**Note:** The first argument of the function is always the default export of the `electron` package that contains the [Electron API](https://www.electronjs.org/docs/latest/api/app).

### How It Works

The service uses the Chrome DevTools Protocol (CDP) to communicate with your Electron application's main process. This provides a reliable and efficient way to:
- Execute JavaScript code in the main process context
- Access all Electron APIs
- Mock Electron APIs for testing
- Handle multiple windows and processes

No additional setup or imports are required in your Electron application - the service automatically connects to your app when it starts.

---

## Mocking Electron APIs

The service allows for mocking of Electron API functionality via a [Vitest](https://vitest.dev/)-like interface.

### Creating Mocks

Use `browser.electron.mock()` to mock individual Electron API functions:

```ts
const mockedShowOpenDialog = await browser.electron.mock('dialog', 'showOpenDialog');

await browser.electron.execute(
  async (electron) =>
    await electron.dialog.showOpenDialog({
      properties: ['openFile', 'openDirectory'],
    }),
);

expect(mockedShowOpenDialog).toHaveBeenCalledTimes(1);
expect(mockedShowOpenDialog).toHaveBeenCalledWith({
  properties: ['openFile', 'openDirectory'],
});
```

Use `browser.electron.mockAll()` to mock all functions on an API simultaneously:

```ts
const { showOpenDialog, showMessageBox } = await browser.electron.mockAll('dialog');
await showOpenDialog.mockReturnValue('I opened a dialog!');
await showMessageBox.mockReturnValue('I opened a message box!');
```

### Mocking Electron Classes

For Electron classes like `Tray`, `BrowserWindow`, `Menu`, etc., you can mock the entire class and all its instance methods:

```ts
// Mock the Tray class
const mockTray = await browser.electron.mock('Tray');

// Mock instance methods
await mockTray.setTitle.mockReturnValue(undefined);
await mockTray.setToolTip.mockReturnValue(undefined);

// Track constructor calls
const tray = await browser.electron.execute((electron) => new electron.Tray('/path/to/icon.png'));
expect(mockTray.__constructor).toHaveBeenCalledWith('/path/to/icon.png');

// Test instance method calls
await browser.electron.execute((electron) => {
  const tray = new electron.Tray('/path/to/icon.png');
  tray.setTitle('My App');
  tray.setToolTip('Click for menu');
});

expect(mockTray.setTitle).toHaveBeenCalledWith('My App');
expect(mockTray.setToolTip).toHaveBeenCalledWith('Click for menu');
```

Class mocks provide:
- **`__constructor`**: An ElectronFunctionMock object that tracks calls to the class constructor
- **Instance methods**: All class instance methods are available as mock objects
- **`mockRestore()`**: Method to restore the original class

### Setting Return Values

Mock objects provide methods to control what the mocked function returns:

```ts
const mockGetName = await browser.electron.mock('app', 'getName');

// Return a specific value
await mockGetName.mockReturnValue('mocked app name');

// Return different values for consecutive calls
await mockGetName.mockReturnValueOnce('first call');
await mockGetName.mockReturnValueOnce('second call');

// For async functions, use mockResolvedValue
const mockGetFileIcon = await browser.electron.mock('app', 'getFileIcon');
await mockGetFileIcon.mockResolvedValue('mocked icon data');
```

### Custom Implementations

You can provide custom implementations for mocks:

```ts
const mockGetName = await browser.electron.mock('app', 'getName');

await mockGetName.mockImplementation((customName) => {
  return customName || 'default name';
});

const result = await browser.electron.execute((electron) => electron.app.getName('custom'));
expect(result).toBe('custom');
```

### Managing Mocks

The service provides utilities to manage multiple mocks:

```ts
// Clear mock call history (keeps implementation)
await browser.electron.clearAllMocks();
await browser.electron.clearAllMocks('app'); // Clear only app mocks

// Reset mocks (clears history and implementation)
await browser.electron.resetAllMocks();
await browser.electron.resetAllMocks('clipboard'); // Reset only clipboard mocks

// Restore original implementations
await browser.electron.restoreAllMocks();
await browser.electron.restoreAllMocks('dialog'); // Restore only dialog mocks
```

You can also manage individual mocks:

```ts
const mockGetName = await browser.electron.mock('app', 'getName');

await mockGetName.mockClear(); // Clear call history
await mockGetName.mockReset(); // Clear history and implementation
await mockGetName.mockRestore(); // Restore original function
```

### Inspecting Mock Calls

Mock objects track how they were called:

```ts
const mockSetName = await browser.electron.mock('app', 'setName');

await browser.electron.execute((electron) => electron.app.setName('test'));
await browser.electron.execute((electron) => electron.app.setName('test 2'));

// Check all calls
expect(mockSetName.mock.calls).toStrictEqual([['test'], ['test 2']]);

// Check last call
expect(mockSetName.mock.lastCall).toStrictEqual(['test 2']);

// Check results
expect(mockSetName.mock.results).toHaveLength(2);
```

### Service Configuration

You can automatically manage mocks before each test using service configuration:

```ts
export const config = {
  services: [
    [
      'electron',
      {
        clearMocks: true, // Calls mockClear() before each test
        resetMocks: false, // Calls mockReset() before each test
        restoreMocks: false, // Calls mockRestore() before each test
      },
    ],
  ],
};
```

---

## API Reference

For complete API documentation including all parameters, return types, and mock object methods:
- [API Reference - `execute()`](./api-reference.md#execute)
- [API Reference - Mocking Methods](./api-reference.md#mocking-methods)
- [API Reference - Mock Object Methods](./api-reference.md#mock-object-methods)
- [API Reference - Mock Object Properties](./api-reference.md#mock-object-properties)
- [API Reference - Electron Class Mock](./api-reference.md#electron-class-mock)
