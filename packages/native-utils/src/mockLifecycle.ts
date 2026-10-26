import { errorMessage } from './teardown.js';

export type MockLifecycleOp = 'mockClear' | 'mockReset' | 'mockRestore';

type LifecycleMock = Record<MockLifecycleOp, () => unknown>;

export interface BulkMockOpOptions<M extends LifecycleMock = LifecycleMock> {
  /** Which store entries the op applies to; every entry when omitted. */
  matches?: (name: string) => boolean;
  /** One in-app call for the whole batch, run before the per-mock ops. */
  bulkAppCall?: () => Promise<unknown>;
  /** Replaces `mock[op]()` for each matching entry. `bulkSucceeded` is true when `bulkAppCall` ran and resolved. */
  run?: (mock: M, bulkSucceeded: boolean) => unknown;
}

/** Attempts `op` on every matching mock, then throws an AggregateError of the failures. */
export async function runBulkMockOp<M extends LifecycleMock>(
  entries: Iterable<readonly [string, M]>,
  op: MockLifecycleOp,
  options: BulkMockOpOptions<M> = {},
): Promise<number> {
  const failures: Array<{ name: string; error: unknown }> = [];

  let bulkSucceeded = false;
  if (options.bulkAppCall) {
    try {
      await options.bulkAppCall();
      bulkSucceeded = true;
    } catch (error) {
      failures.push({ name: 'all mocks (in-app)', error });
    }
  }

  let processed = 0;
  for (const [name, mock] of entries) {
    if (options.matches && !options.matches(name)) {
      continue;
    }
    try {
      await (options.run ? options.run(mock, bulkSucceeded) : mock[op]());
      processed++;
    } catch (error) {
      failures.push({ name, error });
    }
  }

  if (failures.length > 0) {
    const details = failures.map(({ name, error }) => `${name}: ${errorMessage(error)}`).join('; ');
    throw new AggregateError(
      failures.map(({ error }) => error),
      `${op} failed: ${details}`,
    );
  }
  return processed;
}
