// Per-attached-bridge registry of every ReactNativeMock created against one
// Hermes CDP session. Backs isMockFunction; clear/reset/restoreAllMocks land PR3.
// NOT a singleton: each bridge/worker gets its own store so sessions don't cross-contaminate.

import type { ReactNativeMock } from '@wdio/native-types';

export class ReactNativeMockStore {
  #mocks = new Map<string, ReactNativeMock>();

  setMock(target: string, mock: ReactNativeMock): ReactNativeMock {
    this.#mocks.set(target, mock);
    return mock;
  }

  getMock(target: string): ReactNativeMock | undefined {
    return this.#mocks.get(target);
  }

  getMocks(): Array<[string, ReactNativeMock]> {
    return Array.from(this.#mocks.entries());
  }

  deleteMock(target: string): boolean {
    return this.#mocks.delete(target);
  }

  clear(): void {
    this.#mocks.clear();
  }
}
