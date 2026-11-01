// Mock-lifecycle helpers — clear/reset/restore across every mock the
// service has created. Each is filterable by `prefix` so multi-suite
// runs can isolate to e.g. all `dioxus.fs.*` mocks.

import { forEachInstance } from '@wdio/native-core';
import { errorMessage, isMultiremote, type MockLifecycleOp, runBulkMockOp } from '@wdio/native-utils';

import mockStore, { type MockOwner } from '../mockStore.js';

function matchesPrefix(name: string, prefix?: string): boolean {
  if (!prefix) {
    return true;
  }
  // Outer mocks are named `dioxus.<command>` (see mock.ts). Match against
  // both the bare command and the prefixed form so callers can pass either.
  const stripped = name.startsWith('dioxus.') ? name.slice('dioxus.'.length) : name;
  return name.startsWith(prefix) || stripped.startsWith(prefix);
}

export interface MockOwnerTarget {
  name?: string;
  owner: MockOwner;
  caps?: WebdriverIO.Capabilities;
}

// A multiremote root covers every instance's mocks, then the mocks created on the root itself.
export async function getMockOwners(browser: MockOwner, capabilities?: unknown): Promise<MockOwnerTarget[]> {
  if (!isMultiremote(browser)) {
    return [{ owner: browser }];
  }
  const targets: MockOwnerTarget[] = [];
  await forEachInstance(
    browser,
    (instance, { name, caps }) => {
      targets.push({ name, owner: instance, caps });
    },
    capabilities,
  );
  return [...targets, { name: 'the multiremote root', owner: browser }];
}

export async function runOnMockOwners(
  commandName: string,
  targets: Array<MockOwnerTarget & { prefix?: string }>,
  op: MockLifecycleOp,
): Promise<void> {
  const failures: Array<{ name?: string; error: unknown }> = [];
  for (const { name, owner, prefix } of targets) {
    try {
      await runBulkMockOp(mockStore.getMocks(owner), op, { matches: (mockName) => matchesPrefix(mockName, prefix) });
    } catch (error) {
      failures.push({ name, error });
    }
  }
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

async function runOnMocks(
  commandName: string,
  browser: MockOwner,
  op: MockLifecycleOp,
  prefix: string | undefined,
): Promise<void> {
  const targets = await getMockOwners(browser);
  await runOnMockOwners(
    commandName,
    targets.map((target) => ({ ...target, prefix })),
    op,
  );
}

export async function clearAllMocks(browser: MockOwner, prefix?: string): Promise<void> {
  await runOnMocks('clearAllMocks', browser, 'mockClear', prefix);
}

export async function resetAllMocks(browser: MockOwner, prefix?: string): Promise<void> {
  await runOnMocks('resetAllMocks', browser, 'mockReset', prefix);
}

export async function restoreAllMocks(browser: MockOwner, prefix?: string): Promise<void> {
  await runOnMocks('restoreAllMocks', browser, 'mockRestore', prefix);
}

/**
 * True iff `candidate` is a DioxusMock — checked structurally via the
 * `__isDioxusMock: true` flag created in mock.ts.
 */
export function isMockFunction(candidate: unknown): boolean {
  if (candidate == null || typeof candidate !== 'function') {
    return false;
  }
  const flag = (candidate as { __isDioxusMock?: unknown }).__isDioxusMock;
  return flag === true;
}
