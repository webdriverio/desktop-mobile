import { type Mock, fn as vitestFn } from '@wdio/native-spy';
import { parseCallData } from '@wdio/native-spy/interceptor';
import type { ElectronClassMock, ElectronFunctionMock, ExecuteOpts } from '@wdio/native-types';
import { createLogger, runBulkMockOp } from '@wdio/native-utils';
import { buildMockMethods, type MockApplyData, type MockReadAccessor } from './mockFactory.js';
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
      if (!globalApi.__protoOriginals) {
        globalApi.__protoOriginals = {};
      }
      if (!globalApi.__protoOriginals[className]) {
        globalApi.__protoOriginals[className] = {};
      }
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

  const applyCalls = (data: MockApplyData) => {
    const calls = data.calls ?? [];
    const results = data.results ?? [];
    const existingCount = originalMock.calls.length;
    if (existingCount < calls.length) {
      for (let i = existingCount; i < calls.length; i++) {
        (originalMock.calls as unknown[][]).push(calls[i]);
        (originalMock.results as { type: string; value: unknown }[]).push(
          results[i] ?? { type: 'return', value: undefined },
        );
        (originalMock.invocationCallOrder as number[]).push(originalMock.invocationCallOrder.length);
      }
    }
  };

  mock.__accessor = { kind: 'prototype', className, methodName } satisfies MockReadAccessor;
  mock.__applyCalls = applyCalls;

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
        // JSON has no undefined or Error, so mark them for parseCallData to restore.
        const replacer = (_k: string, v: unknown) => {
          if (v === undefined) {
            return { __wdioUndefined: true };
          }
          if (v instanceof Error) {
            return { __wdioError: true, name: v.name, message: v.message, stack: v.stack };
          }
          return v;
        };
        const calls = mockObj?.mock?.calls ? JSON.parse(JSON.stringify(mockObj.mock.calls, replacer)) : [];
        const results = mockObj?.mock?.results ? JSON.parse(JSON.stringify(mockObj.mock.results, replacer)) : [];
        return { calls, results };
      },
      className,
      methodName,
      { internal: true },
    )) ?? { calls: [], results: [] };

    applyCalls(parseCallData(syncData));
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
      if (!ElectronClass || typeof ElectronClass !== 'function') {
        return null;
      }
      const methods = new Set<string>();
      let proto: object | null = ElectronClass.prototype;
      while (proto && proto !== Object.prototype) {
        const ctorName = (proto as { constructor?: { name?: string } }).constructor?.name ?? '';
        if (ctorName === 'EventEmitter') {
          break;
        }
        Object.getOwnPropertyNames(proto).forEach((name) => {
          if (name === 'constructor') {
            return;
          }
          const desc = Object.getOwnPropertyDescriptor(proto as object, name);
          if (desc && typeof desc.value === 'function') {
            methods.add(name);
          }
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
    mockStore.setMock(browserToUse, methodMock);
  }

  const constructorMock = vitestFn() as unknown as ElectronFunctionMock;
  constructorMock.mockName(`electron.${className}.__constructor`);
  constructorMock.__isElectronMock = true;
  const constructorOuterMock = constructorMock as unknown as Mock;
  const constructorOriginalMock = constructorOuterMock.mock;
  // buildMockMethods replaces withImplementation with one that runs in the app.
  const outerWithImplementation = constructorOuterMock.withImplementation.bind(constructorOuterMock);

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
            if (classMocks && typeof key === 'string' && key in classMocks) {
              return classMocks[key];
            }
            return Reflect.get(target, key);
          },
        });
      }
      ((globalThis as Record<string, unknown>).__electronClassMocks as Record<string, unknown>)[className] = MockClass;
    },
    className,
    { internal: true },
  );

  // Replays the app's calls through the outer mock so they join the call order shared with other mocks.
  // The implementation runs only in the app, so the replay uses a no-op and records the app's results.
  const applyConstructorCalls = (data: MockApplyData) => {
    const calls = data.calls ?? [];
    const results = data.results ?? [];
    const existingCount = constructorOriginalMock.calls.length;
    if (existingCount < calls.length) {
      // Load-bearing for diagnosing constructor-mock sync races
      log.debug(
        `[${className}.__constructor] applying ${calls.length - existingCount} new constructor calls (inner=${calls.length}, outer=${existingCount})`,
      );
      outerWithImplementation(
        () => undefined,
        () => {
          for (let i = existingCount; i < calls.length; i++) {
            (constructorMock as unknown as (...args: unknown[]) => unknown).apply(
              constructorMock,
              calls[i] as unknown[],
            );
            (constructorOriginalMock.results as { type: string; value: unknown }[])[i] = results[i] ?? {
              type: 'return',
              value: undefined,
            };
          }
        },
      );
    }
  };

  await buildMockMethods(constructorMock, {
    accessor: { kind: 'constructor', className },
    outerMock: constructorOuterMock,
    outerMockClear: constructorOuterMock.mockClear.bind(constructorOuterMock),
    outerMockReset: constructorOuterMock.mockReset.bind(constructorOuterMock),
    outerMockImplementation: constructorOuterMock.mockImplementation.bind(constructorOuterMock),
    outerMockImplementationOnce: constructorOuterMock.mockImplementationOnce.bind(constructorOuterMock),
    browserToUse,
  });

  constructorMock.__accessor = { kind: 'constructor', className } satisfies MockReadAccessor;
  constructorMock.__applyCalls = applyConstructorCalls;

  constructorMock.update = async () => {
    const syncData = (await browserToUse.electron.execute<
      { calls: unknown[][]; results: { type: string; value: unknown }[] },
      [string, ExecuteOpts]
    >(
      (electron, className) => {
        const mockObj = electron[className as keyof typeof electron] as unknown as
          | { mock?: { calls?: unknown[][]; results?: { type: string; value: unknown }[] } }
          | undefined;
        // JSON has no undefined or Error, so mark them for parseCallData to restore.
        const replacer = (_k: string, v: unknown) => {
          if (v === undefined) {
            return { __wdioUndefined: true };
          }
          if (v instanceof Error) {
            return { __wdioError: true, name: v.name, message: v.message, stack: v.stack };
          }
          return v;
        };
        const calls = mockObj?.mock?.calls ? JSON.parse(JSON.stringify(mockObj.mock.calls, replacer)) : [];
        const results = mockObj?.mock?.results ? JSON.parse(JSON.stringify(mockObj.mock.results, replacer)) : [];
        return { calls, results };
      },
      className,
      { internal: true },
    )) ?? { calls: [], results: [] };

    applyConstructorCalls(parseCallData(syncData));
    return constructorMock;
  };

  stubInstance.__constructor = constructorMock;
  mockStore.setMock(browserToUse, constructorMock);

  stubInstance.mockRestore = async () => {
    const mocks = [
      ...methodNames.map((methodName) => stubInstance[methodName] as ElectronFunctionMock),
      constructorMock,
    ];
    await runBulkMockOp(
      mocks.map((mock) => [mock.getMockName(), mock] as const),
      'mockRestore',
    );
  };

  (stubInstance as ElectronClassMock).getMockName = () => `electron.${className}`;

  return stubInstance as ElectronClassMock;
}
