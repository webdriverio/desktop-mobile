// Mock-lifecycle helpers — clear/reset/restore across every mock created against one
// session's store, plus the isMockFunction structural check. Filterable by targetPrefix.

import type { FlutterMock } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from '../constants.js';
import type { FlutterMockStore } from '../mockStore.js';

const log = createLogger(SERVICE_NAME, 'service');

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

async function forEachMock(
  store: FlutterMockStore,
  prefix: string | undefined,
  fn: (mock: FlutterMock) => Promise<unknown>,
): Promise<void> {
  for (const [target, mock] of store.getMocks()) {
    if (matchesPrefix(target, prefix)) {
      // Best-effort per entry: a single VM-Service failure must not abort the bulk op.
      try {
        await fn(mock);
      } catch (error) {
        log.warn(`bulk mock op failed for '${target}', continuing: ${(error as Error).message}`);
      }
    }
  }
}

export async function clearAllMocks(store: FlutterMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, (mock) => mock.mockClear());
}

export async function resetAllMocks(store: FlutterMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, (mock) => mock.mockReset());
}

export async function restoreAllMocks(store: FlutterMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, (mock) => mock.mockRestore());
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
