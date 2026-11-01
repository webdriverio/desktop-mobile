import type { ElectronFunctionMock } from '@wdio/native-types';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { buildMockMethods, restoreElectronFunctionality } from '../src/mockFactory.js';

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

beforeEach(() => {
  mockFn = vi.fn();
  mockExecute = vi.fn();
  globalThis.browser = {
    electron: {
      execute: mockExecute,
    },
  } as unknown as WebdriverIO.Browser;
});

describe('restoreElectronFunctionality()', () => {
  it('should call mockRestore on the function when available', async () => {
    const mockRestoreFn = vi.fn();
    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
      return fn({ app: { getName: { mockRestore: mockRestoreFn } } }, ...args);
    });

    const result = await restoreElectronFunctionality('app', 'getName', globalThis.browser);

    expect(mockRestoreFn).toHaveBeenCalledTimes(1);
    expect(result).toBe('SUCCESS_MOCK_RESTORE');
  });

  it('should restore from originalApi as a fallback', async () => {
    const originalFn = () => 'original';
    const electronApp: Record<string, unknown> = { getName: () => 'current' };
    const electron = { app: electronApp };

    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
      (globalThis as Record<string, unknown>).originalApi = { app: { getName: originalFn } };
      return fn(electron, ...args);
    });

    const result = await restoreElectronFunctionality('app', 'getName', globalThis.browser);

    expect(electronApp.getName).toBe(originalFn);
    expect(result).toBe('SUCCESS_FALLBACK');
  });

  it('should return the in-app error rather than reject, so a mock of a missing API still restores', async () => {
    const electron = {
      get app(): never {
        throw new Error('app is gone');
      },
    };
    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(electron, ...args));

    await expect(restoreElectronFunctionality('app', 'getName', globalThis.browser)).resolves.toBe(
      'ERROR: Error: app is gone',
    );
  });

  it('should return NO_RESTORE_AVAILABLE when no restore path exists', async () => {
    const electronApp: Record<string, unknown> = { getName: () => 'current' };
    const electron = { app: electronApp };

    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
      delete (globalThis as Record<string, unknown>).originalApi;
      return fn(electron, ...args);
    });

    const result = await restoreElectronFunctionality('app', 'getName', globalThis.browser);

    expect(result).toBe('NO_RESTORE_AVAILABLE');
  });
});

describe('buildMockMethods() when the app call fails', () => {
  let outerMock: Mock;
  let mock: ElectronFunctionMock;

  beforeEach(async () => {
    outerMock = vi.fn() as unknown as Mock;
    outerMock.getMockName = vi.fn(() => 'electron.app.getName');
    outerMock.mockName = vi.fn();
    outerMock.mockClear = vi.fn();
    outerMock.mockReset = vi.fn();
    outerMock.mockImplementation = vi.fn();
    outerMock.mockImplementationOnce = vi.fn();
    mock = vi.fn() as unknown as ElectronFunctionMock;

    await buildMockMethods(mock, {
      accessor: { kind: 'api', apiName: 'app', funcName: 'getName' },
      outerMock,
      outerMockClear: outerMock.mockClear.bind(outerMock),
      outerMockReset: outerMock.mockReset.bind(outerMock),
      outerMockImplementation: outerMock.mockImplementation.bind(outerMock),
      outerMockImplementationOnce: outerMock.mockImplementationOnce.bind(outerMock),
      browserToUse: globalThis.browser,
    });
    mockExecute.mockRejectedValue(new Error('WebSocket is not connected'));
  });

  it.each(['mockClear', 'mockReset', 'mockRestore'] as const)(
    'should leave the outer mock alone when %s fails',
    async (op) => {
      await expect(mock[op]()).rejects.toMatchObject({ message: 'WebSocket is not connected' });

      expect(outerMock.mockClear).not.toHaveBeenCalled();
      expect(outerMock.mockReset).not.toHaveBeenCalled();
      expect(mockExecute).toHaveBeenCalledOnce();
    },
  );
});

describe('buildMockMethods() with prototype accessor', () => {
  let innerMock: Record<string, Mock>;
  let outerMock: Mock;
  let mock: ElectronFunctionMock;

  beforeEach(async () => {
    innerMock = {
      mockImplementation: vi.fn(),
      mockImplementationOnce: vi.fn(),
      mockReturnValue: vi.fn(),
      mockReturnValueOnce: vi.fn(),
      mockResolvedValue: vi.fn(),
      mockResolvedValueOnce: vi.fn(),
      mockRejectedValue: vi.fn(),
      mockRejectedValueOnce: vi.fn(),
      mockClear: vi.fn(),
      mockReset: vi.fn(),
      mockReturnThis: vi.fn(),
    };

    class MockTray {}
    MockTray.prototype.setTitle = innerMock;

    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
      fn({ Tray: MockTray }, ...args),
    );

    outerMock = vi.fn() as unknown as Mock;
    outerMock.getMockName = vi.fn(() => 'electron.Tray.setTitle');
    outerMock.mockName = vi.fn();
    outerMock.mockClear = vi.fn();
    outerMock.mockReset = vi.fn();
    outerMock.mockImplementation = vi.fn();
    outerMock.mockImplementationOnce = vi.fn();

    mock = vi.fn() as unknown as ElectronFunctionMock;

    await buildMockMethods(mock, {
      accessor: { kind: 'prototype', className: 'Tray', methodName: 'setTitle' },
      outerMock,
      outerMockClear: outerMock.mockClear.bind(outerMock),
      outerMockReset: outerMock.mockReset.bind(outerMock),
      outerMockImplementation: outerMock.mockImplementation.bind(outerMock),
      outerMockImplementationOnce: outerMock.mockImplementationOnce.bind(outerMock),
      browserToUse: globalThis.browser,
    });

    mockExecute.mockClear();
  });

  it('should route mockImplementation to the prototype method', async () => {
    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
      class MockTray {}
      MockTray.prototype.setTitle = innerMock;
      return fn({ Tray: MockTray }, ...args);
    });

    await mock.mockImplementation(() => 'mocked');

    expect(innerMock.mockImplementation).toHaveBeenCalledTimes(1);
  });

  it('should route mockClear to the prototype method and outer mock', async () => {
    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
      class MockTray {}
      MockTray.prototype.setTitle = innerMock;
      return fn({ Tray: MockTray }, ...args);
    });

    await mock.mockClear();

    expect(innerMock.mockClear).toHaveBeenCalledTimes(1);
    expect(outerMock.mockClear).toHaveBeenCalledTimes(1);
  });

  it('should restore prototype method from __protoOriginals on mockRestore', async () => {
    const originalFn = () => 'original setTitle';
    const trayPrototype: Record<string, unknown> = { setTitle: () => 'current' };

    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
      (globalThis as Record<string, unknown>).__protoOriginals = { Tray: { setTitle: originalFn } };
      return fn({ Tray: { prototype: trayPrototype } }, ...args);
    });

    await mock.mockRestore();

    expect(trayPrototype.setTitle).toBe(originalFn);
  });

  it('should delete the prototype method if __protoOriginals has no entry on mockRestore', async () => {
    const trayPrototype: Record<string, unknown> = { setTitle: () => 'current' };

    mockExecute.mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
      delete (globalThis as Record<string, unknown>).__protoOriginals;
      return fn({ Tray: { prototype: trayPrototype } }, ...args);
    });

    await mock.mockRestore();

    expect(Object.hasOwn(trayPrototype, 'setTitle')).toBe(false);
  });
});
