import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/vmServiceDiscovery.js', () => ({
  discoverVmServiceUrl: vi.fn().mockResolvedValue('ws://host/ws'),
}));

const fakeClient = () => ({
  connected: true,
  connect: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  resolveRootLibrary: vi.fn().mockResolvedValue({ isolateId: 'i', rootLibraryId: 'r' }),
  evaluate: vi.fn().mockResolvedValue({ kind: 'Bool', valueAsString: 'true' }),
  getMainIsolateId: vi.fn().mockResolvedValue('i'),
  callServiceExtension: vi.fn().mockResolvedValue({ ok: true }),
});
vi.mock('../src/vmService.js', () => ({
  VmServiceClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, fakeClient());
  }),
}));

import FlutterWorkerService from '../src/service.js';
import type { FlutterCapabilities } from '../src/types.js';

const cap = { platformName: 'Android' } as FlutterCapabilities;

describe('FlutterWorkerService', () => {
  it('should install browser.flutter in before()', async () => {
    const browser = {} as WebdriverIO.Browser & { flutter?: Record<string, unknown> };
    const service = new FlutterWorkerService({}, cap);
    await service.before(cap, [], browser);
    expect(typeof browser.flutter?.execute).toBe('function');
    expect(typeof browser.flutter?.mock).toBe('function');
    expect(typeof browser.flutter?.triggerDeeplink).toBe('function');
    expect(typeof browser.flutter?.switchWindow).toBe('function');
  });

  it('execute should evaluate via the VM Service and coerce the result', async () => {
    const browser = {} as WebdriverIO.Browser & { flutter?: { execute: (s: string) => Promise<unknown> } };
    const service = new FlutterWorkerService({}, cap);
    await service.before(cap, [], browser);
    expect(await browser.flutter?.execute('WidgetsBinding.instance != null')).toBe(true);
  });

  it('after() should tear down without throwing', async () => {
    const browser = {} as WebdriverIO.Browser;
    const service = new FlutterWorkerService({}, cap);
    await service.before(cap, [], browser);
    await expect(service.after()).resolves.toBeUndefined();
  });

  it('should reuse the existing connection across calls', async () => {
    const browser = {} as WebdriverIO.Browser & { flutter?: { execute: (s: string) => Promise<unknown> } };
    const service = new FlutterWorkerService({}, cap);
    await service.before(cap, [], browser);
    await browser.flutter?.execute('a');
    await expect(browser.flutter?.execute('b')).resolves.toBe(true);
  });

  it('mock + isMockFunction + clearAllMocks should work end-to-end', async () => {
    const browser = {} as WebdriverIO.Browser & {
      flutter?: {
        mock: (t: string) => Promise<unknown>;
        isMockFunction: (t: unknown) => boolean;
        clearAllMocks: () => Promise<void>;
      };
    };
    const service = new FlutterWorkerService({}, cap);
    await service.before(cap, [], browser);
    await browser.flutter?.mock('Svc.m');
    expect(browser.flutter?.isMockFunction('Svc.m')).toBe(true);
    await expect(browser.flutter?.clearAllMocks()).resolves.toBeUndefined();
  });

  it('beforeTest should be a no-op when not connected', async () => {
    const browser = {} as WebdriverIO.Browser;
    const service = new FlutterWorkerService({ clearMocks: true }, cap);
    await service.before(cap, [], browser);
    await expect(service.beforeTest()).resolves.toBeUndefined();
  });

  it('beforeTest should run the mock lifecycle when connected', async () => {
    const browser = {} as WebdriverIO.Browser & { flutter?: { mock: (t: string) => Promise<unknown> } };
    const service = new FlutterWorkerService({ clearMocks: true, resetMocks: true, restoreMocks: true }, cap);
    await service.before(cap, [], browser);
    await browser.flutter?.mock('Svc.m');
    await expect(service.beforeTest()).resolves.toBeUndefined();
  });

  it('afterTest should forward device logs when captureBackendLogs is set', async () => {
    const getLogs = vi.fn().mockResolvedValue([{ message: 'x', level: 'INFO', timestamp: 1 }]);
    const browser = { getLogs } as unknown as WebdriverIO.Browser;
    const service = new FlutterWorkerService({ captureBackendLogs: true }, cap);
    await service.before(cap, [], browser);
    await service.afterTest();
    expect(getLogs).toHaveBeenCalledWith('logcat');
  });
});
