import { errorMessage } from './errors.js';

export type MockLifecycleOp = 'mockClear' | 'mockReset' | 'mockRestore';

type LifecycleMock = Record<MockLifecycleOp, () => unknown>;

export interface BulkMockOpOptions {
  /** Which store entries the op applies to; every entry when omitted. */
  matches?: (name: string) => boolean;
  /** One in-app call for the whole batch, run before the per-mock ops. */
  bulkAppCall?: () => Promise<unknown>;
}

/** Attempts `op` on every matching mock, then throws an AggregateError of the failures. */
export async function runBulkMockOp(
  entries: Iterable<readonly [string, LifecycleMock]>,
  op: MockLifecycleOp,
  options: BulkMockOpOptions = {},
): Promise<number> {
  const failures: Array<{ name: string; error: unknown }> = [];

  if (options.bulkAppCall) {
    try {
      await options.bulkAppCall();
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
      await mock[op]();
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
