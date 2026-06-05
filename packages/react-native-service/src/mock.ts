// createMock — the workhorse behind browser.reactNative.mock(target).
//
// A React Native mock is two cooperating objects (two-tier mock doctrine):
//
//   1. The "outer mock" — a vitest-flavoured fn() from @wdio/native-spy that
//      lives in the WDIO worker. Tests inspect it via mock.mock.calls/results.
//   2. The "inner recorder" — a spy installed over globalThis.<target> in the
//      app's Hermes realm (innerRecorder.ts), driven over CDP Runtime.evaluate.
//
// `target` is a dotted path to a function in the Hermes global
// ('nativeModuleProxy.Clipboard.getString'). User-facing setters push behaviour
// into the inner recorder. update() reads the call history back one-way into
// the outer mock.

import type { CdpBridge } from '@wdio/native-cdp-bridge';
import { fn as vitestFn } from '@wdio/native-spy';
import type { AbstractFn, MockResult, ReactNativeMock } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import { evaluateInRealm, jsonLiteral } from './commands/execute.js';
import { SERVICE_NAME } from './constants.js';
import {
  buildClearScript,
  buildInstallScript,
  buildReadCallDataScript,
  buildResetScript,
  buildRestoreScript,
  buildSetImplementationScript,
  buildSetValueScript,
} from './innerRecorder.js';
import type { ReactNativeMockStore } from './mockStore.js';
import type { InnerMockSetterMethod } from './mockTypes.js';

const log = createLogger(SERVICE_NAME, 'bridge');

interface CallData {
  calls: unknown[][];
  results: MockResult[];
  invocationCallOrder: number[];
}

function reconstructErrors(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(reconstructErrors);
  }
  const obj = value as Record<string, unknown>;
  if (obj.__wdioError === true) {
    const err = new Error(typeof obj.message === 'string' ? obj.message : '');
    if (typeof obj.name === 'string') err.name = obj.name;
    if (typeof obj.stack === 'string') err.stack = obj.stack;
    return err;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    out[key] = reconstructErrors(obj[key]);
  }
  return out;
}

function parseCallData(raw: unknown): CallData {
  if (!raw || typeof raw !== 'object') {
    return { calls: [], results: [], invocationCallOrder: [] };
  }
  const r = raw as Record<string, unknown>;
  const calls = Array.isArray(r.calls)
    ? (r.calls as unknown[][]).map((args) => (Array.isArray(args) ? args.map(reconstructErrors) : args) as unknown[])
    : [];
  const results = Array.isArray(r.results)
    ? (r.results as MockResult[]).map((res) => ({ type: res.type, value: reconstructErrors(res.value) }))
    : [];
  return {
    calls,
    results,
    invocationCallOrder: Array.isArray(r.invocationCallOrder) ? (r.invocationCallOrder as number[]) : [],
  };
}

function implSource(implFn: AbstractFn, target: string): string {
  const source = implFn.toString();
  if (/\{\s*\[native code\]\s*\}/.test(source)) {
    throw new Error(
      `browser.reactNative.mock("${target}"): mockImplementation requires a function with serialisable source — ` +
        'native or bound functions stringify to "[native code]" and cannot be evaluated in the Hermes realm',
    );
  }
  try {
    new Function(`return (${source});`);
  } catch {
    throw new Error(
      `browser.reactNative.mock("${target}"): mockImplementation source is not a valid expression — ` +
        'method shorthands lose the `function` keyword when stringified; pass a function expression or arrow function',
    );
  }
  return source;
}

function valueLiteral(value: unknown, target: string): string {
  if (value instanceof Error) {
    return JSON.stringify({ __wdioError: true, name: value.name, message: value.message, stack: value.stack })
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }
  return jsonLiteral(value, `browser.reactNative.mock("${target}") value`);
}

export async function createMock(
  target: string,
  bridge: CdpBridge,
  store: ReactNativeMockStore,
): Promise<ReactNativeMock> {
  log.debug(`[${target}] createMock — installing inner recorder`);
  const mockContext = `browser.reactNative.mock("${target}")`;

  const existing = store.getMock(target);
  if (existing) {
    await evaluateInRealm<void>(bridge, buildInstallScript(target), mockContext);
    return existing;
  }

  await evaluateInRealm<void>(bridge, buildInstallScript(target), mockContext);

  const outerMock = vitestFn();
  outerMock.mockName(`reactNative.${target}`);
  const outerMockClear = outerMock.mockClear.bind(outerMock);
  const outerMockReset = outerMock.mockReset.bind(outerMock);

  const mock = outerMock as unknown as ReactNativeMock;
  mock.__isReactNativeMock = true;

  const originalMock = outerMock.mock;

  const setValue = async (method: InnerMockSetterMethod, value: unknown): Promise<ReactNativeMock> => {
    await evaluateInRealm<void>(bridge, buildSetValueScript(target, method, valueLiteral(value, target)), mockContext);
    return mock;
  };

  mock.update = async () => {
    const raw = await evaluateInRealm<unknown>(bridge, buildReadCallDataScript(target), mockContext);
    const sync = parseCallData(raw);
    (originalMock.calls as unknown[][]).length = 0;
    (originalMock.results as { type: string; value: unknown }[]).length = 0;
    (originalMock.invocationCallOrder as number[]).length = 0;
    for (let i = 0; i < sync.calls.length; i++) {
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
    await evaluateInRealm<void>(bridge, buildSetImplementationScript(target, implSource(implFn, target)), mockContext);
    return mock;
  };

  mock.mockImplementationOnce = async (implFn: AbstractFn) => {
    await evaluateInRealm<void>(
      bridge,
      buildSetImplementationScript(target, implSource(implFn, target), true),
      mockContext,
    );
    return mock;
  };

  mock.mockReturnValue = (value: unknown) => setValue('mockReturnValue', value);
  mock.mockReturnValueOnce = (value: unknown) => setValue('mockReturnValueOnce', value);
  mock.mockResolvedValue = (value: unknown) => setValue('mockResolvedValue', value);
  mock.mockResolvedValueOnce = (value: unknown) => setValue('mockResolvedValueOnce', value);
  mock.mockRejectedValue = (value: unknown) => setValue('mockRejectedValue', value);
  mock.mockRejectedValueOnce = (value: unknown) => setValue('mockRejectedValueOnce', value);

  mock.mockReturnThis = async () => {
    // mockReturnThis not relevant for Hermes-realm targets; delegate to inner spy.
    return mock;
  };

  mock.mockClear = async () => {
    await evaluateInRealm<void>(bridge, buildClearScript(target), mockContext);
    outerMockClear();
    return mock;
  };

  mock.mockReset = async () => {
    const currentName = outerMock.getMockName();
    await evaluateInRealm<void>(bridge, buildResetScript(target), mockContext);
    outerMockReset();
    outerMock.mockName(currentName);
    return mock;
  };

  mock.mockRestore = async () => {
    await evaluateInRealm<void>(bridge, buildRestoreScript(target), mockContext);
    outerMockReset();
    store.deleteMock(target);
    return mock;
  };

  store.setMock(target, mock);
  log.debug(`[${target}] mock ready`);
  return mock;
}
