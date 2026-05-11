// createMock — the workhorse behind browser.dioxus.mock(commandName).
//
// A Dioxus mock is two cooperating objects:
//   1. The "outer mock" — a vitest-flavoured `fn()` from @wdio/native-spy
//      that lives in the test process. Tests inspect it via `mock.mock.calls`.
//   2. The "inner mock" — a JS function on `window.__wdio_mocks__[command]`
//      inside the Dioxus app's webview, installed via DioxusAdapter.
//
// User-facing setters (mockReturnValue, mockImplementation, etc.) write to
// the inner mock via browser.execute. After every assertion-touching method,
// `mock.update()` syncs the inner mock's call history back into the outer
// mock so the test sees up-to-date state.
//
// Lean v1: no browser-mode special case (mode: 'browser' lands in PR3) and
// no wrapperMock destructuring proxy (Tauri's pattern, defer until users
// ask).

import { fn as vitestFn } from '@wdio/native-spy';
import { createIpcInterceptor } from '@wdio/native-spy/interceptor';
import type { AbstractFn, DioxusMock } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import { execute as dioxusExecute } from './commands/execute.js';
import mockStore from './mockStore.js';

const log = createLogger('dioxus-service', 'mock');
const interceptor = createIpcInterceptor('dioxus');

/**
 * Create a mock for a Dioxus wdio:// command. Registers the inner mock in
 * the browser, wires the outer mock with `update()` + lifecycle methods,
 * stores it in the registry, and returns it.
 */
export async function createMock(command: string, browserContext?: WebdriverIO.Browser): Promise<DioxusMock> {
  log.debug(`[${command}] createMock — starting`);
  const browserToUse = (browserContext ?? browser) as WebdriverIO.Browser;

  const outerMock = vitestFn();
  const outerMockClear = outerMock.mockClear;
  const outerMockReset = outerMock.mockReset;

  outerMock.mockName(`dioxus.${command}`);

  const mock = outerMock as unknown as DioxusMock;
  mock.__isDioxusMock = true;

  const originalMock = outerMock.mock;

  log.debug(`[${command}] Registering inner mock in webview`);
  await dioxusExecute<void>(browserToUse, interceptor.buildRegistrationScript(command));
  log.debug(`[${command}] Inner mock registered`);

  mock.update = async () => {
    const raw = await dioxusExecute<unknown>(browserToUse, interceptor.buildCallDataReadScript(command));
    const sync = interceptor.parseCallData(raw);
    const existing = originalMock.calls.length;

    if (sync.calls.length < existing) {
      // Inner shrank (mockClear or page reload). Replace state wholesale.
      (originalMock.calls as unknown[][]).length = 0;
      (originalMock.results as { type: string; value: unknown }[]).length = 0;
      (originalMock.invocationCallOrder as number[]).length = 0;
    }

    const startAt = sync.calls.length < existing ? 0 : existing;
    for (let i = startAt; i < sync.calls.length; i++) {
      (originalMock.calls as unknown[][]).push(sync.calls[i]);
      (originalMock.results as { type: string; value: unknown }[]).push(
        sync.results[i] ?? { type: 'return', value: undefined },
      );
      (originalMock.invocationCallOrder as number[]).push(
        sync.invocationCallOrder[i] ?? originalMock.invocationCallOrder.length,
      );
    }
    return mock;
  };

  mock.mockImplementation = async (implFn: AbstractFn) => {
    const s = interceptor.serializeHandler(implFn);
    await dioxusExecute<void>(browserToUse, interceptor.buildSetImplementationScript(command, s));
    return mock;
  };

  mock.mockImplementationOnce = async (implFn: AbstractFn) => {
    const s = interceptor.serializeHandler(implFn);
    await dioxusExecute<void>(browserToUse, interceptor.buildSetImplementationScript(command, s, true));
    return mock;
  };

  mock.mockReturnValue = async (value: unknown) => {
    await dioxusExecute<void>(browserToUse, interceptor.buildInnerSetterScript(command, 'mockReturnValue', value));
    return mock;
  };

  mock.mockReturnValueOnce = async (value: unknown) => {
    await dioxusExecute<void>(browserToUse, interceptor.buildInnerSetterScript(command, 'mockReturnValueOnce', value));
    return mock;
  };

  mock.mockResolvedValue = async (value: unknown) => {
    await dioxusExecute<void>(browserToUse, interceptor.buildInnerSetterScript(command, 'mockResolvedValue', value));
    return mock;
  };

  mock.mockResolvedValueOnce = async (value: unknown) => {
    await dioxusExecute<void>(
      browserToUse,
      interceptor.buildInnerSetterScript(command, 'mockResolvedValueOnce', value),
    );
    return mock;
  };

  mock.mockRejectedValue = async (value: unknown) => {
    await dioxusExecute<void>(browserToUse, interceptor.buildInnerSetterScript(command, 'mockRejectedValue', value));
    return mock;
  };

  mock.mockRejectedValueOnce = async (value: unknown) => {
    await dioxusExecute<void>(
      browserToUse,
      interceptor.buildInnerSetterScript(command, 'mockRejectedValueOnce', value),
    );
    return mock;
  };

  mock.mockClear = async () => {
    await dioxusExecute<void>(browserToUse, interceptor.buildInnerInvocationScript(command, 'mockClear'));
    outerMockClear();
    return mock;
  };

  mock.mockReset = async () => {
    const currentName = outerMock.getMockName();
    await dioxusExecute<void>(browserToUse, interceptor.buildInnerInvocationScript(command, 'mockReset'));
    outerMockClear();
    outerMockReset();
    outerMock.mockName(currentName);
    return mock;
  };

  mock.mockRestore = async () => {
    await dioxusExecute<void>(browserToUse, interceptor.buildUnregistrationScript(command));
    outerMockClear();
    mockStore.deleteMock(`dioxus.${command}`);
    return mock;
  };

  mock.mockReturnThis = async () => {
    await dioxusExecute<void>(browserToUse, interceptor.buildInnerInvocationScript(command, 'mockReturnThis'));
    return mock;
  };

  mockStore.setMock(mock);
  log.debug(`[${command}] Mock ready`);
  return mock;
}
