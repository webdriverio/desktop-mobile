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
 * Once a connection is unreachable, the remaining mocks on it only get their registered local half.
 */
export async function runBulkMockOp(
  entries: Iterable<readonly [string, LifecycleMock]>,
  op: MockLifecycleOp,
  options: BulkMockOpOptions = {},
): Promise<number> {
  const failures: Array<{ name: string; error: unknown }> = [];
  const unreachable = new Set<unknown>();
  const fail = (name: string, error: unknown, connection: unknown) => {
    failures.push({ name, error });
    if (isBenignTeardownError(error)) {
      unreachable.add(connection);
    }
  };

  if (options.bulkAppCall) {
    try {
      await options.bulkAppCall();
    } catch (error) {
      fail('all mocks (in-app)', error, options.bulkAppConnection ?? SHARED_CONNECTION);
    }
  }

  let processed = 0;
  let localOnly = 0;
  for (const [name, mock] of entries) {
    if (options.matches && !options.matches(name)) {
      continue;
    }
    const registration = registrations.get(mock);
    const connection = registration?.connection ?? SHARED_CONNECTION;
    if (unreachable.has(connection)) {
      try {
        registration?.ops[op]?.();
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
      fail(name, error, connection);
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
