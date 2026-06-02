// Mock-lifecycle helpers — clear/reset/restore across every mock created against
// one bridge's store. Each is filterable by `prefix` (a target-path prefix) so a
// multi-suite run can isolate e.g. all 'api.*' mocks. isMockFunction is a
// structural check used by callers to branch on mock-vs-plain functions.

import type { ElectrobunMock } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from '../constants.js';
import type { ElectrobunMockStore } from '../mockStore.js';

const log = createLogger(SERVICE_NAME, 'mock');

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

async function forEachMock(
  store: ElectrobunMockStore,
  prefix: string | undefined,
  fn: (mock: ElectrobunMock) => Promise<unknown>,
): Promise<void> {
  // Snapshot first: mockRestore mutates the store mid-iteration.
  for (const [target, mock] of store.getMocks()) {
    if (matchesPrefix(target, prefix)) {
      // Best-effort per entry (matching closeBridges/stopElectrobunApp teardown): a single
      // mock's CDP call failing — e.g. the connection dropped or the inner recorder is gone
      // — must not abort the bulk op and leave the remaining mocks installed/unsynced.
      try {
        await fn(mock);
      } catch (error) {
        log.warn(`bulk mock op failed for '${target}', continuing: ${(error as Error).message}`);
      }
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
