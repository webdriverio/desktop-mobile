import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { createClassMock } from '../src/classMock.js';
import mockStore from '../src/mockStore.js';

let mockExecute: Mock;

function makeClassExecute(electron: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).electron = electron;
  return (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(electron, ...args);
}

// As in the app, scripts get the global `electron`, which a class mock replaces with a Proxy.
function makeAppExecute(electron: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).electron = electron;
  return (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
    fn((globalThis as Record<string, unknown>).electron, ...args);
}

function appClass(className: string) {
  return ((globalThis as Record<string, unknown>).electron as Record<string, new (...args: unknown[]) => unknown>)[
    className
  ];
}

beforeEach(() => {
  for (const key of ['electron', 'originalApi', '__protoOriginals', '__electronClassMocks']) {
    delete (globalThis as Record<string, unknown>)[key];
  }
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

  it("should create the mock in the given instance's app and store it under that instance", async () => {
    class MockTray {
      setImage() {}
    }
    const instanceExecute = vi.fn(makeClassExecute({ Tray: MockTray }));
    const instance = { electron: { execute: instanceExecute } } as unknown as WebdriverIO.Browser;

    const mockTray = await createClassMock('Tray', instance);

    expect(instanceExecute).toHaveBeenCalledTimes(3);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockStore.getMocks(instance)).toHaveLength(2);
    expect(mockStore.getMock(instance, 'electron.Tray.setImage')).toBe(mockTray.setImage);
    expect(mockStore.getMock(instance, 'electron.Tray.__constructor')).toBe(mockTray.__constructor);
    expect(mockStore.getMocks(globalThis.browser)).toEqual([]);
  });

  it("should run an instance's class mock operations in that instance's app", async () => {
    class MockTray {
      setImage() {}
    }
    const instanceExecute = vi.fn(makeClassExecute({ Tray: MockTray }));
    const instance = { electron: { execute: instanceExecute } } as unknown as WebdriverIO.Browser;
    const mockTray = await createClassMock('Tray', instance);
    instanceExecute.mockClear();

    await mockTray.setImage.update();
    await mockTray.setImage.mockClear();
    await mockTray.__constructor.update();

    expect(instanceExecute).toHaveBeenCalledTimes(3);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("should set the app's class constructor from the constructor mock", async () => {
    class MockTray {
      setImage() {}
    }
    mockExecute.mockImplementation(makeAppExecute({ Tray: MockTray }));
    const mockTray = await createClassMock('Tray');

    await mockTray.__constructor.mockReturnValue({ fake: 'tray' });
    expect(new (appClass('Tray'))()).toEqual({ fake: 'tray' });

    await mockTray.__constructor.mockImplementation((icon: string) => ({ icon }));
    expect(new (appClass('Tray'))('icon.png')).toEqual({ icon: 'icon.png' });

    await mockTray.__constructor.mockImplementation(() => {
      throw new Error('no tray');
    });
    expect(() => new (appClass('Tray'))()).toThrow('no tray');
  });

  it("should run the constructor's implementation in the app only, not when syncing its calls", async () => {
    class MockTray {
      setImage() {}
    }
    mockExecute.mockImplementation(makeAppExecute({ Tray: MockTray }));
    const mockTray = await createClassMock('Tray');
    await mockTray.__constructor.mockImplementation(() => {
      throw new Error('no tray');
    });
    expect(() => new (appClass('Tray'))()).toThrow('no tray');

    await mockTray.__constructor.update();

    expect((mockTray.__constructor as unknown as Mock).mock.calls).toEqual([[]]);
  });

  it("should copy the app's constructor results, thrown errors included, when syncing", async () => {
    class MockTray {
      setImage() {}
    }
    mockExecute.mockImplementation(makeAppExecute({ Tray: MockTray }));
    const mockTray = await createClassMock('Tray');
    await mockTray.__constructor.mockReturnValueOnce({ fake: 'tray' });
    new (appClass('Tray'))();
    await mockTray.__constructor.mockImplementation(() => {
      throw new Error('no tray');
    });
    expect(() => new (appClass('Tray'))()).toThrow('no tray');

    await mockTray.__constructor.update();

    const [returned, thrown] = (mockTray.__constructor as unknown as Mock).mock.results;
    expect(returned).toEqual({ type: 'return', value: { fake: 'tray' } });
    expect(thrown.type).toBe('throw');
    expect(thrown.value).toBeInstanceOf(Error);
    expect((thrown.value as Error).message).toBe('no tray');
  });

  it('should keep the implementation the constructor mock was given', async () => {
    class MockTray {
      setImage() {}
    }
    mockExecute.mockImplementation(makeAppExecute({ Tray: MockTray }));
    const mockTray = await createClassMock('Tray');
    const implementation = () => ({ fake: 'tray' });

    await mockTray.__constructor.mockImplementation(implementation);

    expect(mockTray.__constructor.getMockImplementation()).toBe(implementation);
  });

  it("should run every constructor mock operation in the instance's app", async () => {
    class MockTray {
      setImage() {}
    }
    const instanceExecute = vi.fn(makeAppExecute({ Tray: MockTray }));
    const instance = { electron: { execute: instanceExecute } } as unknown as WebdriverIO.Browser;
    const { __constructor: constructorMock } = await createClassMock('Tray', instance);
    const operations: Array<[string, () => Promise<unknown>]> = [
      ['mockImplementation', () => constructorMock.mockImplementation(() => undefined)],
      ['mockImplementationOnce', () => constructorMock.mockImplementationOnce(() => undefined)],
      ['mockReturnValue', () => constructorMock.mockReturnValue({})],
      ['mockReturnValueOnce', () => constructorMock.mockReturnValueOnce({})],
      ['mockResolvedValue', () => constructorMock.mockResolvedValue({})],
      ['mockResolvedValueOnce', () => constructorMock.mockResolvedValueOnce({})],
      ['mockRejectedValue', () => constructorMock.mockRejectedValue(new Error('no tray'))],
      ['mockRejectedValueOnce', () => constructorMock.mockRejectedValueOnce(new Error('no tray'))],
      ['mockReturnThis', () => constructorMock.mockReturnThis()],
      [
        'withImplementation',
        () =>
          constructorMock.withImplementation(
            () => undefined,
            () => undefined,
          ),
      ],
      ['mockClear', () => constructorMock.mockClear()],
      ['mockReset', () => constructorMock.mockReset()],
      ['mockRestore', () => constructorMock.mockRestore()],
      ['update', () => constructorMock.update()],
    ];

    const missedApp: string[] = [];
    for (const [name, operation] of operations) {
      instanceExecute.mockClear();
      await operation();
      if (instanceExecute.mock.calls.length === 0) {
        missedApp.push(name);
      }
    }
    expect(missedApp).toEqual([]);
    expect(mockExecute).not.toHaveBeenCalled();
    expect((globalThis as Record<string, Record<string, unknown>>).__electronClassMocks.Tray).toBeUndefined();
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

  it('should place synced prototype method calls in the call order shared with other mocks', async () => {
    class MockTray {
      setImage() {}
      setTitle() {}
    }
    mockExecute.mockImplementation(makeClassExecute({ Tray: MockTray }));
    const mockTray = await createClassMock('Tray');
    const callsOf = (methodName: string) => ({ Tray: { prototype: { [methodName]: { mock: { calls: [[]] } } } } });

    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
      fn(callsOf('setTitle'), ...args),
    );
    await mockTray.setTitle.update();
    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
      fn(callsOf('setImage'), ...args),
    );
    await mockTray.setImage.update();

    const [titleOrder] = (mockTray.setTitle as unknown as Mock).mock.invocationCallOrder;
    const [imageOrder] = (mockTray.setImage as unknown as Mock).mock.invocationCallOrder;
    expect(imageOrder).toBeGreaterThan(titleOrder);
  });

  it('should keep undefined arguments in synced prototype and constructor calls', async () => {
    class MockTray {
      setImage() {}
    }
    mockExecute.mockImplementation(makeClassExecute({ Tray: MockTray }));

    const mockTray = await createClassMock('Tray');

    const calls = [['/path/to/icon.png', undefined], [{ size: undefined }]];
    const electron = {
      Tray: {
        mock: { calls },
        prototype: { setImage: { mock: { calls, results: [{ type: 'return', value: [undefined] }] } } },
      },
    };
    // CDP returns the result as JSON.
    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
      JSON.parse(JSON.stringify(fn(electron, ...args))),
    );

    await mockTray.setImage.update();
    await mockTray.__constructor.update();

    const expected = [['/path/to/icon.png', undefined], [{ size: undefined }]];
    expect((mockTray.setImage as unknown as Mock).mock.calls).toStrictEqual(expected);
    expect((mockTray.setImage as unknown as Mock).mock.results[0]).toStrictEqual({
      type: 'return',
      value: [undefined],
    });
    expect((mockTray.__constructor as unknown as Mock).mock.calls).toStrictEqual(expected);
  });
});
