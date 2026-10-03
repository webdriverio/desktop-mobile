// Mock-lifecycle helpers — clear/reset/restore across every mock the
// service has created. Each is filterable by `prefix` so multi-suite
// runs can isolate to e.g. all `dioxus.fs.*` mocks.

import type { DioxusMock } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import mockStore from '../mockStore.js';

const log = createLogger('dioxus-service', 'mock');

function matchesPrefix(name: string, prefix?: string): boolean {
  if (!prefix) {
    return true;
  }
  // Outer mocks are named `dioxus.<command>` (see mock.ts). Match against
  // both the bare command and the prefixed form so callers can pass either.
  const stripped = name.startsWith('dioxus.') ? name.slice('dioxus.'.length) : name;
  return name.startsWith(prefix) || stripped.startsWith(prefix);
}

async function forEachMock(prefix: string | undefined, fn: (m: DioxusMock) => Promise<unknown>): Promise<void> {
  for (const [name, m] of mockStore.getMocks()) {
    if (matchesPrefix(name, prefix)) {
      // Best-effort per entry, as in the electrobun/RN services: one failed unregistration
      // must not strand the rest in the app, which outlives the session in embedded mode.
      try {
        await fn(m);
      } catch (error) {
        log.warn(`bulk mock op failed for '${name}', continuing: ${(error as Error).message}`);
      }
    }
  }
}

export async function clearAllMocks(prefix?: string): Promise<void> {
  await forEachMock(prefix, (m) => m.mockClear());
}

export async function resetAllMocks(prefix?: string): Promise<void> {
  await forEachMock(prefix, (m) => m.mockReset());
}

export async function restoreAllMocks(prefix?: string): Promise<void> {
  await forEachMock(prefix, (m) => m.mockRestore());
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
