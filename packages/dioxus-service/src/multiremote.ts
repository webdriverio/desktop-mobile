import { instanceFailuresError, requireInstance, settleOnEach } from '@wdio/native-core';

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
