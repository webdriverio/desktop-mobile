import type { Mock } from '@wdio/native-spy';
import { parseCallData } from '@wdio/native-spy/interceptor';
import type { ExecuteOpts } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';
import { innerMockPath, type MockAccessor, type MockApplyData } from './mockFactory.js';

const log = createLogger('electron-service', 'mock');

type CallRecord = { calls: unknown[][]; results: Array<{ type: string; value: unknown }>; __error?: string };

/**
 * Reads the calls and results of each mock's inner mock in the app, in one round trip, keyed by the
 * id given with its accessor.
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
    (await browser.electron.execute<Record<string, CallRecord>, [Array<[string, string[]]>, ExecuteOpts]>(
      (electron, items) => {
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
        const out: Record<string, CallRecord> = {};
        for (const item of items) {
          const id = item[0];
          try {
            const target = item[1].reduce<unknown>(
              (parent, key) => (parent as Record<string, unknown> | undefined)?.[key],
              electron,
            ) as { mock?: { calls?: unknown[][]; results?: Array<{ type: string; value: unknown }> } } | undefined;
            out[id] = {
              calls: target?.mock?.calls ? JSON.parse(JSON.stringify(target.mock.calls, replacer)) : [],
              results: target?.mock?.results ? JSON.parse(JSON.stringify(target.mock.results, replacer)) : [],
            };
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
      return [id, parseCallData(record)];
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
  const existingCount = outerMock.mock.calls.length;
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
