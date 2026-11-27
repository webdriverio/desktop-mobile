import { errorMessage } from '@wdio/native-utils';

import { requireInstance } from './instances.js';

export interface InstanceFailure {
  name?: string;
  error: unknown;
}

/** Runs `run` on every target at once and waits for all of them, collecting the failures with each target's name. */
export async function settleOnEach<T extends { name?: string }, R>(
  targets: readonly T[],
  run: (target: T) => Promise<R>,
): Promise<{ values: R[]; failures: InstanceFailure[] }> {
  const results = await Promise.allSettled(targets.map(async (target) => run(target)));
  const values = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
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

/** Runs `run` in every instance of the multiremote root, and if any fail, throws an error naming each one. */
export async function runOnEachInstance<T>(
  root: WebdriverIO.MultiRemoteBrowser,
  commandName: string,
  run: (instance: WebdriverIO.Browser) => Promise<T>,
): Promise<T[]> {
  const { values, failures } = await settleOnEach(
    root.instances.map((name) => ({ name })),
    ({ name }) => run(requireInstance(root, name)),
  );
  if (failures.length > 0) {
    throw instanceFailuresError(commandName, failures);
  }
  return values;
}
