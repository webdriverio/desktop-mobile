// Per-session registry of every FlutterMock created against one VM Service connection.
// Backs isMockFunction + clear/reset/restoreAllMocks. NOT a singleton — each worker gets
// its own store so sessions don't cross-contaminate.

import type { FlutterMock } from '@wdio/native-types';

export class FlutterMockStore {
  #mocks = new Map<string, FlutterMock>();

  setMock(target: string, mock: FlutterMock): FlutterMock {
    this.#mocks.set(target, mock);
    return mock;
  }

  getMock(target: string): FlutterMock | undefined {
    return this.#mocks.get(target);
  }

  getMocks(): Array<[string, FlutterMock]> {
    return Array.from(this.#mocks.entries());
  }

  deleteMock(target: string): boolean {
    return this.#mocks.delete(target);
  }

  clear(): void {
    this.#mocks.clear();
  }
}
