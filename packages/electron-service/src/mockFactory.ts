import type { Mock } from '@wdio/native-spy';
import type { AbstractFn, ElectronFunctionMock, ElectronType, ExecuteOpts } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

const log = createLogger('electron-service', 'mock');

// ============================================================================
// Accessor — describes how to reach the inner mock inside the Electron process.
// Must be JSON-serialisable so it can cross the CDP boundary as an argument.
// ============================================================================

export type MockAccessor =
  | { kind: 'api'; apiName: string; funcName: string }
  | { kind: 'prototype'; className: string; methodName: string }
  | { kind: 'constructor'; className: string };

// The keys from `electron` to the inner mock. A class constructor's inner mock is the class itself,
// which a Proxy on `electron` serves in place of the real one.
function innerMockPath(accessor: MockAccessor): string[] {
  switch (accessor.kind) {
    case 'api':
      return [accessor.apiName, accessor.funcName];
    case 'prototype':
      return [accessor.className, 'prototype', accessor.methodName];
    case 'constructor':
      return [accessor.className];
  }
}

/**
 * Shape of mock call data delivered to a mock's `__applyCalls()` by the
 * batched scheduler. Each mock variant uses what it needs and ignores the
 * rest (API mocks ignore results; browser-mode mocks consume invocationCallOrder).
 */
export interface MockApplyData {
  calls: unknown[][];
  results?: Array<{ type: string; value: unknown }>;
  invocationCallOrder?: number[];
}

// Re-export the user-facing accessor type from native-types under the local
// `MockReadAccessor` alias for use across service modules.
export type { ElectronMockReadAccessor as MockReadAccessor } from '@wdio/native-types';

// ============================================================================
// Restore helper for API-function mocks
// ============================================================================

export async function restoreElectronFunctionality(
  apiName: string,
  funcName: string,
  browserContext?: WebdriverIO.Browser,
) {
  const browserToUse = browserContext || browser;
  const result = await browserToUse.electron.execute<string, [string, string, ExecuteOpts]>(
    (electron, apiName, funcName) => {
      try {
        const electronApi = electron[apiName as keyof typeof electron] as unknown as Record<
          string,
          { mockRestore?: () => void }
        >;
        const fn = electronApi[funcName];

        if (fn?.mockRestore) {
          fn.mockRestore();
          return 'SUCCESS_MOCK_RESTORE';
        }

        const originalApi = globalThis.originalApi as unknown as Record<string, Record<string, () => unknown>>;
        const originalFn = originalApi?.[apiName]?.[funcName];
        if (originalFn) {
          const targetApi = electron[apiName as keyof typeof electron] as unknown as Record<string, () => unknown>;
          targetApi[funcName] = originalFn;
          return 'SUCCESS_FALLBACK';
        }

        return 'NO_RESTORE_AVAILABLE';
      } catch (e) {
        return `ERROR: ${String(e)}`;
      }
    },
    apiName,
    funcName,
    { internal: true },
  );
  log.debug(`[${apiName}.${funcName}] restoreElectronFunctionality result:`, result);
  return result;
}

// ============================================================================
// Shared mock-method factory
//
// Assigns the async mock methods to `mock`. Each runs a script in the Electron main process, which is
// serialized, so it resolves the inner mock's key path itself. Callers assign `update`.
// ============================================================================

interface BuildMockMethodsOpts {
  accessor: MockAccessor;
  outerMock: Mock;
  outerMockClear: () => void;
  outerMockReset: () => void;
  outerMockImplementation: (fn: AbstractFn) => unknown;
  outerMockImplementationOnce: (fn: AbstractFn) => unknown;
  browserToUse: WebdriverIO.Browser;
}

export async function buildMockMethods(mock: ElectronFunctionMock, opts: BuildMockMethodsOpts): Promise<void> {
  const {
    accessor,
    outerMock,
    outerMockClear,
    outerMockReset,
    outerMockImplementation,
    outerMockImplementationOnce,
    browserToUse,
  } = opts;
  const path = innerMockPath(accessor);

  mock.mockImplementation = async (implFn: AbstractFn) => {
    await browserToUse.electron.execute<void, [string[], string, ExecuteOpts]>(
      (electron, path, implStr) => {
        const innerMock = path.reduce<unknown>(
          (target, key) => (target as Record<string, unknown>)[key],
          electron,
        ) as Mock;
        const impl = new Function(`return ${implStr}`)() as AbstractFn;
        innerMock.mockImplementation(impl);
      },
      path,
      implFn.toString(),
      { internal: true },
    );
    outerMockImplementation(implFn);
    return mock;
  };

  mock.mockImplementationOnce = async (implFn: AbstractFn) => {
    await browserToUse.electron.execute<void, [string[], string, ExecuteOpts]>(
      (electron, path, implStr) => {
        const innerMock = path.reduce<unknown>(
          (target, key) => (target as Record<string, unknown>)[key],
          electron,
        ) as Mock;
        const impl = new Function(`return ${implStr}`)() as AbstractFn;
        innerMock.mockImplementationOnce(impl);
      },
      path,
      implFn.toString(),
      { internal: true },
    );
    outerMockImplementationOnce(implFn);
    return mock;
  };

  mock.mockReturnValue = async (value: unknown) => {
    await browserToUse.electron.execute<void, [string[], unknown, ExecuteOpts]>(
      (electron, path, returnValue) => {
        const innerMock = path.reduce<unknown>(
          (target, key) => (target as Record<string, unknown>)[key],
          electron,
        ) as Mock;
        innerMock.mockReturnValue(returnValue);
      },
      path,
      value,
      { internal: true },
    );
    return mock;
  };

  mock.mockReturnValueOnce = async (value: unknown) => {
    await browserToUse.electron.execute<void, [string[], unknown, ExecuteOpts]>(
      (electron, path, returnValue) => {
        const innerMock = path.reduce<unknown>(
          (target, key) => (target as Record<string, unknown>)[key],
          electron,
        ) as Mock;
        innerMock.mockReturnValueOnce(returnValue);
      },
      path,
      value,
      { internal: true },
    );
    return mock;
  };

  mock.mockResolvedValue = async (value: unknown) => {
    await browserToUse.electron.execute<void, [string[], unknown, ExecuteOpts]>(
      (electron, path, resolvedValue) => {
        const innerMock = path.reduce<unknown>(
          (target, key) => (target as Record<string, unknown>)[key],
          electron,
        ) as Mock;
        innerMock.mockResolvedValue(resolvedValue);
      },
      path,
      value,
      { internal: true },
    );
    return mock;
  };

  mock.mockResolvedValueOnce = async (value: unknown) => {
    await browserToUse.electron.execute<void, [string[], unknown, ExecuteOpts]>(
      (electron, path, resolvedValue) => {
        const innerMock = path.reduce<unknown>(
          (target, key) => (target as Record<string, unknown>)[key],
          electron,
        ) as Mock;
        innerMock.mockResolvedValueOnce(resolvedValue);
      },
      path,
      value,
      { internal: true },
    );
    return mock;
  };

  mock.mockRejectedValue = async (value: unknown) => {
    if (value instanceof Error) {
      await browserToUse.electron.execute<void, [string[], string, ExecuteOpts]>(
        (electron, path, errMsg) => {
          const innerMock = path.reduce<unknown>(
            (target, key) => (target as Record<string, unknown>)[key],
            electron,
          ) as Mock;
          innerMock.mockRejectedValue(new Error(errMsg));
        },
        path,
        value.message,
        { internal: true },
      );
    } else {
      await browserToUse.electron.execute<void, [string[], unknown, ExecuteOpts]>(
        (electron, path, rejectedValue) => {
          const innerMock = path.reduce<unknown>(
            (target, key) => (target as Record<string, unknown>)[key],
            electron,
          ) as Mock;
          innerMock.mockRejectedValue(rejectedValue);
        },
        path,
        value,
        { internal: true },
      );
    }
    return mock;
  };

  mock.mockRejectedValueOnce = async (value: unknown) => {
    if (value instanceof Error) {
      await browserToUse.electron.execute<void, [string[], string, ExecuteOpts]>(
        (electron, path, errMsg) => {
          const innerMock = path.reduce<unknown>(
            (target, key) => (target as Record<string, unknown>)[key],
            electron,
          ) as Mock;
          innerMock.mockRejectedValueOnce(new Error(errMsg));
        },
        path,
        value.message,
        { internal: true },
      );
    } else {
      await browserToUse.electron.execute<void, [string[], unknown, ExecuteOpts]>(
        (electron, path, rejectedValue) => {
          const innerMock = path.reduce<unknown>(
            (target, key) => (target as Record<string, unknown>)[key],
            electron,
          ) as Mock;
          innerMock.mockRejectedValueOnce(rejectedValue);
        },
        path,
        value,
        { internal: true },
      );
    }
    return mock;
  };

  mock.mockClear = async () => {
    await browserToUse.electron.execute<void, [string[], ExecuteOpts]>(
      (electron, path) => {
        const innerMock = path.reduce<unknown>(
          (target, key) => (target as Record<string, unknown> | undefined)?.[key],
          electron,
        ) as Mock | undefined;
        innerMock?.mockClear?.();
      },
      path,
      { internal: true },
    );
    outerMockClear();
    return mock;
  };

  mock.mockReset = async () => {
    const currentName = outerMock.getMockName();
    await browserToUse.electron.execute<void, [string[], ExecuteOpts]>(
      (electron, path) => {
        const innerMock = path.reduce<unknown>(
          (target, key) => (target as Record<string, unknown> | undefined)?.[key],
          electron,
        ) as Mock | undefined;
        innerMock?.mockReset?.();
      },
      path,
      { internal: true },
    );
    // Temporarily restore the sync mockClear so outerMockReset's internal mockFn.mockClear()
    // doesn't fire the async CDP override unawaited, racing against the explicit await below.
    const asyncMockClearFn = mock.mockClear;
    (mock as unknown as { mockClear: () => void }).mockClear = outerMockClear;
    outerMockReset();
    mock.mockClear = asyncMockClearFn;
    outerMock.mockName(currentName);
    await mock.mockClear();
    return mock;
  };

  mock.mockRestore = async () => {
    if (accessor.kind === 'api') {
      await restoreElectronFunctionality(accessor.apiName, accessor.funcName, browserToUse);
    } else if (accessor.kind === 'prototype') {
      await browserToUse.electron.execute<void, [string, string, ExecuteOpts]>(
        (electron, className, methodName) => {
          const cls = electron[className as keyof typeof electron] as unknown as {
            prototype: Record<string, () => unknown>;
          };
          const globalApi = globalThis as unknown as Record<string, Record<string, Record<string, () => unknown>>>;
          const originalFn = globalApi.__protoOriginals?.[className]?.[methodName];
          if (originalFn !== undefined) {
            cls.prototype[methodName] = originalFn;
          } else {
            delete cls.prototype[methodName];
          }
        },
        accessor.className,
        accessor.methodName,
        { internal: true },
      );
    } else {
      await browserToUse.electron.execute<void, [string, ExecuteOpts]>(
        (_electron, className) => {
          const classMocks = (globalThis as Record<string, unknown>).__electronClassMocks as
            | Record<string, unknown>
            | undefined;
          if (classMocks) {
            delete classMocks[className];
          }
        },
        accessor.className,
        { internal: true },
      );
    }
    outerMockClear();
    return mock;
  };

  mock.mockReturnThis = async () => {
    await browserToUse.electron.execute<void, [string[], ExecuteOpts]>(
      (electron, path) => {
        const innerMock = path.reduce<unknown>(
          (target, key) => (target as Record<string, unknown>)[key],
          electron,
        ) as Mock;
        innerMock.mockReturnThis();
      },
      path,
      { internal: true },
    );
    return mock;
  };

  mock.withImplementation = async <ReturnValue>(
    implFn: AbstractFn,
    callbackFn: (electron: ElectronType) => ReturnValue,
  ): Promise<Awaited<ReturnValue>> => {
    // Unlike the setters, this isn't an internal command, so the callback's errors reject and the
    // mocks sync afterwards.
    return (await browserToUse.electron.execute<unknown, [string[], string, string]>(
      async (electron, path, implFnStr, callbackFnStr) => {
        const innerMock = path.reduce<unknown>(
          (target, key) => (target as Record<string, unknown> | undefined)?.[key],
          electron,
        ) as { withImplementation?: (impl: unknown, cb: () => unknown) => unknown } | undefined;
        if (typeof innerMock?.withImplementation !== 'function') {
          throw new Error(`${path.filter((key) => key !== 'prototype').join('.')} is not mocked`);
        }
        const impl = new Function(`return ${implFnStr}`)() as AbstractFn;
        const callback = new Function(`return ${callbackFnStr}`)() as AbstractFn;
        let result: unknown;
        await innerMock.withImplementation(impl, async () => {
          result = await callback(electron);
        });
        return result;
      },
      path,
      implFn.toString(),
      callbackFn.toString(),
    )) as Awaited<ReturnValue>;
  };
}
