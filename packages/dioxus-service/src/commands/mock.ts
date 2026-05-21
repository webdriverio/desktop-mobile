// browser.dioxus.mock(command) — public entry point.

import type { DioxusMock } from '@wdio/native-types';

import { createMock } from '../mock.js';

export async function mock(command: string, browserContext?: WebdriverIO.Browser): Promise<DioxusMock> {
  return createMock(command, browserContext);
}
