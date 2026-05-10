import { fn as vitestFn } from '@wdio/native-spy';
import { createIpcInterceptor } from '@wdio/native-spy/interceptor';
import type {
  AbstractFn,
  ElectronApiFn,
  ElectronFunctionMock,
  ElectronInterface,
  ElectronType,
  ExecuteOpts,
} from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';
import { buildMockMethods } from './mockFactory.js';

const log = createLogger('electron-service', 'mock');
const browserInterceptor = createIpcInterceptor('electron');

export { createClassMock } from './classMock.js';

export async function createMock(
  apiName: string,
  funcName: string,
  browserContext?: WebdriverIO.Browser,
): Promise<ElectronFunctionMock> {
  const outerMock = vitestFn();

  outerMock.mockName(`electron.${apiName}.${funcName}`);

  const mock = outerMock as unknown as ElectronFunctionMock;
  mock.__isElectronMock = true;

  const originalMock = outerMock.mock;

  const wrapperMock = ((...args: unknown[]) => {
    return (mock as (...args: unknown[]) => unknown)(...args);
  }) as ElectronFunctionMock;

  Object.setPrototypeOf(wrapperMock, Object.getPrototypeOf(mock));
  Object.getOwnPropertyNames(mock).forEach((key) => {
    if (key !== 'mock' && key !== 'length' && key !== 'name') {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(mock, key);
        if (descriptor) {
          Object.defineProperty(wrapperMock, key, descriptor);
        }
      } catch (_error) {
        // Skip properties that can't be copied
      }
    }
  });

  Object.defineProperty(wrapperMock, 'mock', {
    configurable: false,
    enumerable: false,
    get() {
      return originalMock;
    },
  });

  Object.defineProperty(wrapperMock, 'lastCall', {
    configurable: true,
    enumerable: true,
    get() {
      return originalMock.calls[originalMock.calls.length - 1];
    },
  });

  const browserToUse = browserContext || browser;

  await browserToUse.electron.execute<void, [string, string, ExecuteOpts]>(
    (electron, apiName, funcName) => {
      const electronApi = electron[apiName as keyof typeof electron] as unknown as Record<string, () => unknown>;
      const originalFn = electronApi[funcName];

      if (originalFn) {
        const globalOrigApi = globalThis as unknown as Record<string, Record<string, Record<string, () => unknown>>>;
        if (!globalOrigApi.originalApi) {
          globalOrigApi.originalApi = {};
        }
        if (!globalOrigApi.originalApi[apiName]) {
          globalOrigApi.originalApi[apiName] = {};
        }
        globalOrigApi.originalApi[apiName][funcName] = originalFn;
      }
    },
    apiName,
    funcName,
    { internal: true },
  );

  await browserToUse.electron.execute<void, [string, string, ExecuteOpts]>(
    async (electron, apiName, funcName) => {
      const electronApi = electron[apiName as keyof typeof electron];
      const spy = await import('@wdio/native-spy');

      const originalApi = globalThis.originalApi as unknown as Record<string, Record<string, () => unknown>>;
      const originalFn = originalApi?.[apiName]?.[funcName];

      const mockFn = spy.fn(
        function (this: unknown) {
          return undefined;
        },
        { original: originalFn },
      );

      electronApi[funcName as keyof typeof electronApi] = mockFn as ElectronApiFn;
    },
    apiName,
    funcName,
    { internal: true },
  );

  mock.update = async () => {
    const calls =
      (await browserToUse.electron.execute<unknown[][], [string, string, ExecuteOpts]>(
        (electron, apiName, funcName) => {
          const api = electron[apiName as keyof typeof electron];
          if (!api) return [];
          const mockObj = api[funcName as keyof ElectronType[ElectronInterface]] as ElectronFunctionMock;
          return mockObj?.mock?.calls ? JSON.parse(JSON.stringify(mockObj.mock?.calls)) : [];
        },
        apiName,
        funcName,
        { internal: true },
      )) ?? [];

    if (originalMock.calls.length < calls.length) {
      calls.forEach((call: unknown[], index: number) => {
        if (!originalMock.calls[index]) {
          mock?.apply(mock, call);
        }
      });
    }

    return mock;
  };

  await buildMockMethods(mock, {
    accessor: { kind: 'api', apiName, funcName },
    outerMock,
    outerMockClear: outerMock.mockClear.bind(outerMock),
    outerMockReset: outerMock.mockReset.bind(outerMock),
    outerMockImplementation: outerMock.mockImplementation.bind(outerMock),
    outerMockImplementationOnce: outerMock.mockImplementationOnce.bind(outerMock),
    browserToUse,
  });

  wrapperMock.mockImplementation = mock.mockImplementation.bind(mock);
  wrapperMock.mockImplementationOnce = mock.mockImplementationOnce.bind(mock);
  wrapperMock.getMockImplementation = mock.getMockImplementation.bind(mock);
  wrapperMock.mockReturnValue = mock.mockReturnValue.bind(mock);
  wrapperMock.mockReturnValueOnce = mock.mockReturnValueOnce.bind(mock);
  wrapperMock.mockResolvedValue = mock.mockResolvedValue.bind(mock);
  wrapperMock.mockResolvedValueOnce = mock.mockResolvedValueOnce.bind(mock);
  wrapperMock.mockRejectedValue = mock.mockRejectedValue.bind(mock);
  wrapperMock.mockRejectedValueOnce = mock.mockRejectedValueOnce.bind(mock);
  wrapperMock.mockClear = mock.mockClear.bind(mock);
  wrapperMock.mockReset = mock.mockReset.bind(mock);
  wrapperMock.mockRestore = async function (this: ElectronFunctionMock) {
    await mock.mockRestore();
    return this;
  };
  wrapperMock.mockReturnThis = mock.mockReturnThis.bind(mock);
  wrapperMock.withImplementation = mock.withImplementation.bind(mock);
  wrapperMock.update = mock.update.bind(mock);

  wrapperMock.__isElectronMock = true;

  return wrapperMock;
}

async function runInterceptorScript<T>(browser: WebdriverIO.Browser, script: string): Promise<T> {
  return browser.execute(`return (${script})()`) as Promise<T>;
}

export async function createElectronBrowserModeMock(
  channel: string,
  browser: WebdriverIO.Browser,
): Promise<ElectronFunctionMock> {
  log.debug(`[${channel}] createElectronBrowserModeMock called`);

  const outerMock = vitestFn();
  const outerMockImplementation = outerMock.mockImplementation.bind(outerMock);
  const outerMockImplementationOnce = outerMock.mockImplementationOnce.bind(outerMock);
  const outerMockClear = outerMock.mockClear.bind(outerMock);
  const outerMockReset = outerMock.mockReset.bind(outerMock);

  outerMock.mockName(`electron.${channel}`);

  const mock = outerMock as unknown as ElectronFunctionMock;
  mock.__isElectronMock = true;

  const originalMock = outerMock.mock;

  type ImplState =
    | { kind: 'returnValue' | 'resolvedValue' | 'rejectedValue'; value: unknown }
    | { kind: 'implementation'; fn: AbstractFn }
    | { kind: 'returnThis' }
    | null;
  let implState: ImplState = null;

  await runInterceptorScript<void>(browser, browserInterceptor.buildRegistrationScript(channel));

  mock.update = async () => {
    const raw = await runInterceptorScript<unknown>(browser, browserInterceptor.buildCallDataReadScript(channel));
    const syncData = browserInterceptor.parseCallData(raw);

    (originalMock.calls as unknown[][]).length = 0;
    (originalMock.results as { type: string; value: unknown }[]).length = 0;
    (originalMock.invocationCallOrder as number[]).length = 0;
    for (let i = 0; i < syncData.calls.length; i++) {
      (originalMock.calls as unknown[][]).push(syncData.calls[i]);
      (originalMock.results as { type: string; value: unknown }[]).push(
        syncData.results[i] ?? { type: 'return', value: undefined },
      );
      (originalMock.invocationCallOrder as number[]).push(
        syncData.invocationCallOrder[i] ?? originalMock.invocationCallOrder.length,
      );
    }
    return mock;
  };

  mock.mockImplementation = async (implFn: AbstractFn) => {
    implState = { kind: 'implementation', fn: implFn };
    const s = browserInterceptor.serializeHandler(implFn);
    await runInterceptorScript<void>(browser, browserInterceptor.buildSetImplementationScript(channel, s));
    outerMockImplementation(implFn);
    return mock;
  };

  mock.mockImplementationOnce = async (implFn: AbstractFn) => {
    const s = browserInterceptor.serializeHandler(implFn);
    await runInterceptorScript<void>(browser, browserInterceptor.buildSetImplementationScript(channel, s, true));
    outerMockImplementationOnce(implFn);
    return mock;
  };

  mock.mockReturnValue = async (value: unknown) => {
    implState = { kind: 'returnValue', value };
    await runInterceptorScript<void>(
      browser,
      browserInterceptor.buildInnerSetterScript(channel, 'mockReturnValue', value),
    );
    return mock;
  };

  mock.mockReturnValueOnce = async (value: unknown) => {
    await runInterceptorScript<void>(
      browser,
      browserInterceptor.buildInnerSetterScript(channel, 'mockReturnValueOnce', value),
    );
    return mock;
  };

  mock.mockResolvedValue = async (value: unknown) => {
    implState = { kind: 'resolvedValue', value };
    await runInterceptorScript<void>(
      browser,
      browserInterceptor.buildInnerSetterScript(channel, 'mockResolvedValue', value),
    );
    return mock;
  };

  mock.mockResolvedValueOnce = async (value: unknown) => {
    await runInterceptorScript<void>(
      browser,
      browserInterceptor.buildInnerSetterScript(channel, 'mockResolvedValueOnce', value),
    );
    return mock;
  };

  mock.mockRejectedValue = async (value: unknown) => {
    implState = { kind: 'rejectedValue', value };
    await runInterceptorScript<void>(
      browser,
      browserInterceptor.buildInnerSetterScript(channel, 'mockRejectedValue', value),
    );
    return mock;
  };

  mock.mockRejectedValueOnce = async (value: unknown) => {
    await runInterceptorScript<void>(
      browser,
      browserInterceptor.buildInnerSetterScript(channel, 'mockRejectedValueOnce', value),
    );
    return mock;
  };

  mock.mockClear = async () => {
    await runInterceptorScript<void>(browser, browserInterceptor.buildInnerInvocationScript(channel, 'mockClear'));
    outerMockClear();
    return mock;
  };

  mock.mockReset = async () => {
    implState = null;
    const currentName = outerMock.getMockName();
    await runInterceptorScript<void>(browser, browserInterceptor.buildInnerInvocationScript(channel, 'mockReset'));
    outerMockClear();
    outerMockReset();
    outerMock.mockName(currentName);
    return mock;
  };

  mock.mockRestore = async () => {
    implState = null;
    // There is no original Electron API to restore in browser mode — the IPC interceptor
    // is always synthetic. Deregistering the channel would make future ipcRenderer.invoke
    // calls throw "unmocked channel", breaking restoreMocks: true across tests.
    // Behave like mockReset: clear history and implementation but keep the channel alive.
    const currentName = outerMock.getMockName();
    await runInterceptorScript<void>(browser, browserInterceptor.buildInnerInvocationScript(channel, 'mockReset'));
    outerMockClear();
    outerMockReset();
    outerMock.mockName(currentName);
    return mock;
  };

  mock.mockReturnThis = async () => {
    implState = { kind: 'returnThis' };
    await runInterceptorScript<void>(browser, browserInterceptor.buildInnerInvocationScript(channel, 'mockReturnThis'));
    return mock;
  };

  mock.withImplementation = async (implFn, callbackFn) => {
    const script = browserInterceptor.buildWithImplementationScript(
      channel,
      implFn as (...a: unknown[]) => unknown,
      callbackFn as (...a: unknown[]) => unknown,
    );
    const result = await browser.executeAsync((s: string, done: (v: unknown) => void) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function('return (' + s + ')')() as () => Promise<unknown>;
      Promise.resolve(fn()).then(done, (err: unknown) => {
        done({ __wdioAsyncErr__: err instanceof Error ? err.message : String(err) });
      });
    }, script);
    if (result && typeof result === 'object' && '__wdioAsyncErr__' in result) {
      throw new Error((result as { __wdioAsyncErr__: string }).__wdioAsyncErr__);
    }
    await mock.update();
    return result;
  };

  // Used by the re-registration path in service.ts to replay persistent implementation
  // after a navigation wipes window.__wdio_mocks__. "Once" variants are intentionally
  // excluded — they were consumed before the navigation.
  (mock as unknown as Record<string, unknown>).__replayBrowserImpl = async (): Promise<void> => {
    if (!implState) return;
    if (implState.kind === 'implementation') {
      const s = browserInterceptor.serializeHandler(implState.fn);
      await runInterceptorScript<void>(browser, browserInterceptor.buildSetImplementationScript(channel, s));
    } else if (implState.kind === 'returnThis') {
      await runInterceptorScript<void>(
        browser,
        browserInterceptor.buildInnerInvocationScript(channel, 'mockReturnThis'),
      );
    } else {
      const method =
        implState.kind === 'returnValue'
          ? 'mockReturnValue'
          : implState.kind === 'resolvedValue'
            ? 'mockResolvedValue'
            : 'mockRejectedValue';
      await runInterceptorScript<void>(
        browser,
        browserInterceptor.buildInnerSetterScript(channel, method, implState.value),
      );
    }
  };

  log.debug(`[${channel}] Electron browser-mode mock created successfully`);
  return mock;
}
