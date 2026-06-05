// Mock-lifecycle helpers — clear/reset/restore across every mock created against
// one bridge's store, and isMockFunction structural check.
// Filterable by targetPrefix so multi-suite runs can isolate e.g. 'nativeModuleProxy.*'.

import type { ReactNativeMock } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from '../constants.js';
import type { ReactNativeMockStore } from '../mockStore.js';

const log = createLogger(SERVICE_NAME, 'bridge');

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
  fn: (mock: ReactNativeMock) => Promise<unknown>,
): Promise<void> {
  for (const [target, mock] of store.getMocks()) {
    if (matchesPrefix(target, prefix)) {
      // Best-effort per entry: a single CDP failure (dropped connection, recorder gone)
      // must not abort the bulk op and leave remaining mocks unsynced.
      try {
        await fn(mock);
      } catch (error) {
        log.warn(`bulk mock op failed for '${target}', continuing: ${(error as Error).message}`);
      }
    }
  }
}

export async function clearAllMocks(store: ReactNativeMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, (mock) => mock.mockClear());
}

export async function resetAllMocks(store: ReactNativeMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, (mock) => mock.mockReset());
}

export async function restoreAllMocks(store: ReactNativeMockStore, prefix?: string): Promise<void> {
  await forEachMock(store, prefix, (mock) => mock.mockRestore());
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
