import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { createClassMock } from '../src/classMock.js';

let mockFn: Mock;
let mockExecute: Mock;

vi.doMock('@wdio/native-spy', () => ({
  fn: (_impl: unknown, options?: { original?: (...args: unknown[]) => unknown }) => {
    if (options?.original) {
      const originalFn = options.original;
      mockFn.mockRestore = vi.fn(function () {
        mockFn.mockClear();
        mockFn.mockImplementation(originalFn);
        return mockFn;
      }) as unknown as typeof mockFn.mockRestore;
    }
    return mockFn;
  },
}));

function makeClassExecute(electron: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).electron = electron;
  return (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(electron, ...args);
}

beforeEach(() => {
  mockFn = vi.fn();
  mockExecute = vi.fn();
  globalThis.browser = {
    electron: {
      execute: mockExecute,
    },
  } as unknown as WebdriverIO.Browser;
});

describe('createClassMock()', () => {
  it('should create a mock with methods from the class prototype', async () => {
    class MockTray {
      setImage() {}
      destroy() {}
      setContextMenu() {}
    }
    mockExecute.mockImplementation(makeClassExecute({ Tray: MockTray }));

    const mockTray = await createClassMock('Tray');

    expect(mockTray.setImage).toBeDefined();
    expect(mockTray.destroy).toBeDefined();
    expect(mockTray.setContextMenu).toBeDefined();
  });

  it('should have a __constructor property that is a mock function', async () => {
    class MockBrowserWindow {
      loadURL() {}
    }
    mockExecute.mockImplementation(makeClassExecute({ BrowserWindow: MockBrowserWindow }));

    const mockBrowserWindow = await createClassMock('BrowserWindow');

    expect(mockBrowserWindow.__constructor).toBeDefined();
    expect(mockBrowserWindow.__constructor.getMockName()).toBe('electron.BrowserWindow.__constructor');
  });

  it('should sync constructor calls from inner mock via update()', async () => {
    class MockTray {
      setImage() {}
    }
    mockExecute.mockImplementation(makeClassExecute({ Tray: MockTray }));

    const mockTray = await createClassMock('Tray');

    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, className: unknown) => {
      return fn(
        {
          Tray: {
            mock: {
              calls: [['/path/to/icon.png'], ['/path/to/other-icon.png']],
            },
          },
        },
        className,
      );
    });

    await mockTray.__constructor.update();
    const constructorMock = mockTray.__constructor as unknown as Mock;

    expect(constructorMock).toHaveBeenCalledTimes(2);
    expect(constructorMock).toHaveBeenCalledWith('/path/to/icon.png');
    expect(constructorMock).toHaveBeenCalledWith('/path/to/other-icon.png');
  });

  it('should call execute to restore the original class on mockRestore', async () => {
    class MockTray {
      setImage() {}
    }
    mockExecute.mockImplementation(makeClassExecute({ Tray: MockTray }));

    const mockTray = await createClassMock('Tray');

    mockExecute.mockClear();
    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
      fn({ Tray: MockTray }, ...args),
    );
    await mockTray.mockRestore();

    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockExecute).toHaveBeenCalledWith(expect.any(Function), 'Tray', { internal: true });
  });

  it('should restore the other methods and the constructor before reporting a failed method restore', async () => {
    class MockTray {
      setImage() {}
      destroy() {}
    }
    mockExecute.mockImplementation(makeClassExecute({ Tray: MockTray }));
    const mockTray = await createClassMock('Tray');
    mockExecute.mockClear();
    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
      if (args[1] === 'setImage') {
        throw new Error('inner restore failed');
      }
      return fn({ Tray: MockTray }, ...args);
    });

    await expect(mockTray.mockRestore()).rejects.toMatchObject({
      message: 'mockRestore failed: electron.Tray.setImage: inner restore failed',
    });

    expect(mockExecute).toHaveBeenCalledWith(expect.any(Function), 'Tray', 'destroy', { internal: true });
    expect(mockExecute).toHaveBeenCalledWith(expect.any(Function), 'Tray', { internal: true });
  });

  it('should return electron.ClassName from getMockName', async () => {
    class MockTray {
      setImage() {}
    }
    mockExecute.mockImplementation(makeClassExecute({ Tray: MockTray }));

    const mockTray = await createClassMock('Tray');

    expect(mockTray.getMockName()).toBe('electron.Tray');
  });

  it('should return an empty stub for non-class APIs', async () => {
    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, className: unknown) => {
      return fn({ app: { getName: () => 'test' } }, className);
    });

    const stub = await createClassMock('app');

    expect(stub.__constructor).toBeDefined();
    expect(stub.getMockName()).toBe('electron.app');
  });

  it('should give prototype method mocks the correct name', async () => {
    class MockTray {
      setImage() {}
    }
    mockExecute.mockImplementation(makeClassExecute({ Tray: MockTray }));

    const mockTray = await createClassMock('Tray');

    expect(mockTray.setImage.getMockName()).toBe('electron.Tray.setImage');
  });

  it('should give prototype method mocks all expected mock methods', async () => {
    class MockTray {
      setImage() {}
    }
    mockExecute.mockImplementation(makeClassExecute({ Tray: MockTray }));

    const mockTray = await createClassMock('Tray');

    expect(mockTray.setImage.mockImplementation).toBeDefined();
    expect(mockTray.setImage.mockReturnValue).toBeDefined();
    expect(mockTray.setImage.mockClear).toBeDefined();
    expect(mockTray.setImage.mockReset).toBeDefined();
    expect(mockTray.setImage.mockRestore).toBeDefined();
    expect(mockTray.setImage.update).toBeDefined();
  });

  it('should sync prototype method calls via update()', async () => {
    class MockTray {
      setImage() {}
    }
    mockExecute.mockImplementation(makeClassExecute({ Tray: MockTray }));

    const mockTray = await createClassMock('Tray');

    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
      return fn(
        {
          Tray: {
            prototype: {
              setImage: {
                mock: {
                  calls: [['/path/to/icon.png']],
                  results: [{ type: 'return', value: undefined }],
                },
              },
            },
          },
        },
        ...args,
      );
    });

    await mockTray.setImage.update();
    const setImageMock = mockTray.setImage as unknown as Mock;

    expect(setImageMock).toHaveBeenCalledTimes(1);
    expect(setImageMock).toHaveBeenCalledWith('/path/to/icon.png');
  });
});
