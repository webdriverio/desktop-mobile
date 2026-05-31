// Mock-lifecycle helpers — clear/reset/restore across every mock created against
// one bridge's store. Each is filterable by `prefix` (a target-path prefix) so a
// multi-suite run can isolate e.g. all 'api.*' mocks. isMockFunction is a
// structural check used by callers to branch on mock-vs-plain functions.

import type { ElectrobunMock } from '@wdio/native-types';

import type { ElectrobunMockStore } from '../mockStore.js';

function matchesPrefix(target: string, prefix?: string): boolean {
  if (!prefix) {
    return true;
  }
  return target.startsWith(prefix);
}

async function forEachMock(
  store: ElectrobunMockStore,
  prefix: string | undefined,
  fn: (mock: ElectrobunMock) => Promise<unknown>,
): Promise<void> {
  // Snapshot first: mockRestore mutates the store mid-iteration.
  for (const [target, mock] of store.getMocks()) {
    if (matchesPrefix(target, prefix)) {
      await fn(mock);
    }
  }
}

export async function clearAllMocks(store: ElectrobunMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, (mock) => mock.mockClear());
}

export async function resetAllMocks(store: ElectrobunMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, (mock) => mock.mockReset());
}

export async function restoreAllMocks(store: ElectrobunMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, (mock) => mock.mockRestore());
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
