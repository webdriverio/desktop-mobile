// createMock — the workhorse behind browser.electrobun.mock(target).
//
// An Electrobun mock is two cooperating objects (see
// agent-os/standards/global/mock-architecture.md):
//
//   1. The "outer mock" — a vitest-flavoured fn() from @wdio/native-spy that
//      lives in the WDIO worker. Tests inspect it via mock.mock.calls/results.
//   2. The "inner recorder" — a spy installed over window.<target> in the CEF
//      webview (innerRecorder.ts), driven over CDP Runtime.evaluate.
//
// `target` is a dotted path to a function in the webview global scope
// ('api.fetchData' → window.api.fetchData). This is the in-page analogue of
// browser.dioxus.mock(command) / browser.tauri.mock — Electrobun has no
// enumerable main-process API to mock, so we replace the function in place and
// preserve the original for restore.
//
// User-facing setters (mockReturnValue, mockImplementation, …) push behaviour
// into the inner recorder. update() reads the recorder's call history back and
// syncs it ONE-WAY into the outer mock. clear/reset/restore apply to both sides.

import type { CdpBridge } from '@wdio/electrobun-cdp-bridge';
import { fn as vitestFn } from '@wdio/native-spy';
import type { AbstractFn, ElectrobunMock, MockResult } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import { evaluateInActiveTarget, jsonLiteral } from './commands/execute.js';
import { SERVICE_NAME } from './constants.js';
import {
  buildClearScript,
  buildInstallScript,
  buildReadCallDataScript,
  buildResetScript,
  buildRestoreScript,
  buildReturnThisScript,
  buildSetImplementationScript,
  buildSetValueScript,
} from './innerRecorder.js';
import type { ElectrobunMockStore } from './mockStore.js';
import type { InnerMockSetterMethod } from './mockTypes.js';

const log = createLogger(SERVICE_NAME, 'mock');

interface CallData {
  calls: unknown[][];
  results: MockResult[];
  invocationCallOrder: number[];
}

/**
 * Revive `{ __wdioError: true, message }` markers produced by the in-page
 * errorReplacer (innerRecorder.ts#buildReadCallDataScript) back into real Error
 * objects. Mirrors the shared sync protocol in @wdio/native-spy/interceptor;
 * inlined here because that package only exports it as a type, not at runtime.
 */
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
    if (typeof obj.name === 'string') {
      err.name = obj.name;
    }
    if (typeof obj.stack === 'string') {
      err.stack = obj.stack;
    }
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

/** Serialise a value/error to a JS literal for inlining into a setter script. */
function valueLiteral(value: unknown, target: string): string {
  if (value instanceof Error) {
    return JSON.stringify({ __wdioError: true, message: value.message });
  }
  return jsonLiteral(value, `browser.electrobun.mock("${target}") value`);
}

/**
 * Create (and register) a mock over `window.<target>` in the active webview.
 * Injects the inner recorder up front, wires the outer mock's lifecycle to the
 * bridge, stores it in `store`, and returns it.
 */
export async function createMock(
  target: string,
  bridge: CdpBridge,
  store: ElectrobunMockStore,
): Promise<ElectrobunMock> {
  log.debug(`[${target}] createMock — installing inner recorder`);

  const existing = store.getMock(target);
  if (existing) {
    // Re-mocking the same target returns the existing handle; the install script
    // is idempotent in-page so we don't double-wrap.
    await evaluateInActiveTarget<void>(bridge, buildInstallScript(target));
    return existing;
  }

  await evaluateInActiveTarget<void>(bridge, buildInstallScript(target));

  const outerMock = vitestFn();
  outerMock.mockName(`electrobun.${target}`);
  const outerMockClear = outerMock.mockClear.bind(outerMock);
  const outerMockReset = outerMock.mockReset.bind(outerMock);

  const mock = outerMock as unknown as ElectrobunMock;
  mock.__isElectrobunMock = true;

  const originalMock = outerMock.mock;

  const setValue = async (method: InnerMockSetterMethod, value: unknown): Promise<ElectrobunMock> => {
    await evaluateInActiveTarget<void>(bridge, buildSetValueScript(target, method, valueLiteral(value, target)));
    return mock;
  };

  mock.update = async () => {
    const raw = await evaluateInActiveTarget<unknown>(bridge, buildReadCallDataScript(target));
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
    await evaluateInActiveTarget<void>(bridge, buildSetImplementationScript(target, implFn.toString()));
    return mock;
  };

  mock.mockImplementationOnce = async (implFn: AbstractFn) => {
    await evaluateInActiveTarget<void>(bridge, buildSetImplementationScript(target, implFn.toString(), true));
    return mock;
  };

  mock.mockReturnValue = (value: unknown) => setValue('mockReturnValue', value);
  mock.mockReturnValueOnce = (value: unknown) => setValue('mockReturnValueOnce', value);
  mock.mockResolvedValue = (value: unknown) => setValue('mockResolvedValue', value);
  mock.mockResolvedValueOnce = (value: unknown) => setValue('mockResolvedValueOnce', value);
  mock.mockRejectedValue = (value: unknown) => setValue('mockRejectedValue', value);
  mock.mockRejectedValueOnce = (value: unknown) => setValue('mockRejectedValueOnce', value);

  mock.mockReturnThis = async () => {
    await evaluateInActiveTarget<void>(bridge, buildReturnThisScript(target));
    return mock;
  };

  mock.mockClear = async () => {
    await evaluateInActiveTarget<void>(bridge, buildClearScript(target));
    outerMockClear();
    return mock;
  };

  mock.mockReset = async () => {
    const currentName = outerMock.getMockName();
    await evaluateInActiveTarget<void>(bridge, buildResetScript(target));
    outerMockReset();
    outerMock.mockName(currentName);
    return mock;
  };

  mock.mockRestore = async () => {
    await evaluateInActiveTarget<void>(bridge, buildRestoreScript(target));
    outerMockClear();
    store.deleteMock(target);
    return mock;
  };

  store.setMock(target, mock);
  log.debug(`[${target}] mock ready`);
  return mock;
}
