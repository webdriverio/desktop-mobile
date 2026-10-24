// Mock-lifecycle helpers — clear/reset/restore across every mock created against one
// session's store, plus the isMockFunction structural check. Filterable by targetPrefix.

import { type MockLifecycleOp, runBulkMockOp } from '@wdio/native-utils';

import type { FlutterMockStore } from '../mockStore.js';

function matchesPrefix(target: string, prefix?: string): boolean {
  if (!prefix) {
    return true;
  }
  const base = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix;
  return target === base || target.startsWith(`${base}.`);
}

/**
 * Does `broaderPrefix`'s scope contain `narrowerPrefix`'s scope — i.e. would a bulk op at
 * `broaderPrefix` already touch every target `narrowerPrefix` would? Uses the same segment-aware
 * semantics as {@link matchesPrefix} (an empty/undefined `broaderPrefix` = all targets), so it
 * recognises containment, not just an exact-prefix match (`''`/`'Foo'` covers `'Foo.Bar'`).
 */
export function prefixCovers(broaderPrefix: string | undefined, narrowerPrefix: string | undefined): boolean {
  const narrowerBase = !narrowerPrefix
    ? ''
    : narrowerPrefix.endsWith('.')
      ? narrowerPrefix.slice(0, -1)
      : narrowerPrefix;
  return matchesPrefix(narrowerBase, broaderPrefix);
}

async function forEachMock(store: FlutterMockStore, prefix: string | undefined, op: MockLifecycleOp): Promise<void> {
  await runBulkMockOp(store.getMocks(), op, { matches: (target) => matchesPrefix(target, prefix) });
}

export async function clearAllMocks(store: FlutterMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, 'mockClear');
}

export async function resetAllMocks(store: FlutterMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, 'mockReset');
}

export async function restoreAllMocks(store: FlutterMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, 'mockRestore');
}

export function isMockFunction(candidate: unknown, store: FlutterMockStore): boolean {
  if (typeof candidate === 'string') {
    return store.getMock(candidate) !== undefined;
  }
  if (candidate == null || typeof candidate !== 'function') {
    return false;
  }
  return (candidate as { __isFlutterMock?: unknown }).__isFlutterMock === true;
}
