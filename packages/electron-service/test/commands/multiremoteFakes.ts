import { vi } from 'vitest';

function createFakeInstance(sessionId: string): WebdriverIO.Browser {
  return {
    sessionId,
    execute: vi.fn().mockResolvedValue(undefined),
    electron: { execute: vi.fn().mockResolvedValue(undefined) },
  } as unknown as WebdriverIO.Browser;
}

export function createFakeMultiremote() {
  const instances: Record<string, WebdriverIO.Browser> = {
    browserA: createFakeInstance('session-a'),
    browserB: createFakeInstance('session-b'),
  };
  const root = {
    isMultiremote: true,
    instances: Object.keys(instances),
    getInstance: (name: string) => instances[name],
    execute: vi.fn().mockResolvedValue(undefined),
    electron: { execute: vi.fn().mockResolvedValue(undefined) },
  } as unknown as WebdriverIO.MultiRemoteBrowser;
  return { root, browserA: instances.browserA, browserB: instances.browserB };
}
