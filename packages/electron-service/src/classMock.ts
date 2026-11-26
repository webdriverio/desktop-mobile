import { type Mock, fn as vitestFn } from '@wdio/native-spy';
import type { ElectronClassMock, ElectronFunctionMock, ExecuteOpts } from '@wdio/native-types';
import { createLogger, runBulkMockOp } from '@wdio/native-utils';
import { buildMockMethods, type MockApplyData, type MockReadAccessor } from './mockFactory.js';
import mockStore from './mockStore.js';
import { applyAppCalls, updateNativeMock } from './nativeMockSync.js';

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
  outerMock.mockName(`electron.${className}.${methodName}`);
  // buildMockMethods replaces withImplementation with one that runs in the app.
  const outerWithImplementation = outerMock.withImplementation.bind(outerMock);

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

  const accessor = { kind: 'prototype', className, methodName } satisfies MockReadAccessor;
  await buildMockMethods(mock, {
    accessor,
    outerMock,
    outerMockClear: outerMock.mockClear.bind(outerMock),
    outerMockReset: outerMock.mockReset.bind(outerMock),
    outerMockImplementation: outerMock.mockImplementation.bind(outerMock),
    outerMockImplementationOnce: outerMock.mockImplementationOnce.bind(outerMock),
    browserToUse,
  });

  const applyCalls = (data: MockApplyData) => applyAppCalls(outerMock, outerWithImplementation, data);

  mock.__accessor = accessor;
  mock.__applyCalls = applyCalls;

  mock.update = async () => {
    await updateNativeMock(browserToUse, accessor, applyCalls);
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

  const constructorAccessor = { kind: 'constructor', className } satisfies MockReadAccessor;
  const applyConstructorCalls = (data: MockApplyData) =>
    applyAppCalls(constructorOuterMock, outerWithImplementation, data);

  await buildMockMethods(constructorMock, {
    accessor: constructorAccessor,
    outerMock: constructorOuterMock,
    outerMockClear: constructorOuterMock.mockClear.bind(constructorOuterMock),
    outerMockReset: constructorOuterMock.mockReset.bind(constructorOuterMock),
    outerMockImplementation: constructorOuterMock.mockImplementation.bind(constructorOuterMock),
    outerMockImplementationOnce: constructorOuterMock.mockImplementationOnce.bind(constructorOuterMock),
    browserToUse,
  });

  constructorMock.__accessor = constructorAccessor;
  constructorMock.__applyCalls = applyConstructorCalls;

  constructorMock.update = async () => {
    await updateNativeMock(browserToUse, constructorAccessor, applyConstructorCalls);
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
