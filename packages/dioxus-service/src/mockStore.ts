// Per-process registry of all DioxusMocks ever created. Used by the
// clearAllMocks / resetAllMocks / restoreAllMocks lifecycle helpers and by
// session cleanup.

import type { DioxusMock } from '@wdio/native-types';

export class DioxusServiceMockStore {
  #mocks: Map<string, DioxusMock>;

  constructor() {
    this.#mocks = new Map<string, DioxusMock>();
  }

  setMock(mock: DioxusMock): DioxusMock {
    this.#mocks.set(mock.getMockName(), mock);
    return mock;
  }

  getMock(mockId: string): DioxusMock {
    const mock = this.#mocks.get(mockId);
    if (!mock) {
      throw new Error(`No mock registered for "${mockId}"`);
    }
    return mock;
  }

  getMocks(): Array<[string, DioxusMock]> {
    return Array.from(this.#mocks.entries());
  }

  deleteMock(mockId: string): boolean {
    return this.#mocks.delete(mockId);
  }

  /** Empty the store. Called from session cleanup to prevent leaks across runs. */
  clear(): void {
    this.#mocks.clear();
  }
}

const mockStore = new DioxusServiceMockStore();
export default mockStore;
