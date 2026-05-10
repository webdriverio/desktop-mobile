import { type Mock, fn as vitestFn } from '@wdio/native-spy';
import type { AbstractFn, ElectronClassMock, ElectronFunctionMock, ExecuteOpts } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';
import { buildMockMethods } from './mockFactory.js';
import mockStore from './mockStore.js';

const log = createLogger('electron-service', 'mock');

// ============================================================================
// Prototype mock — one instance method on a class
// ============================================================================

async function createPrototypeMock(
  className: string,
  methodName: string,
  browserToUse: WebdriverIO.Browser,
): Promise<ElectronFunctionMock> {
  const outerMock = vitestFn();
  const originalMock = outerMock.mock;
  outerMock.mockName(`electron.${className}.${methodName}`);

  const mock = outerMock as unknown as ElectronFunctionMock;
  mock.__isElectronMock = true;

  await browserToUse.electron.execute<void, [string, string, ExecuteOpts]>(
    async (electron, className, methodName) => {
      const spy = await import('@wdio/native-spy');
      const cls = electron[className as keyof typeof electron] as unknown as {
        prototype: Record<string, () => unknown>;
      };
      const originalFn = cls.prototype[methodName];

      const globalApi = globalThis as unknown as Record<string, Record<string, Record<string, () => unknown>>>;
      if (!globalApi.__protoOriginals) globalApi.__protoOriginals = {};
      if (!globalApi.__protoOriginals[className]) globalApi.__protoOriginals[className] = {};
      globalApi.__protoOriginals[className][methodName] = originalFn;

      cls.prototype[methodName] = spy.fn(undefined, { original: originalFn });
    },
    className,
    methodName,
    { internal: true },
  );

  await buildMockMethods(mock, {
    accessor: { kind: 'prototype', className, methodName },
    outerMock,
    outerMockClear: outerMock.mockClear.bind(outerMock),
    outerMockReset: outerMock.mockReset.bind(outerMock),
    outerMockImplementation: outerMock.mockImplementation.bind(outerMock),
    outerMockImplementationOnce: outerMock.mockImplementationOnce.bind(outerMock),
    browserToUse,
  });

  mock.update = async () => {
    const syncData = (await browserToUse.electron.execute<
      { calls: unknown[][]; results: { type: string; value: unknown }[] },
      [string, string, ExecuteOpts]
    >(
      (electron, className, methodName) => {
        const cls = electron[className as keyof typeof electron] as unknown as { prototype: Record<string, unknown> };
        const mockObj = cls?.prototype?.[methodName] as
          | { mock?: { calls?: unknown[][]; results?: { type: string; value: unknown }[] } }
          | undefined;
        const calls = mockObj?.mock?.calls ? JSON.parse(JSON.stringify(mockObj.mock.calls)) : [];
        const results = mockObj?.mock?.results ? JSON.parse(JSON.stringify(mockObj.mock.results)) : [];
        return { calls, results };
      },
      className,
      methodName,
      { internal: true },
    )) ?? { calls: [], results: [] };

    const existingCount = originalMock.calls.length;
    if (existingCount < syncData.calls.length) {
      for (let i = existingCount; i < syncData.calls.length; i++) {
        (originalMock.calls as unknown[][]).push(syncData.calls[i]);
        (originalMock.results as { type: string; value: unknown }[]).push(
          syncData.results[i] ?? { type: 'return', value: undefined },
        );
        (originalMock.invocationCallOrder as number[]).push(originalMock.invocationCallOrder.length);
      }
    }
    return mock;
  };

  return mock;
}

// ============================================================================
// Class mock
// ============================================================================

/**
 * Creates a mock for an Electron class (e.g. Tray, BrowserWindow).
 * Returns a stub with a `__constructor` mock for tracking instantiation and
 * an `ElectronFunctionMock` for each instance method found on the prototype chain.
 */
export async function createClassMock(
  className: string,
  browserContext?: WebdriverIO.Browser,
): Promise<ElectronClassMock> {
  const browserToUse = browserContext || browser;

  const methodNames = await browserToUse.electron.execute<string[] | null, [string, ExecuteOpts]>(
    (electron, className) => {
      const ElectronClass = electron[className as keyof typeof electron] as
        | (new (
            ...args: unknown[]
          ) => unknown)
        | undefined;
      if (!ElectronClass || typeof ElectronClass !== 'function') return null;
      const methods = new Set<string>();
      let proto: object | null = ElectronClass.prototype;
      while (proto && proto !== Object.prototype) {
        const ctorName = (proto as { constructor?: { name?: string } }).constructor?.name ?? '';
        if (ctorName === 'EventEmitter') break;
        Object.getOwnPropertyNames(proto).forEach((name) => {
          if (name === 'constructor') return;
          const desc = Object.getOwnPropertyDescriptor(proto as object, name);
          if (desc && typeof desc.value === 'function') methods.add(name);
        });
        proto = Object.getPrototypeOf(proto) as object | null;
      }
      return [...methods];
    },
    className,
    { internal: true },
  );

  if (!methodNames) {
    // Diagnostic: helps surface mis-typed class names or absent main-process classes
    log.debug(`[${className}] class not found on electron object; returning empty stub`);
    const stubInstance: Record<string, unknown> = {};
    const constructorMock = vitestFn() as unknown as ElectronFunctionMock;
    constructorMock.mockName(`electron.${className}.__constructor`);
    constructorMock.__isElectronMock = true;
    constructorMock.update = async () => constructorMock;
    stubInstance.__constructor = constructorMock;
    (stubInstance as ElectronClassMock).getMockName = () => `electron.${className}`;
    (stubInstance as Record<string, unknown>).mockRestore = async () => {};
    return stubInstance as ElectronClassMock;
  }

  // Diagnostic: helps when a method assertion fails because the method wasn't discovered
  log.debug(`[${className}] discovered ${methodNames.length} methods: ${methodNames.join(', ')}`);

  const stubInstance: Record<string, ElectronFunctionMock | (() => Promise<void>)> = {};
  for (const methodName of methodNames) {
    const methodMock = await createPrototypeMock(className, methodName, browserToUse);
    stubInstance[methodName] = methodMock;
    mockStore.setMock(methodMock);
  }

  const constructorMock = vitestFn() as unknown as ElectronFunctionMock;
  constructorMock.mockName(`electron.${className}.__constructor`);
  constructorMock.__isElectronMock = true;
  const constructorOriginalMock = (constructorMock as unknown as Mock).mock;
  const constructorOuterMockClear = (constructorMock as unknown as Mock).mockClear.bind(constructorMock);
  const constructorOuterMockReset = (constructorMock as unknown as Mock).mockReset.bind(constructorMock);

  await browserToUse.electron.execute<void, [string, ExecuteOpts]>(
    async (_electron, className) => {
      const spy = await import('@wdio/native-spy');
      const origElectron = (globalThis as Record<string, unknown>).electron as Record<string, unknown>;
      const OriginalClass = origElectron[className] as new (...args: unknown[]) => unknown;

      if (!globalThis.originalApi) {
        (globalThis as Record<string, unknown>).originalApi = {};
      }
      (globalThis.originalApi as Record<string, unknown>)[className] = OriginalClass;

      const MockClass = spy.fn() as unknown as typeof OriginalClass;
      MockClass.prototype = OriginalClass.prototype;
      Object.setPrototypeOf(MockClass, OriginalClass);

      if (!(globalThis as Record<string, unknown>).__electronClassMocks) {
        (globalThis as Record<string, unknown>).__electronClassMocks = {};
        (globalThis as Record<string, unknown>).electron = new Proxy(origElectron, {
          get(target, key) {
            const classMocks = (globalThis as Record<string, unknown>).__electronClassMocks as Record<string, unknown>;
            if (classMocks && typeof key === 'string' && key in classMocks) return classMocks[key];
            return Reflect.get(target, key);
          },
        });
      }
      ((globalThis as Record<string, unknown>).__electronClassMocks as Record<string, unknown>)[className] = MockClass;
    },
    className,
    { internal: true },
  );

  constructorMock.update = async () => {
    const calls =
      (await browserToUse.electron.execute<unknown[][], [string, ExecuteOpts]>(
        (electron, className) => {
          const mockObj = electron[className as keyof typeof electron] as unknown as {
            mock?: { calls?: unknown[][] };
          };
          return mockObj?.mock?.calls ? JSON.parse(JSON.stringify(mockObj.mock.calls)) : [];
        },
        className,
        { internal: true },
      )) ?? [];

    const existingCount = constructorOriginalMock.calls.length;
    if (existingCount < calls.length) {
      // Load-bearing for diagnosing constructor-mock sync races
      log.debug(
        `[${className}.__constructor] mock.update: applying ${calls.length - existingCount} new constructor calls (inner=${calls.length}, outer=${existingCount})`,
      );
      for (let i = existingCount; i < calls.length; i++) {
        (constructorMock as unknown as (...args: unknown[]) => unknown).apply(constructorMock, calls[i] as unknown[]);
      }
    }
    return constructorMock;
  };

  constructorMock.mockImplementationOnce = async (implFn: AbstractFn) => {
    await browserToUse.electron.execute<void, [string, string, ExecuteOpts]>(
      (electron, className, implStr) => {
        const mockObj = electron[className as keyof typeof electron] as unknown as Mock;
        const impl = new Function(`return ${implStr}`)() as AbstractFn;
        mockObj.mockImplementationOnce(impl);
      },
      className,
      implFn.toString(),
      { internal: true },
    );
    return constructorMock;
  };

  constructorMock.mockClear = async () => {
    await browserToUse.electron.execute<void, [string, ExecuteOpts]>(
      (electron, className) => {
        const mockObj = electron[className as keyof typeof electron] as unknown as Mock;
        mockObj.mockClear();
      },
      className,
      { internal: true },
    );
    constructorOuterMockClear();
    return constructorMock;
  };

  constructorMock.mockReset = async () => {
    await browserToUse.electron.execute<void, [string, ExecuteOpts]>(
      (electron, className) => {
        const mockObj = electron[className as keyof typeof electron] as unknown as Mock;
        mockObj.mockReset();
      },
      className,
      { internal: true },
    );
    // Temporarily restore the sync mockClear so constructorOuterMockReset's internal
    // mockFn.mockClear() doesn't fire the async CDP override unawaited, racing against
    // the explicit await below.
    const asyncMockClearFn = constructorMock.mockClear;
    (constructorMock as unknown as { mockClear: () => void }).mockClear = constructorOuterMockClear;
    constructorOuterMockReset();
    constructorMock.mockClear = asyncMockClearFn;
    await constructorMock.mockClear();
    return constructorMock;
  };

  constructorMock.mockRestore = async () => {
    await browserToUse.electron.execute<void, [string, ExecuteOpts]>(
      (_electron, className) => {
        const classMocks = (globalThis as Record<string, unknown>).__electronClassMocks as
          | Record<string, unknown>
          | undefined;
        if (classMocks) {
          delete classMocks[className];
        }
      },
      className,
      { internal: true },
    );
    constructorOuterMockClear();
    return constructorMock;
  };

  stubInstance.__constructor = constructorMock;
  mockStore.setMock(constructorMock);

  stubInstance.mockRestore = async () => {
    for (const methodName of methodNames) {
      await (stubInstance[methodName] as ElectronFunctionMock).mockRestore();
    }
    await constructorMock.mockRestore();
  };

  (stubInstance as ElectronClassMock).getMockName = () => `electron.${className}`;

  return stubInstance as ElectronClassMock;
}
