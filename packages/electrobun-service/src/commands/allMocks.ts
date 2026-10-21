// Mock-lifecycle helpers — clear/reset/restore across every mock created against
// one bridge's store. Each is filterable by `prefix` (a target-path prefix) so a
// multi-suite run can isolate e.g. all 'api.*' mocks. isMockFunction is a
// structural check used by callers to branch on mock-vs-plain functions.

import { type MockLifecycleOp, runBulkMockOp } from '@wdio/native-utils';

import type { ElectrobunMockStore } from '../mockStore.js';

function matchesPrefix(target: string, prefix?: string): boolean {
  if (!prefix) {
    return true;
  }
  // Namespace-aware: `prefix` matches the target only at a dot boundary, so 'api' (or
  // 'api.') matches 'api' and 'api.fetchData' but NOT sibling namespaces like
  // 'api2.fetchData' / 'apiAuth.x' — a bare startsWith would over-match, so
  // clearAllMocks('api') would silently clear 'api2.*' too. Normalise a trailing dot so
  // both the 'api' and 'api.' forms behave identically.
  const base = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix;
  return target === base || target.startsWith(`${base}.`);
}

async function forEachMock(store: ElectrobunMockStore, prefix: string | undefined, op: MockLifecycleOp): Promise<void> {
  await runBulkMockOp(store.getMocks(), op, { matches: (target) => matchesPrefix(target, prefix) });
}

export async function clearAllMocks(store: ElectrobunMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, 'mockClear');
}

export async function resetAllMocks(store: ElectrobunMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, 'mockReset');
}

export async function restoreAllMocks(store: ElectrobunMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, 'mockRestore');
}

/**
 * True iff `candidate` is an ElectrobunMock — checked structurally via the
 * `__isElectrobunMock: true` flag set in mock.ts. A bare target-path string is
 * resolved against the store so `isMockFunction('api.fetchData')` works too.
 */
export function isMockFunction(candidate: unknown, store: ElectrobunMockStore): boolean {
  if (typeof candidate === 'string') {
    return store.getMock(candidate) !== undefined;
  }
  if (candidate == null || typeof candidate !== 'function') {
    return false;
  }
  return (candidate as { __isElectrobunMock?: unknown }).__isElectrobunMock === true;
}
