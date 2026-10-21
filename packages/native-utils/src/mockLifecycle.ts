import { errorMessage, isBenignTeardownError } from './teardown.js';

export type MockLifecycleOp = 'mockClear' | 'mockReset' | 'mockRestore';

/** The test-process half of each lifecycle op. It must not call the app. */
export type LocalMockOps = Partial<Record<MockLifecycleOp, () => void>>;

type LifecycleMock = Record<MockLifecycleOp, () => unknown>;

const SHARED_CONNECTION = Symbol('shared connection');

const registrations = new WeakMap<object, { ops: LocalMockOps; connection: unknown }>();

/** `connection` keys the channel the mock's app calls use (e.g. its browser); omit it for a single-session store. */
export function registerLocalMockOps(mock: object, ops: LocalMockOps, connection: unknown = SHARED_CONNECTION): void {
  registrations.set(mock, { ops, connection });
}

// One connection-level failure can be a transient blip; two in a row mean the app is gone.
const UNREACHABLE_AFTER = 2;

export interface BulkMockOpOptions {
  /** Which store entries the op applies to; every entry when omitted. */
  matches?: (name: string) => boolean;
  /** One in-app call for the whole batch, run before the per-mock ops. */
  bulkAppCall?: () => Promise<unknown>;
  /** The connection `bulkAppCall` uses, keyed as in `registerLocalMockOps`. */
  bulkAppConnection?: unknown;
}

/**
 * Attempts `op` on every matching mock, then throws an AggregateError of the failures.
 * Once a connection is unreachable, its mocks only get their registered local half.
 */
export async function runBulkMockOp(
  entries: Iterable<readonly [string, LifecycleMock]>,
  op: MockLifecycleOp,
  options: BulkMockOpOptions = {},
): Promise<number> {
  const failures: Array<{ name: string; error: unknown }> = [];
  const runLocal = (name: string, mock: object) => {
    try {
      registrations.get(mock)?.ops[op]?.();
    } catch (error) {
      failures.push({ name, error });
    }
  };
  // The current run of consecutive connection-level failures on each connection.
  const streaks = new Map<unknown, Array<{ name: string; mock?: object }>>();
  const isUnreachable = (connection: unknown) => (streaks.get(connection)?.length ?? 0) >= UNREACHABLE_AFTER;
  const fail = (connection: unknown, name: string, error: unknown, mock?: object) => {
    failures.push({ name, error });
    if (!isBenignTeardownError(error)) {
      streaks.delete(connection);
      return;
    }
    const streak = [...(streaks.get(connection) ?? []), { name, mock }];
    streaks.set(connection, streak);
    if (streak.length === UNREACHABLE_AFTER) {
      // The mocks whose app calls found the connection gone get their local half too.
      for (const failed of streak) {
        if (failed.mock) {
          runLocal(failed.name, failed.mock);
        }
      }
    }
  };

  if (options.bulkAppCall) {
    const connection = options.bulkAppConnection ?? SHARED_CONNECTION;
    try {
      await options.bulkAppCall();
      streaks.delete(connection);
    } catch (error) {
      fail(connection, 'all mocks (in-app)', error);
    }
  }

  let processed = 0;
  let localOnly = 0;
  for (const [name, mock] of entries) {
    if (options.matches && !options.matches(name)) {
      continue;
    }
    const connection = registrations.get(mock)?.connection ?? SHARED_CONNECTION;
    if (isUnreachable(connection)) {
      runLocal(name, mock);
      localOnly++;
      continue;
    }
    try {
      await mock[op]();
      processed++;
      streaks.delete(connection);
    } catch (error) {
      fail(connection, name, error, mock);
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
