// Mock-lifecycle helpers — clear/reset/restore across every mock created against
// one bridge's store, and isMockFunction structural check.
// Filterable by targetPrefix so multi-suite runs can isolate e.g. 'nativeModuleProxy.*'.

import { type MockLifecycleOp, runBulkMockOp } from '@wdio/native-utils';

import type { ReactNativeMockStore } from '../mockStore.js';

function matchesPrefix(target: string, prefix?: string): boolean {
  if (!prefix) {
    return true;
  }
  // Namespace-aware: 'nativeModuleProxy' matches 'nativeModuleProxy' and
  // 'nativeModuleProxy.Clipboard.getString' but NOT 'nativeModuleProxy2.*'.
  const base = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix;
  return target === base || target.startsWith(`${base}.`);
}

async function forEachMock(
  store: ReactNativeMockStore,
  prefix: string | undefined,
  op: MockLifecycleOp,
): Promise<void> {
  await runBulkMockOp(store.getMocks(), op, { matches: (target) => matchesPrefix(target, prefix) });
}

export async function clearAllMocks(store: ReactNativeMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, 'mockClear');
}

export async function resetAllMocks(store: ReactNativeMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, 'mockReset');
}

export async function restoreAllMocks(store: ReactNativeMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, 'mockRestore');
}

export function isMockFunction(candidate: unknown, store: ReactNativeMockStore): boolean {
  if (typeof candidate === 'string') {
    return store.getMock(candidate) !== undefined;
  }
  if (candidate == null || typeof candidate !== 'function') {
    return false;
  }
  return (candidate as { __isReactNativeMock?: unknown }).__isReactNativeMock === true;
}
