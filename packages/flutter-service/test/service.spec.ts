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

  it('should open only one connection for concurrent ops (single-flight guard)', async () => {
    const { VmServiceClient } = (await import('../src/vmService.js')) as unknown as {
      VmServiceClient: { mock: { calls: unknown[] }; mockClear: () => void };
    };
    VmServiceClient.mockClear();
    const browser = {} as WebdriverIO.Browser & {
      flutter?: { execute: (s: string) => Promise<unknown>; mock: (t: string) => Promise<unknown> };
    };
    const service = new FlutterWorkerService({}, cap);
    await service.before(cap, [], browser);
    await Promise.all([browser.flutter?.execute('a'), browser.flutter?.mock('Svc.m')]);
    expect(VmServiceClient.mock.calls.length).toBe(1);
  });

  it('rediscovers and retries within one call when the cached URL is stale (app relaunch)', async () => {
    const { VmServiceClient } = (await import('../src/vmService.js')) as unknown as {
      VmServiceClient: ReturnType<typeof vi.fn>;
    };
    const { discoverVmServiceUrl } = (await import('../src/vmServiceDiscovery.js')) as unknown as {
      discoverVmServiceUrl: ReturnType<typeof vi.fn>;
    };
    discoverVmServiceUrl.mockClear();
    let firstClient: Record<string, unknown> | undefined;
    // mockImplementationOnce queues these in order then falls back to the default impl — no leak.
    VmServiceClient.mockImplementationOnce(function (this: Record<string, unknown>) {
      Object.assign(this, fakeClient());
      firstClient = this; // capture so we can simulate a passive drop below
    })
      .mockImplementationOnce(function (this: Record<string, unknown>) {
        // The reconnect attempt against the STALE cached URL: connect rejects.
        Object.assign(this, fakeClient());
        this.connected = false;
        this.connect = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      })
      .mockImplementationOnce(function (this: Record<string, unknown>) {
        Object.assign(this, fakeClient()); // post-rediscovery: connects fine
      });

    const browser = {} as WebdriverIO.Browser & { flutter?: { execute: (s: string) => Promise<unknown> } };
    const service = new FlutterWorkerService({}, cap);
    await service.before(cap, [], browser);
    await browser.flutter?.execute('a'); // discover + connect; URL cached
    (firstClient as Record<string, unknown>).connected = false; // app killed + relaunched
    // The next command tries the cached URL (fails), rediscovers, retries — and SUCCEEDS in-call.
    await expect(browser.flutter?.execute('b')).resolves.toBe(true);
    expect(discoverVmServiceUrl).toHaveBeenCalledTimes(2); // initial + rediscovery
  });

  it('afterTest should forward device logs when captureBackendLogs is set', async () => {
    const getLogs = vi.fn().mockResolvedValue([{ message: 'x', level: 'INFO', timestamp: 1 }]);
    const browser = { getLogs } as unknown as WebdriverIO.Browser;
    const service = new FlutterWorkerService({ captureBackendLogs: true }, cap);
    await service.before(cap, [], browser);
    await service.afterTest();
    expect(getLogs).toHaveBeenCalledWith('logcat');
  });

  it('emitEvent should drive the VM Service', async () => {
    const browser = {} as WebdriverIO.Browser & { flutter?: { emitEvent: (n: string, p?: unknown) => Promise<void> } };
    const service = new FlutterWorkerService({}, cap);
    await service.before(cap, [], browser);
    await expect(browser.flutter?.emitEvent('ev', { a: 1 })).resolves.toBeUndefined();
  });

  it('byValueKey / byText should return element handles', async () => {
    const browser = {} as WebdriverIO.Browser & {
      flutter?: { byValueKey: (k: string) => { tap: unknown }; byText: (t: string) => { getText: unknown } };
    };
    const service = new FlutterWorkerService({}, cap);
    await service.before(cap, [], browser);
    expect(typeof browser.flutter?.byValueKey('k').tap).toBe('function');
    expect(typeof browser.flutter?.byText('t').getText).toBe('function');
  });
});
