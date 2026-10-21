import { errorMessage, isBenignTeardownError } from './teardown.js';

export type MockLifecycleOp = 'mockClear' | 'mockReset' | 'mockRestore';

/** The test-process half of each lifecycle op. It must not call the app. */
export type LocalMockOps = Partial<Record<MockLifecycleOp, () => void>>;

type LifecycleMock = Record<MockLifecycleOp, () => unknown>;

const localMockOps = new WeakMap<object, LocalMockOps>();

export function registerLocalMockOps(mock: object, ops: LocalMockOps): void {
  localMockOps.set(mock, ops);
}

function isAppUnreachable(error: unknown): boolean {
  return isBenignTeardownError(error) || /time(?:d)?\s?out/i.test(errorMessage(error));
}

export interface BulkMockOpOptions {
  /** Which store entries the op applies to; every entry when omitted. */
  matches?: (name: string) => boolean;
  /** One in-app call for the whole batch, run before the per-mock ops. */
  bulkAppCall?: () => Promise<unknown>;
}

/**
 * Attempts `op` on every matching mock, then throws an AggregateError of the failures.
 * Once the app is unreachable, the remaining mocks only get their registered local half.
 */
export async function runBulkMockOp(
  entries: Iterable<readonly [string, LifecycleMock]>,
  op: MockLifecycleOp,
  options: BulkMockOpOptions = {},
): Promise<number> {
  const failures: Array<{ name: string; error: unknown }> = [];
  let appReachable = true;
  const fail = (name: string, error: unknown) => {
    failures.push({ name, error });
    if (isAppUnreachable(error)) {
      appReachable = false;
    }
  };

  if (options.bulkAppCall) {
    try {
      await options.bulkAppCall();
    } catch (error) {
      fail('all mocks (in-app)', error);
    }
  }

  let processed = 0;
  let localOnly = 0;
  for (const [name, mock] of entries) {
    if (options.matches && !options.matches(name)) {
      continue;
    }
    if (!appReachable) {
      try {
        localMockOps.get(mock)?.[op]?.();
      } catch (error) {
        failures.push({ name, error });
      }
      localOnly++;
      continue;
    }
    try {
      await mock[op]();
      processed++;
    } catch (error) {
      fail(name, error);
    }
  }

  if (failures.length > 0) {
    const details = failures.map(({ name, error }) => `${name}: ${errorMessage(error)}`).join('; ');
    const skipped = localOnly > 0 ? ` (app unreachable: skipped the app call for ${localOnly} other mock(s))` : '';
    throw new AggregateError(
      failures.map(({ error }) => error),
      `${op} failed: ${details}${skipped}`,
    );
  }
  return processed;
}
