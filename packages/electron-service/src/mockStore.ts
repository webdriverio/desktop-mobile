import type { ElectronFunctionMock } from '@wdio/native-types';

export type MockOwner = WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser;

// Keyed by browser, so each multiremote instance has its own mocks.
export class ElectronServiceMockStore {
  #mocksByOwner: Map<MockOwner, Map<string, ElectronFunctionMock>>;

  constructor() {
    this.#mocksByOwner = new Map<MockOwner, Map<string, ElectronFunctionMock>>();
  }

  setMock(owner: MockOwner, mock: ElectronFunctionMock): ElectronFunctionMock {
    let mocks = this.#mocksByOwner.get(owner);
    if (!mocks) {
      mocks = new Map<string, ElectronFunctionMock>();
      this.#mocksByOwner.set(owner, mocks);
    }
    mocks.set(mock.getMockName(), mock);
    return mock;
  }

  getMock(owner: MockOwner, mockId: string): ElectronFunctionMock {
    const mock = this.#mocksByOwner.get(owner)?.get(mockId);
    if (!mock) {
      throw new Error(`No mock registered for "${mockId}"`);
    }

    return mock;
  }

  getMocks(owner: MockOwner): [string, ElectronFunctionMock][] {
    return Array.from(this.#mocksByOwner.get(owner)?.entries() ?? []);
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

  clear(): void {
    this.#mocksByOwner.clear();
  }
}

const mockStore = new ElectronServiceMockStore();

export default mockStore;
