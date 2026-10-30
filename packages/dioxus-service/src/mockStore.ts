// Per-process registry of all DioxusMocks ever created. Used by the
// clearAllMocks / resetAllMocks / restoreAllMocks lifecycle helpers and by
// session cleanup.

import type { DioxusMock } from '@wdio/native-types';

export type MockOwner = WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser;

// Keyed by browser, so each multiremote instance has its own mocks.
export class DioxusServiceMockStore {
  #mocksByOwner: Map<MockOwner, Map<string, DioxusMock>>;

  constructor() {
    this.#mocksByOwner = new Map<MockOwner, Map<string, DioxusMock>>();
  }

  setMock(owner: MockOwner, mock: DioxusMock): DioxusMock {
    let mocks = this.#mocksByOwner.get(owner);
    if (!mocks) {
      mocks = new Map<string, DioxusMock>();
      this.#mocksByOwner.set(owner, mocks);
    }
    mocks.set(mock.getMockName(), mock);
    return mock;
  }

  getMock(owner: MockOwner, mockId: string): DioxusMock {
    const mock = this.#mocksByOwner.get(owner)?.get(mockId);
    if (!mock) {
      throw new Error(`No mock registered for "${mockId}"`);
    }
    return mock;
  }

  getMocks(owner: MockOwner): Array<[string, DioxusMock]> {
    return Array.from(this.#mocksByOwner.get(owner)?.entries() ?? []);
  }

  getAllMocks(): Array<[string, DioxusMock]> {
    return Array.from(this.#mocksByOwner.values()).flatMap((mocks) => Array.from(mocks.entries()));
  }

  deleteMock(owner: MockOwner, mockId: string): boolean {
    const mocks = this.#mocksByOwner.get(owner);
    if (!mocks?.delete(mockId)) {
      return false;
    }
    if (mocks.size === 0) {
      this.#mocksByOwner.delete(owner);
    }
    return true;
  }

  /** Empty the store. Called from session cleanup to prevent leaks across runs. */
  clear(): void {
    this.#mocksByOwner.clear();
  }
}

const mockStore = new DioxusServiceMockStore();
export default mockStore;
