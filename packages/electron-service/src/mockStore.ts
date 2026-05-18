import type { ElectronMock } from '@wdio/native-types';

export class ElectronServiceMockStore {
  #mockFns: Map<string, ElectronMock>;

  constructor() {
    this.#mockFns = new Map<string, ElectronMock>();
  }

  setMock(mock: ElectronMock): ElectronMock {
    const mockName = mock.getMockName();
    this.#mockFns.set(mockName, mock);
    return mock;
  }

  setMockWithKey(key: string, mock: ElectronMock): ElectronMock {
    this.#mockFns.set(key, mock);
    return mock;
  }

  getMock(mockId: string): ElectronMock {
    const mock = this.#mockFns.get(mockId);
    if (!mock) {
      throw new Error(`No mock registered for "${mockId}"`);
    }

    return mock;
  }

  getMocks() {
    return Array.from(this.#mockFns.entries());
  }

  deleteMock(mockId: string): boolean {
    return this.#mockFns.delete(mockId);
  }

  deleteMockByRef(mock: ElectronMock): boolean {
    for (const [key, m] of this.#mockFns) {
      if (m === mock) {
        return this.#mockFns.delete(key);
      }
    }
    return false;
  }

  clear(): void {
    this.#mockFns.clear();
  }
}

const mockStore = new ElectronServiceMockStore();

export default mockStore;
