import { forEachInstance } from '@wdio/native-core';
import { errorMessage, isMultiremote, type MockLifecycleOp, runBulkMockOp } from '@wdio/native-utils';

import mockStore, { type MockOwner } from '../mockStore.js';

export interface ElectronServiceContext {
  browser?: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser;
}

export interface MockOwnerTarget {
  name?: string;
  owner: MockOwner;
  caps?: WebdriverIO.Capabilities;
}

// A multiremote root covers every instance's mocks, then the mocks created on the root itself
export async function getMockOwners(browser: MockOwner): Promise<MockOwnerTarget[]> {
  if (!isMultiremote(browser)) {
    return [{ owner: browser }];
  }
  const targets: MockOwnerTarget[] = [];
  await forEachInstance(browser, (instance, { name, caps }) => {
    targets.push({ name, owner: instance, caps });
  });
  return [...targets, { name: 'the multiremote root', owner: browser }];
}

export async function runOnMockOwners(
  commandName: string,
  targets: MockOwnerTarget[],
  run: (owner: MockOwner) => Promise<unknown>,
): Promise<void> {
  const results = await Promise.allSettled(targets.map(({ owner }) => run(owner)));
  const failures = results.flatMap((result, i) =>
    result.status === 'rejected' ? [{ name: targets[i].name, error: result.reason as unknown }] : [],
  );
  if (failures.length === 0) {
    return;
  }
  // A single session has no instance name to add
  if (failures.length === 1 && failures[0].name === undefined) {
    throw failures[0].error;
  }
  const message = `${commandName} failed on ${failures
    .map(({ name, error }) => `${name}: ${errorMessage(error)}`)
    .join('; ')}`;
  throw failures.length === 1
    ? new Error(message, { cause: failures[0].error })
    : new AggregateError(
        failures.map(({ error }) => error),
        message,
      );
}

export async function runMockOp(owner: MockOwner, op: MockLifecycleOp, apiName?: string): Promise<void> {
  await runBulkMockOp(mockStore.getMocks(owner), op, {
    matches: (name) => !apiName || name.startsWith(`electron.${apiName}`),
  });
}

export async function forEachMock(
  commandName: string,
  context: ElectronServiceContext | undefined,
  op: MockLifecycleOp,
  apiName?: string,
): Promise<void> {
  const browser = context?.browser ?? globalThis.browser;
  if (!browser) {
    throw new Error(`${commandName} requires a valid browser context`);
  }
  await runOnMockOwners(commandName, await getMockOwners(browser), (owner) => runMockOp(owner, op, apiName));
}
