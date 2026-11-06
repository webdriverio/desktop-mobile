import { errorMessage } from '@wdio/native-utils';

export interface InstanceFailure {
  name?: string;
  error: unknown;
}

// A failed target leaves `undefined` in `values`, so each value stays at its target's index
export async function settleOnEach<T extends { name?: string }, R>(
  targets: readonly T[],
  run: (target: T) => Promise<R>,
): Promise<{ values: Array<R | undefined>; failures: InstanceFailure[] }> {
  const results = await Promise.allSettled(targets.map(async (target) => run(target)));
  const values = results.map((result) => (result.status === 'fulfilled' ? result.value : undefined));
  const failures = results.flatMap((result, i) =>
    result.status === 'rejected' ? [{ name: targets[i].name, error: result.reason as unknown }] : [],
  );
  return { values, failures };
}

// Reporters print only the message, not `cause` or `errors`, so the message names each failure
export function instanceFailuresError(commandName: string, failures: readonly InstanceFailure[]): Error {
  const message = `${commandName} failed on ${failures.map(({ name, error }) => `${name}: ${errorMessage(error)}`).join('; ')}`;
  return failures.length === 1
    ? new Error(message, { cause: failures[0].error })
    : new AggregateError(
        failures.map(({ error }) => error),
        message,
      );
}
