// Per-installed-instance registry of every ElectrobunMock created against one
// bridge. Backs clearAllMocks / resetAllMocks / restoreAllMocks (filterable by
// prefix) and isMockFunction. NOT a singleton: each attached browser/bridge gets
// its own store so multiremote instances don't cross-contaminate.

import type { ElectrobunMock } from '@wdio/native-types';

export class ElectrobunMockStore {
  #mocks = new Map<string, ElectrobunMock>();

  setMock(target: string, mock: ElectrobunMock): ElectrobunMock {
    this.#mocks.set(target, mock);
    return mock;
  }

  getMock(target: string): ElectrobunMock | undefined {
    return this.#mocks.get(target);
  }

  getMocks(): Array<[string, ElectrobunMock]> {
    return Array.from(this.#mocks.entries());
  }

  deleteMock(target: string): boolean {
    return this.#mocks.delete(target);
  }

  clear(): void {
    this.#mocks.clear();
  }
}
