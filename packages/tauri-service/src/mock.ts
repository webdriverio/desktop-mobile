import { fn as vitestFn } from '@wdio/native-spy';
import { createIpcInterceptor } from '@wdio/native-spy/interceptor';
import type { AbstractFn, TauriExecuteOptions, TauriMock } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';
import { execute as tauriExecute } from './commands/execute.js';
import mockStore from './mockStore.js';
import { getCurrentWindowLabel } from './window.js';

const log = createLogger('tauri-service', 'mock');
const interceptor = createIpcInterceptor('tauri');
const WINDOW_CLOSED = Symbol('window closed');

function isBrowserMode(browser: WebdriverIO.Browser): boolean {
  return !!(browser as unknown as Record<string, unknown>).__wdioBrowserMode__;
}

async function runInterceptorScript<T>(browser: WebdriverIO.Browser, script: string): Promise<T> {
  return browser.execute(`return (${script})()`) as Promise<T>;
}

export async function createMock(command: string, browserContext?: WebdriverIO.Browser): Promise<TauriMock> {
  const browserToUse = (browserContext || browser) as WebdriverIO.Browser;
  if (isBrowserMode(browserToUse)) {
    return createBrowserModeMock(command, browserToUse);
  }

  const outerMock = vitestFn();
  const outerMockImplementation = outerMock.mockImplementation;
  const outerMockImplementationOnce = outerMock.mockImplementationOnce;
  const outerMockClear = outerMock.mockClear;
  const outerMockReset = outerMock.mockReset;

  outerMock.mockName(`tauri.${command}`);

  const mock = outerMock as unknown as TauriMock;

  mock.__isTauriMock = true;

  const originalMock = outerMock.mock;

  const wrapperMock = ((...args: unknown[]) => {
    return (mock as (...args: unknown[]) => unknown)(...args);
  }) as TauriMock;

  Object.setPrototypeOf(wrapperMock, Object.getPrototypeOf(mock));
  Object.getOwnPropertyNames(mock).forEach((key) => {
    if (key !== 'mock' && key !== 'length' && key !== 'name') {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(mock, key);
        if (descriptor) {
          Object.defineProperty(wrapperMock, key, descriptor);
        }
      } catch (_error) {}
    }
  });

  Object.defineProperty(wrapperMock, 'mock', {
    configurable: false,
    enumerable: false,
    get() {
      return originalMock;
    },
  });

  const registeredWindowLabel = await tauriExecute<string | undefined>(
    browserToUse,
    interceptor.buildRegistrationScript(command),
  );
  const windowLabel =
    typeof registeredWindowLabel === 'string' && registeredWindowLabel.length > 0
      ? registeredWindowLabel
      : getCurrentWindowLabel(browserToUse);
  const executeOptions = { windowLabel, __wdioOptions__: true } as TauriExecuteOptions;
  const executeInMockWindow = <T>(script: string): Promise<T> =>
    tauriExecute<T, [TauriExecuteOptions]>(browserToUse, script, executeOptions);
  // Once the mock's window closes, its in-app half is gone with it. update, mockClear, mockReset and
  // mockRestore then skip the app, since there's nothing left there to sync, clear or remove.
  // The setters and withImplementation need to throw if the window doesn't exist, so they call
  // executeInMockWindow directly.
  const executeUnlessWindowClosed = async <T>(script: string): Promise<T | typeof WINDOW_CLOSED> => {
    try {
      return await executeInMockWindow<T>(script);
    } catch (error) {
      if (error instanceof Error && error.message.includes(`'${windowLabel}' not found`)) {
        return WINDOW_CLOSED;
      }
      throw error;
    }
  };

  mock.update = async () => {
    const raw = await executeUnlessWindowClosed<unknown>(interceptor.buildCallDataReadScript(command));
    if (raw === WINDOW_CLOSED) {
      return mock;
    }
    const syncData = interceptor.parseCallData(raw);

    const existingCount = originalMock.calls.length;

    if (syncData.calls.length < existingCount) {
      log.debug(`[${command}] Inner mock shrank (cleared after reload or reset); replacing outer data`);
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
    } else if (existingCount < syncData.calls.length) {
      // Load-bearing for diagnosing mock-sync races: shows inner/outer call counts
      // at the moment update() mutates state, so empty-mock.calls assertions can be
      // traced back to a specific sync.
      log.debug(
        `[${command}] mock.update: applying ${syncData.calls.length - existingCount} new calls (inner=${syncData.calls.length}, outer=${existingCount})`,
      );
      for (let i = existingCount; i < syncData.calls.length; i++) {
        (originalMock.calls as unknown[][]).push(syncData.calls[i]);
        (originalMock.results as { type: string; value: unknown }[]).push(
          syncData.results[i] ?? { type: 'return', value: undefined },
        );
        (originalMock.invocationCallOrder as number[]).push(
          syncData.invocationCallOrder[i] ?? originalMock.invocationCallOrder.length,
        );
      }
    }

    return mock;
  };

  mock.mockImplementation = async (implFn: AbstractFn) => {
    const s = interceptor.serializeHandler(implFn);
    await executeInMockWindow<void>(interceptor.buildSetImplementationScript(command, s));
    outerMockImplementation(implFn);
    return mock;
  };

  mock.mockImplementationOnce = async (implFn: AbstractFn) => {
    const s = interceptor.serializeHandler(implFn);
    await executeInMockWindow<void>(interceptor.buildSetImplementationScript(command, s, true));
    outerMockImplementationOnce(implFn);
    return mock;
  };

  mock.mockReturnValue = async (value: unknown) => {
    await executeInMockWindow<void>(interceptor.buildInnerSetterScript(command, 'mockReturnValue', value));
    return mock;
  };

  mock.mockReturnValueOnce = async (value: unknown) => {
    await executeInMockWindow<void>(interceptor.buildInnerSetterScript(command, 'mockReturnValueOnce', value));
    return mock;
  };

  mock.mockResolvedValue = async (value: unknown) => {
    await executeInMockWindow<void>(interceptor.buildInnerSetterScript(command, 'mockResolvedValue', value));
    return mock;
  };

  mock.mockResolvedValueOnce = async (value: unknown) => {
    await executeInMockWindow<void>(interceptor.buildInnerSetterScript(command, 'mockResolvedValueOnce', value));
    return mock;
  };

  mock.mockRejectedValue = async (value: unknown) => {
    await executeInMockWindow<void>(interceptor.buildInnerSetterScript(command, 'mockRejectedValue', value));
    return mock;
  };

  mock.mockRejectedValueOnce = async (value: unknown) => {
    await executeInMockWindow<void>(interceptor.buildInnerSetterScript(command, 'mockRejectedValueOnce', value));
    return mock;
  };

  mock.mockClear = async () => {
    await executeUnlessWindowClosed<void>(interceptor.buildInnerInvocationScript(command, 'mockClear'));
    outerMockClear();
    return mock;
  };

  mock.mockReset = async () => {
    const currentName = outerMock.getMockName();

    await executeUnlessWindowClosed<void>(interceptor.buildInnerInvocationScript(command, 'mockReset'));

    // Temporarily restore the sync mockClear so outerMockReset's internal mockFn.mockClear()
    // call doesn't fire the async override, which would defer outerMockClear() and race
    // against auto-sync populating state.calls.
    const asyncMockClearFn = mock.mockClear;
    (mock as unknown as { mockClear: () => void }).mockClear = outerMockClear;
    wrapperMock.mockClear = outerMockClear as unknown as typeof wrapperMock.mockClear;
    outerMockClear();
    outerMockReset();
    mock.mockClear = asyncMockClearFn;
    wrapperMock.mockClear = asyncMockClearFn;
    outerMock.mockName(currentName);

    return mock;
  };

  mock.mockRestore = async () => {
    try {
      await executeUnlessWindowClosed<void>(interceptor.buildUnregistrationScript(command));
    } finally {
      outerMockClear();
      mockStore.deleteMock(browserToUse, `tauri.${command}`);
    }
    return mock;
  };

  mock.mockReturnThis = async () => {
    await executeInMockWindow<void>(interceptor.buildInnerInvocationScript(command, 'mockReturnThis'));
    return mock;
  };

  mock.withImplementation = async (implFn, callbackFn) => {
    const result = await executeInMockWindow<unknown>(
      interceptor.buildWithImplementationScript(
        command,
        implFn as (...a: unknown[]) => unknown,
        callbackFn as (...a: unknown[]) => unknown,
      ),
    );
    // The wire result is the callback's (serialized) return value; TS can't connect an
    // assigned arrow's body to the contextual generic, so assert it back.
    return result as ReturnType<typeof callbackFn>;
  };

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
  wrapperMock.mockRestore = mock.mockRestore.bind(mock);
  wrapperMock.mockReturnThis = mock.mockReturnThis.bind(mock);
  wrapperMock.withImplementation = mock.withImplementation.bind(mock);
  wrapperMock.update = mock.update.bind(mock);

  wrapperMock.__isTauriMock = true;

  return wrapperMock;
}

async function createBrowserModeMock(command: string, browser: WebdriverIO.Browser): Promise<TauriMock> {
  const outerMock = vitestFn();
  const outerMockImplementation = outerMock.mockImplementation;
  const outerMockImplementationOnce = outerMock.mockImplementationOnce;
  const outerMockClear = outerMock.mockClear;
  const outerMockReset = outerMock.mockReset;

  outerMock.mockName(`tauri.${command}`);

  const mock = outerMock as unknown as TauriMock;
  mock.__isTauriMock = true;

  const originalMock = outerMock.mock;

  await runInterceptorScript<void>(browser, interceptor.buildRegistrationScript(command));

  mock.update = async () => {
    const raw = await runInterceptorScript<unknown>(browser, interceptor.buildCallDataReadScript(command));
    const syncData = interceptor.parseCallData(raw);

    const existingCount = originalMock.calls.length;
    if (syncData.calls.length < existingCount) {
      log.debug(`[${command}] Browser-mode inner mock shrank; replacing outer data`);
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
    } else if (existingCount < syncData.calls.length) {
      // Browser-mode: load-bearing for diagnosing mock-sync races (mirrors createMock).
      log.debug(
        `[${command}] browser-mode mock.update: applying ${syncData.calls.length - existingCount} new calls (inner=${syncData.calls.length}, outer=${existingCount})`,
      );
      for (let i = existingCount; i < syncData.calls.length; i++) {
        (originalMock.calls as unknown[][]).push(syncData.calls[i]);
        (originalMock.results as { type: string; value: unknown }[]).push(
          syncData.results[i] ?? { type: 'return', value: undefined },
        );
        (originalMock.invocationCallOrder as number[]).push(
          syncData.invocationCallOrder[i] ?? originalMock.invocationCallOrder.length,
        );
      }
    }
    return mock;
  };

  mock.mockImplementation = async (implFn: AbstractFn) => {
    const s = interceptor.serializeHandler(implFn);
    await runInterceptorScript<void>(browser, interceptor.buildSetImplementationScript(command, s));
    outerMockImplementation(implFn);
    return mock;
  };

  mock.mockImplementationOnce = async (implFn: AbstractFn) => {
    const s = interceptor.serializeHandler(implFn);
    await runInterceptorScript<void>(browser, interceptor.buildSetImplementationScript(command, s, true));
    outerMockImplementationOnce(implFn);
    return mock;
  };

  mock.mockReturnValue = async (value: unknown) => {
    await runInterceptorScript<void>(browser, interceptor.buildInnerSetterScript(command, 'mockReturnValue', value));
    return mock;
  };

  mock.mockReturnValueOnce = async (value: unknown) => {
    await runInterceptorScript<void>(
      browser,
      interceptor.buildInnerSetterScript(command, 'mockReturnValueOnce', value),
    );
    return mock;
  };

  mock.mockResolvedValue = async (value: unknown) => {
    await runInterceptorScript<void>(browser, interceptor.buildInnerSetterScript(command, 'mockResolvedValue', value));
    return mock;
  };

  mock.mockResolvedValueOnce = async (value: unknown) => {
    await runInterceptorScript<void>(
      browser,
      interceptor.buildInnerSetterScript(command, 'mockResolvedValueOnce', value),
    );
    return mock;
  };

  mock.mockRejectedValue = async (value: unknown) => {
    await runInterceptorScript<void>(browser, interceptor.buildInnerSetterScript(command, 'mockRejectedValue', value));
    return mock;
  };

  mock.mockRejectedValueOnce = async (value: unknown) => {
    await runInterceptorScript<void>(
      browser,
      interceptor.buildInnerSetterScript(command, 'mockRejectedValueOnce', value),
    );
    return mock;
  };

  mock.mockClear = async () => {
    await runInterceptorScript<void>(browser, interceptor.buildInnerInvocationScript(command, 'mockClear'));
    outerMockClear();
    return mock;
  };

  mock.mockReset = async () => {
    const currentName = outerMock.getMockName();
    await runInterceptorScript<void>(browser, interceptor.buildInnerInvocationScript(command, 'mockReset'));
    const asyncMockClearFn = mock.mockClear;
    (mock as unknown as { mockClear: () => void }).mockClear = outerMockClear;
    outerMockClear();
    outerMockReset();
    mock.mockClear = asyncMockClearFn;
    outerMock.mockName(currentName);
    return mock;
  };

  mock.mockRestore = async () => {
    try {
      await runInterceptorScript<void>(browser, interceptor.buildUnregistrationScript(command));
    } finally {
      outerMockClear();
      mockStore.deleteMock(browser, `tauri.${command}`);
    }
    return mock;
  };

  mock.mockReturnThis = async () => {
    await runInterceptorScript<void>(browser, interceptor.buildInnerInvocationScript(command, 'mockReturnThis'));
    return mock;
  };

  mock.withImplementation = async (implFn, callbackFn) => {
    const script = interceptor.buildWithImplementationScript(
      command,
      implFn as (...a: unknown[]) => unknown,
      callbackFn as (...a: unknown[]) => unknown,
    );
    const result = await browser.execute(async (s: string) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function(`return (${s})`)() as () => Promise<unknown>;
      try {
        return await fn();
      } catch (err) {
        return { __wdioAsyncErr__: err instanceof Error ? err.message : String(err) };
      }
    }, script);
    if (result && typeof result === 'object' && '__wdioAsyncErr__' in result) {
      throw new Error((result as { __wdioAsyncErr__: string }).__wdioAsyncErr__);
    }
    // See the withImplementation note above — the wire result is the callback's return.
    return result as ReturnType<typeof callbackFn>;
  };

  return mock;
}
