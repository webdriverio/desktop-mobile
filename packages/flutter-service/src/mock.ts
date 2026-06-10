// createFlutterMock — the workhorse behind browser.flutter.mock(target).
//
// A Flutter mock is two cooperating objects (two-tier mock doctrine, Tier 2):
//
//   1. The "outer mock" — a vitest-flavoured fn() from @wdio/native-spy in the WDIO
//      worker. Tests inspect it via mock.mock.calls / results.
//   2. The "cooperative contract" — the app opted in (via the `wdio_flutter` Dart
//      package + `enableWdioMocking()`), registering a `WdioMockRegistry` its DI seams
//      route through. We drive it over the Dart VM Service `ext.wdio.*` extensions.
//
// `target` is the seam id the app registered (e.g. 'GreetingService.greet'). Value
// setters push a tagged value into the registry; update() reads the call history back
// one-way into the outer mock. Because Dart has no runtime monkeypatch, there's no
// `mockImplementation` (a serialised JS function) — that's the documented boundary.

import { fn as vitestFn } from '@wdio/native-spy';
import type { FlutterMock, MockResult } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from './constants.js';
import type { FlutterMockStore } from './mockStore.js';
import type { VmServiceClient } from './vmService.js';

const log = createLogger(SERVICE_NAME, 'bridge');

type ValueKind = 'return' | 'resolve' | 'reject';

interface CallData {
  calls: unknown[][];
  results: MockResult[];
  invocationCallOrder: number[];
}

function parseCallData(raw: unknown): CallData {
  if (!raw || typeof raw !== 'object') {
    return { calls: [], results: [], invocationCallOrder: [] };
  }
  const r = raw as Record<string, unknown>;
  return {
    calls: Array.isArray(r.calls) ? (r.calls as unknown[][]) : [],
    results: Array.isArray(r.results) ? (r.results as MockResult[]) : [],
    invocationCallOrder: Array.isArray(r.invocationCallOrder) ? (r.invocationCallOrder as number[]) : [],
  };
}

function notSupported(target: string, method: string): Error {
  return new Error(
    `browser.flutter.mock("${target}").${method} is not supported — Flutter mocks app-exposed seams ` +
      'with serialisable values (Dart has no runtime monkeypatch of a JS function). Use mockReturnValue / ' +
      'mockResolvedValue / mockRejectedValue.',
  );
}

/**
 * Create (or re-wire) the Flutter mock for `target`. The cooperative contract installs
 * itself app-side, so there's no per-target install RPC — the registry intercepts any
 * target the app wired a seam for; setting a value activates the mock.
 */
export async function createFlutterMock(
  target: string,
  // A resolver, not a captured client: each op re-resolves the live (reconnected) client, so
  // direct mock.update()/mockReturnValue() calls after a mid-test socket drop reconnect instead
  // of failing against a stale handle.
  getClient: () => Promise<VmServiceClient>,
  store: FlutterMockStore,
): Promise<FlutterMock> {
  log.debug(`[${target}] createFlutterMock`);
  const existing = store.getMock(target);

  const outerMock = existing
    ? (existing as unknown as { _vitestFn: ReturnType<typeof vitestFn> })._vitestFn
    : vitestFn();
  if (!existing) {
    outerMock.mockName(`flutter.${target}`);
  }
  const outerClear = existing
    ? (existing as unknown as { _nativeClear: () => void })._nativeClear
    : outerMock.mockClear.bind(outerMock);

  const mock = (existing ?? (outerMock as unknown as FlutterMock)) as FlutterMock;
  if (!existing) {
    mock.__isFlutterMock = true;
    (mock as unknown as { _vitestFn: ReturnType<typeof vitestFn> })._vitestFn = outerMock;
    (mock as unknown as { _nativeClear: () => void })._nativeClear = outerClear;
  }
  const originalMock = outerMock.mock;

  const ext = async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    const client = await getClient();
    const isolateId = await client.getMainIsolateId();
    return client.callServiceExtension(method, { isolateId, target, ...params });
  };

  const setValue = async (kind: ValueKind, value: unknown, once = false): Promise<FlutterMock> => {
    // JSON.stringify drops `undefined` (it would arrive as a missing key), so serialise it as
    // null explicitly — the contract value is always present, and Dart has no `undefined`, so
    // null is the closest analogue (e.g. mockReturnValue(undefined) → a null Dart value).
    await ext('ext.wdio.setMock', { value: JSON.stringify({ kind, value: value ?? null, once }) });
    return mock;
  };

  mock.update = async () => {
    const sync = parseCallData(await ext('ext.wdio.getCalls'));
    (originalMock.calls as unknown[][]).length = 0;
    (originalMock.results as { type: string; value: unknown }[]).length = 0;
    (originalMock.invocationCallOrder as number[]).length = 0;
    for (let i = 0; i < sync.calls.length; i += 1) {
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

  mock.mockReturnValue = (value: unknown) => setValue('return', value);
  mock.mockReturnValueOnce = (value: unknown) => setValue('return', value, true);
  mock.mockResolvedValue = (value: unknown) => setValue('resolve', value);
  mock.mockResolvedValueOnce = (value: unknown) => setValue('resolve', value, true);
  mock.mockRejectedValue = (value: unknown) => setValue('reject', value);
  mock.mockRejectedValueOnce = (value: unknown) => setValue('reject', value, true);

  // Dart has no JS-function monkeypatch — these are the documented Tier-2 boundary.
  mock.mockImplementation = () => Promise.reject(notSupported(target, 'mockImplementation'));
  mock.mockImplementationOnce = () => Promise.reject(notSupported(target, 'mockImplementationOnce'));
  mock.mockReturnThis = () => Promise.reject(notSupported(target, 'mockReturnThis'));

  mock.mockClear = async () => {
    try {
      await ext('ext.wdio.clearMock');
    } finally {
      outerClear();
    }
    return mock;
  };

  mock.mockReset = async () => {
    const currentName = outerMock.getMockName();
    try {
      await ext('ext.wdio.resetMock');
    } finally {
      outerClear();
      outerMock.mockName(currentName);
    }
    return mock;
  };

  mock.mockRestore = async () => {
    try {
      await ext('ext.wdio.restoreMock');
    } finally {
      // Delete from the store in the finally (not after): if the VM call throws (socket drop),
      // leaving the entry behind would let a later browser.flutter.mock(target) re-use this
      // cleared mock while the Dart seam still intercepts — a fresh mock() is the correct recovery.
      outerClear();
      store.deleteMock(target);
    }
    return mock;
  };

  store.setMock(target, mock);
  log.debug(`[${target}] flutter mock ready`);
  return mock;
}
