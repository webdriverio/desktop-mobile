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

async function runOnMocks(
  commandName: string,
  browser: MockOwner,
  op: MockLifecycleOp,
  prefix: string | undefined,
): Promise<void> {
  const runOn = (owner: MockOwner) =>
    runBulkMockOp(mockStore.getMocks(owner), op, { matches: (name) => matchesPrefix(name, prefix) });

  if (!isMultiremote(browser)) {
    await runOn(browser);
    return;
  }

  const failures: Array<{ name: string; error: unknown }> = [];
  const attempt = async (name: string, owner: MockOwner) => {
    try {
      await runOn(owner);
    } catch (error) {
      failures.push({ name, error });
    }
  };
  await forEachInstance(browser, (instance, { name }) => attempt(String(name), instance));
  await attempt('the multiremote root', browser);
  if (failures.length === 0) {
    return;
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
