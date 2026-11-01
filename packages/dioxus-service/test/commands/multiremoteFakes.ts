import { vi } from 'vitest';

export function createFakeMultiremote() {
  const instances: Record<string, WebdriverIO.Browser> = {
    browserA: {
      sessionId: 'session-a',
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as WebdriverIO.Browser,
    browserB: {
      sessionId: 'session-b',
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as WebdriverIO.Browser,
  };
  const root = {
    isMultiremote: true,
    instances: Object.keys(instances),
    getInstance: (name: string) => instances[name],
    execute: vi.fn().mockResolvedValue(undefined),
  } as unknown as WebdriverIO.MultiRemoteBrowser;
  return { root, browserA: instances.browserA, browserB: instances.browserB };
}
