import type { Mock } from '@wdio/native-spy';
import type { AbstractFn, ElectronFunctionMock, ExecuteOpts } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

const log = createLogger('electron-service', 'mock');

// ============================================================================
// Accessor — describes how to reach the inner mock inside the Electron process.
// Must be JSON-serialisable so it can cross the CDP boundary as an argument.
// ============================================================================

export type MockAccessor =
  | { kind: 'api'; apiName: string; funcName: string }
  | { kind: 'prototype'; className: string; methodName: string };

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
// Assigns all 12 async mock methods to `mock` using the accessor to address the
// inner mock inside the Electron process. `update` is intentionally excluded —
// the two callers use different sync strategies and assign it themselves.
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

  mock.mockImplementation = async (implFn: AbstractFn) => {
    await browserToUse.electron.execute<void, [MockAccessor, string, ExecuteOpts]>(
      (electron, accessor, implStr) => {
        let innerMock: Mock;
        if (accessor.kind === 'api') {
          innerMock = (electron[accessor.apiName as keyof typeof electron] as unknown as Record<string, Mock>)[
            accessor.funcName
          ];
        } else {
          const cls = electron[accessor.className as keyof typeof electron] as unknown as {
            prototype: Record<string, Mock>;
          };
          innerMock = cls.prototype[accessor.methodName];
        }
        const impl = new Function(`return ${implStr}`)() as AbstractFn;
        innerMock.mockImplementation(impl);
      },
      accessor,
      implFn.toString(),
      { internal: true },
    );
    outerMockImplementation(implFn);
    return mock;
  };

  mock.mockImplementationOnce = async (implFn: AbstractFn) => {
    await browserToUse.electron.execute<void, [MockAccessor, string, ExecuteOpts]>(
      (electron, accessor, implStr) => {
        let innerMock: Mock;
        if (accessor.kind === 'api') {
          innerMock = (electron[accessor.apiName as keyof typeof electron] as unknown as Record<string, Mock>)[
            accessor.funcName
          ];
        } else {
          const cls = electron[accessor.className as keyof typeof electron] as unknown as {
            prototype: Record<string, Mock>;
          };
          innerMock = cls.prototype[accessor.methodName];
        }
        const impl = new Function(`return ${implStr}`)() as AbstractFn;
        innerMock.mockImplementationOnce(impl);
      },
      accessor,
      implFn.toString(),
      { internal: true },
    );
    outerMockImplementationOnce(implFn);
    return mock;
  };

  mock.mockReturnValue = async (value: unknown) => {
    await browserToUse.electron.execute<void, [MockAccessor, unknown, ExecuteOpts]>(
      (electron, accessor, returnValue) => {
        let innerMock: Mock;
        if (accessor.kind === 'api') {
          innerMock = (electron[accessor.apiName as keyof typeof electron] as unknown as Record<string, Mock>)[
            accessor.funcName
          ];
        } else {
          const cls = electron[accessor.className as keyof typeof electron] as unknown as {
            prototype: Record<string, Mock>;
          };
          innerMock = cls.prototype[accessor.methodName];
        }
        innerMock.mockReturnValue(returnValue);
      },
      accessor,
      value,
      { internal: true },
    );
    return mock;
  };

  mock.mockReturnValueOnce = async (value: unknown) => {
    await browserToUse.electron.execute<void, [MockAccessor, unknown, ExecuteOpts]>(
      (electron, accessor, returnValue) => {
        let innerMock: Mock;
        if (accessor.kind === 'api') {
          innerMock = (electron[accessor.apiName as keyof typeof electron] as unknown as Record<string, Mock>)[
            accessor.funcName
          ];
        } else {
          const cls = electron[accessor.className as keyof typeof electron] as unknown as {
            prototype: Record<string, Mock>;
          };
          innerMock = cls.prototype[accessor.methodName];
        }
        innerMock.mockReturnValueOnce(returnValue);
      },
      accessor,
      value,
      { internal: true },
    );
    return mock;
  };

  mock.mockResolvedValue = async (value: unknown) => {
    await browserToUse.electron.execute<void, [MockAccessor, unknown, ExecuteOpts]>(
      (electron, accessor, resolvedValue) => {
        let innerMock: Mock;
        if (accessor.kind === 'api') {
          innerMock = (electron[accessor.apiName as keyof typeof electron] as unknown as Record<string, Mock>)[
            accessor.funcName
          ];
        } else {
          const cls = electron[accessor.className as keyof typeof electron] as unknown as {
            prototype: Record<string, Mock>;
          };
          innerMock = cls.prototype[accessor.methodName];
        }
        innerMock.mockResolvedValue(resolvedValue);
      },
      accessor,
      value,
      { internal: true },
    );
    return mock;
  };

  mock.mockResolvedValueOnce = async (value: unknown) => {
    await browserToUse.electron.execute<void, [MockAccessor, unknown, ExecuteOpts]>(
      (electron, accessor, resolvedValue) => {
        let innerMock: Mock;
        if (accessor.kind === 'api') {
          innerMock = (electron[accessor.apiName as keyof typeof electron] as unknown as Record<string, Mock>)[
            accessor.funcName
          ];
        } else {
          const cls = electron[accessor.className as keyof typeof electron] as unknown as {
            prototype: Record<string, Mock>;
          };
          innerMock = cls.prototype[accessor.methodName];
        }
        innerMock.mockResolvedValueOnce(resolvedValue);
      },
      accessor,
      value,
      { internal: true },
    );
    return mock;
  };

  mock.mockRejectedValue = async (value: unknown) => {
    if (value instanceof Error) {
      await browserToUse.electron.execute<void, [MockAccessor, string, ExecuteOpts]>(
        (electron, accessor, errMsg) => {
          let innerMock: Mock;
          if (accessor.kind === 'api') {
            innerMock = (electron[accessor.apiName as keyof typeof electron] as unknown as Record<string, Mock>)[
              accessor.funcName
            ];
          } else {
            const cls = electron[accessor.className as keyof typeof electron] as unknown as {
              prototype: Record<string, Mock>;
            };
            innerMock = cls.prototype[accessor.methodName];
          }
          innerMock.mockRejectedValue(new Error(errMsg));
        },
        accessor,
        value.message,
        { internal: true },
      );
    } else {
      await browserToUse.electron.execute<void, [MockAccessor, unknown, ExecuteOpts]>(
        (electron, accessor, rejectedValue) => {
          let innerMock: Mock;
          if (accessor.kind === 'api') {
            innerMock = (electron[accessor.apiName as keyof typeof electron] as unknown as Record<string, Mock>)[
              accessor.funcName
            ];
          } else {
            const cls = electron[accessor.className as keyof typeof electron] as unknown as {
              prototype: Record<string, Mock>;
            };
            innerMock = cls.prototype[accessor.methodName];
          }
          innerMock.mockRejectedValue(rejectedValue);
        },
        accessor,
        value,
        { internal: true },
      );
    }
    return mock;
  };

  mock.mockRejectedValueOnce = async (value: unknown) => {
    if (value instanceof Error) {
      await browserToUse.electron.execute<void, [MockAccessor, string, ExecuteOpts]>(
        (electron, accessor, errMsg) => {
          let innerMock: Mock;
          if (accessor.kind === 'api') {
            innerMock = (electron[accessor.apiName as keyof typeof electron] as unknown as Record<string, Mock>)[
              accessor.funcName
            ];
          } else {
            const cls = electron[accessor.className as keyof typeof electron] as unknown as {
              prototype: Record<string, Mock>;
            };
            innerMock = cls.prototype[accessor.methodName];
          }
          innerMock.mockRejectedValueOnce(new Error(errMsg));
        },
        accessor,
        value.message,
        { internal: true },
      );
    } else {
      await browserToUse.electron.execute<void, [MockAccessor, unknown, ExecuteOpts]>(
        (electron, accessor, rejectedValue) => {
          let innerMock: Mock;
          if (accessor.kind === 'api') {
            innerMock = (electron[accessor.apiName as keyof typeof electron] as unknown as Record<string, Mock>)[
              accessor.funcName
            ];
          } else {
            const cls = electron[accessor.className as keyof typeof electron] as unknown as {
              prototype: Record<string, Mock>;
            };
            innerMock = cls.prototype[accessor.methodName];
          }
          innerMock.mockRejectedValueOnce(rejectedValue);
        },
        accessor,
        value,
        { internal: true },
      );
    }
    return mock;
  };

  mock.mockClear = async () => {
    await browserToUse.electron.execute<void, [MockAccessor, ExecuteOpts]>(
      (electron, accessor) => {
        let innerMock: Mock | undefined;
        if (accessor.kind === 'api') {
          innerMock = (electron[accessor.apiName as keyof typeof electron] as unknown as Record<string, Mock>)?.[
            accessor.funcName
          ];
        } else {
          const cls = electron[accessor.className as keyof typeof electron] as unknown as
            | { prototype: Record<string, Mock> }
            | undefined;
          innerMock = cls?.prototype?.[accessor.methodName];
        }
        innerMock?.mockClear?.();
      },
      accessor,
      { internal: true },
    );
    outerMockClear();
    return mock;
  };

  mock.mockReset = async () => {
    const currentName = outerMock.getMockName();
    await browserToUse.electron.execute<void, [MockAccessor, ExecuteOpts]>(
      (electron, accessor) => {
        let innerMock: Mock | undefined;
        if (accessor.kind === 'api') {
          innerMock = (electron[accessor.apiName as keyof typeof electron] as unknown as Record<string, Mock>)?.[
            accessor.funcName
          ];
        } else {
          const cls = electron[accessor.className as keyof typeof electron] as unknown as
            | { prototype: Record<string, Mock> }
            | undefined;
          innerMock = cls?.prototype?.[accessor.methodName];
        }
        innerMock?.mockReset?.();
      },
      accessor,
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
    } else {
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
    }
    outerMockClear();
    return mock;
  };

  mock.mockReturnThis = async () => {
    await browserToUse.electron.execute<void, [MockAccessor, ExecuteOpts]>(
      (electron, accessor) => {
        let innerMock: Mock;
        if (accessor.kind === 'api') {
          innerMock = (electron[accessor.apiName as keyof typeof electron] as unknown as Record<string, Mock>)[
            accessor.funcName
          ];
        } else {
          const cls = electron[accessor.className as keyof typeof electron] as unknown as {
            prototype: Record<string, Mock>;
          };
          innerMock = cls.prototype[accessor.methodName];
        }
        innerMock.mockReturnThis();
      },
      accessor,
      { internal: true },
    );
    return mock;
  };

  mock.withImplementation = async (implFn, callbackFn) => {
    return await browserToUse.electron.execute<unknown, [MockAccessor, string, string, ExecuteOpts]>(
      async (electron, accessor, implFnStr, callbackFnStr) => {
        let innerMock: { withImplementation?: (impl: unknown, cb: () => unknown) => unknown } | undefined;
        if (accessor.kind === 'api') {
          innerMock = (electron[accessor.apiName as keyof typeof electron] as unknown as Record<string, unknown>)[
            accessor.funcName
          ] as typeof innerMock;
        } else {
          const cls = electron[accessor.className as keyof typeof electron] as unknown as {
            prototype: Record<string, unknown>;
          };
          innerMock = cls.prototype[accessor.methodName] as typeof innerMock;
        }
        const impl = new Function(`return ${implFnStr}`)() as AbstractFn;
        const callback = new Function(`return ${callbackFnStr}`)() as AbstractFn;
        let result: unknown | Promise<unknown>;
        if (innerMock?.withImplementation) {
          innerMock.withImplementation(impl, () => {
            result = callback(electron);
          });
        } else {
          result = callback(electron);
        }
        return (result as Promise<unknown>)?.then ? await result : result;
      },
      accessor,
      implFn.toString(),
      callbackFn.toString(),
      { internal: true },
    );
  };
}
