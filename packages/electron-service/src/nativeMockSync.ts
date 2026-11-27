import type { Mock } from '@wdio/native-spy';
import { parseCallData } from '@wdio/native-spy/interceptor';
import type { ExecuteOpts } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';
import { innerMockPath, type MockAccessor, type MockApplyData } from './mockFactory.js';

const log = createLogger('electron-service', 'mock');

type RawResult = { type: string; value: unknown };
type Settled = 'fulfilled' | 'rejected' | 'pending';
type CallRecord = {
  calls: unknown[][];
  results: RawResult[];
  settled?: Array<Settled | undefined>;
  __error?: string;
  __resultsError?: string;
};

// The settle function of each placeholder for a result still pending in the app, for a later read to call.
const pendingResults = new WeakMap<Promise<unknown>, (settled: unknown) => void>();

// Rebuilds the promise the app returned, so a result reads as it would from a mock in the test process.
function restorePromise(result: RawResult, settled: Settled | undefined): RawResult {
  if (!settled) {
    return result;
  }
  if (settled === 'pending') {
    let settle: (value: unknown) => void = () => {};
    const promise = new Promise((resolve) => {
      settle = resolve;
    });
    // A later read may reject it with an error the app caught, which mustn't fail a test that never reads it.
    promise.catch(() => {});
    pendingResults.set(promise, settle);
    return { type: result.type, value: promise };
  }
  if (settled === 'fulfilled') {
    return { type: result.type, value: Promise.resolve(result.value) };
  }
  const rejected = Promise.reject(result.value);
  rejected.catch(() => {});
  return { type: result.type, value: rejected };
}

/**
 * Reads each inner mock's calls and results from the app in one round trip, keyed by the id paired
 * with its accessor.
 */
export async function readNativeMocks(
  browser: WebdriverIO.Browser,
  accessors: Array<[string, MockAccessor]>,
): Promise<Record<string, MockApplyData>> {
  if (accessors.length === 0) {
    return {};
  }
  const items = accessors.map(([id, accessor]): [string, string[]] => [id, innerMockPath(accessor)]);

  const records =
    (await browser.electron.execute<Promise<Record<string, CallRecord>>, [Array<[string, string[]]>, ExecuteOpts]>(
      async (electron, items) => {
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
        const copy = (v: unknown) => JSON.parse(JSON.stringify(v, replacer));
        const pending = {};
        const out: Record<string, CallRecord> = {};
        for (const item of items) {
          const id = item[0];
          try {
            const target = item[1].reduce<unknown>(
              (parent, key) => (parent as Record<string, unknown> | undefined)?.[key],
              electron,
            ) as { mock?: { calls?: unknown[][]; results?: Array<{ type: string; value: unknown }> } } | undefined;
            const record: CallRecord = {
              calls: target?.mock?.calls ? copy(target.mock.calls) : [],
              results: [],
              settled: [],
            };
            // Copy each result on its own, so one that can't be copied doesn't take the calls with it.
            for (const result of target?.mock?.results ?? []) {
              try {
                let value = result.value;
                let settled: Settled | undefined;
                if (typeof (value as PromiseLike<unknown> | undefined)?.then === 'function') {
                  // A settled promise wins the race against `pending`, which tells the two apart without waiting.
                  try {
                    const awaited = await Promise.race([value, pending]);
                    settled = awaited === pending ? 'pending' : 'fulfilled';
                    value = awaited === pending ? undefined : awaited;
                  } catch (e) {
                    settled = 'rejected';
                    value = e;
                  }
                }
                record.results.push({ type: result.type, value: copy(value) });
                record.settled?.push(settled);
              } catch (e) {
                record.results.push({ type: 'return', value: copy(undefined) });
                record.settled?.push(undefined);
                record.__resultsError ??= e instanceof Error ? e.message : String(e);
              }
            }
            out[id] = record;
          } catch (e) {
            // Report the error, or empty calls would let assertions pass vacuously.
            out[id] = { calls: [], results: [], __error: e instanceof Error ? e.message : String(e) };
          }
        }
        return out;
      },
      items,
      { internal: true },
    )) ?? {};

  return Object.fromEntries(
    accessors.map(([id]) => {
      const record = records[id] ?? { calls: [], results: [] };
      if (record.__error) {
        log.warn(`Native read failed for mock "${id}": ${record.__error}`);
      }
      if (record.__resultsError) {
        log.warn(`Native result read failed for mock "${id}", its calls were kept: ${record.__resultsError}`);
      }
      const data = parseCallData(record);
      return [id, { ...data, results: data.results.map((result, i) => restorePromise(result, record.settled?.[i])) }];
    }),
  );
}

/**
 * Replays the app's new calls through the outer mock so they join the call order shared with other mocks.
 * The implementation runs only in the app, so the replay uses a no-op and records the app's results.
 */
export function applyAppCalls(
  outerMock: Mock,
  outerWithImplementation: Mock['withImplementation'],
  data: MockApplyData,
): void {
  const calls = data.calls ?? [];
  const results = data.results ?? [];
  const outerResults = outerMock.mock.results as Array<{ type: string; value: unknown }>;
  const existingCount = outerMock.mock.calls.length;
  for (let i = 0; i < Math.min(existingCount, results.length); i++) {
    const settle = pendingResults.get(outerResults[i]?.value as Promise<unknown>);
    const latest = results[i].value;
    if (settle && !pendingResults.has(latest as Promise<unknown>)) {
      // Resolving with a promise adopts its outcome, so this also rejects.
      settle(latest);
      pendingResults.delete(outerResults[i].value as Promise<unknown>);
    }
  }
  if (existingCount >= calls.length) {
    return;
  }
  // Load-bearing for diagnosing mock-sync races
  log.debug(
    `[${outerMock.getMockName()}] applying ${calls.length - existingCount} new calls (inner=${calls.length}, outer=${existingCount})`,
  );
  outerWithImplementation(
    () => undefined,
    () => {
      for (let i = existingCount; i < calls.length; i++) {
        (outerMock as unknown as (...args: unknown[]) => unknown)(...(calls[i] as unknown[]));
        (outerMock.mock.results as Array<{ type: string; value: unknown }>)[i] = results[i] ?? {
          type: 'return',
          value: undefined,
        };
      }
    },
  );
}

/** Reads one mock's record from the app and applies its new calls. */
export async function updateNativeMock(
  browser: WebdriverIO.Browser,
  accessor: MockAccessor,
  applyCalls: (data: MockApplyData) => void,
): Promise<void> {
  const { mock } = await readNativeMocks(browser, [['mock', accessor]]);
  applyCalls(mock);
}
