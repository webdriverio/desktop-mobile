// browser.electrobun.mock(target) — public entry point.

import type { MultiTargetCdpBridge as CdpBridge } from '@wdio/native-cdp-bridge';
import type { ElectrobunMock } from '@wdio/native-types';

import { createMock } from '../mock.js';
import type { ElectrobunMockStore } from '../mockStore.js';

export function mock(target: string, bridge: CdpBridge, store: ElectrobunMockStore): Promise<ElectrobunMock> {
  return createMock(target, bridge, store);
}
