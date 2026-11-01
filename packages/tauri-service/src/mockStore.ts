import type { TauriMock } from '@wdio/native-types';

type MockOwner = WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser;

// Keyed by browser, so each multiremote instance has its own mocks.
export class TauriServiceMockStore {
  #mocksByOwner: Map<MockOwner, Map<string, TauriMock>>;

  constructor() {
    this.#mocksByOwner = new Map<MockOwner, Map<string, TauriMock>>();
  }

  setMock(owner: MockOwner, mock: TauriMock): TauriMock {
    let mocks = this.#mocksByOwner.get(owner);
    if (!mocks) {
      mocks = new Map<string, TauriMock>();
      this.#mocksByOwner.set(owner, mocks);
    }
    mocks.set(mock.getMockName(), mock);
    return mock;
  }

  getMock(owner: MockOwner, mockId: string): TauriMock {
    const mock = this.#mocksByOwner.get(owner)?.get(mockId);
    if (!mock) {
      throw new Error(`No mock registered for "${mockId}"`);
    }

    return mock;
  }

  getMocks(owner: MockOwner): [string, TauriMock][] {
    return Array.from(this.#mocksByOwner.get(owner)?.entries() ?? []);
  }

  getAllMocks(): [string, TauriMock][] {
    return Array.from(this.#mocksByOwner.values()).flatMap((mocks) => Array.from(mocks.entries()));
  }

  /**
   * Remove a specific mock from the store
   */
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

  /**
   * Clear all mocks from the store
   * Called during session cleanup to prevent memory leaks
   */
  clear(): void {
    this.#mocksByOwner.clear();
  }
}

const mockStore = new TauriServiceMockStore();

export default mockStore;
