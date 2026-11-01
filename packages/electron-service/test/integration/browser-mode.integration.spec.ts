import { createIpcInterceptor } from '@wdio/native-spy/interceptor';
import type { ElectronFunctionMock, ElectronServiceAPI, ElectronServiceGlobalOptions } from '@wdio/native-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mockStore from '../../src/mockStore.js';
import ElectronWorkerService from '../../src/service.js';
import {
  createFakeBrowser,
  createFakeMock,
  createFakeMultiremoteBrowser,
  defer,
  type FakeBrowser,
  type FakeMock,
  type FakeMultiremoteBrowser,
  flushMicrotasks,
} from './helpers.js';

vi.mock('@wdio/native-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-utils')>()),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  })),
  waitUntilWindowAvailable: vi.fn().mockResolvedValue(undefined),
}));

describe('browser mode — MockUpdateScheduler', () => {
  let service: ElectronWorkerService;
  let browser: FakeBrowser;

  beforeEach(async () => {
    mockStore.clear();
    service = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});
    browser = createFakeBrowser();
    await service.before({}, [], browser as unknown as WebdriverIO.Browser);
  });

  afterEach(() => {
    mockStore.clear();
  });

  function seedMock(channel: string): FakeMock {
    const fake = createFakeMock(`electron.${channel}`);
    mockStore.setMock(browser as unknown as WebdriverIO.Browser, fake.mock);
    return fake;
  }

  it('should trigger two update batches when two concurrent clicks fire', async () => {
    const fake = seedMock('appInfo:get');

    const c1 = browser.triggerCommand('click');
    const c2 = browser.triggerCommand('click');
    await Promise.all([c1, c2]);

    expect(fake.update).toHaveBeenCalledTimes(2);
  });

  it('should coalesce three rapid clicks into exactly two batches', async () => {
    const fake = seedMock('appInfo:get');

    const c1 = browser.triggerCommand('click');
    const c2 = browser.triggerCommand('click');
    const c3 = browser.triggerCommand('click');
    await Promise.all([c1, c2, c3]);

    expect(fake.update).toHaveBeenCalledTimes(2);
  });

  it('should not poison the next batch when a previous batch rejects', async () => {
    const fake = seedMock('appInfo:get');
    // Fail both the initial attempt and its one retry so the lane genuinely rejects
    // (a single rejection would be recovered by tryUpdate's retry and never surface).
    fake.update.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new Error('boom-retry'));

    await expect(browser.triggerCommand('click')).rejects.toThrow();
    expect(fake.update).toHaveBeenCalledTimes(2);

    // A failed batch must not poison the scheduler — the next click recovers.
    await browser.triggerCommand('click');
    expect(fake.update).toHaveBeenCalledTimes(3);
  });

  it('should run two browser instances independently without cross-blocking', async () => {
    const browserB = createFakeBrowser();
    const serviceB = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5174' }, {});
    await serviceB.before({}, [], browserB as unknown as WebdriverIO.Browser);

    const fakeA = createFakeMock('electron.a');
    const fakeB = createFakeMock('electron.b');
    mockStore.setMock(browser as unknown as WebdriverIO.Browser, fakeA.mock);
    mockStore.setMock(browserB as unknown as WebdriverIO.Browser, fakeB.mock);

    const aHeld = defer<void>();
    fakeA.update.mockImplementationOnce(() => aHeld.promise);

    const clickA = browser.triggerCommand('click');
    const clickB = browserB.triggerCommand('click');

    await clickB;
    expect(fakeB.update).toHaveBeenCalledTimes(1);

    let aSettled = false;
    clickA.finally(() => {
      aSettled = true;
    });
    await flushMicrotasks();
    expect(aSettled).toBe(false);

    aHeld.resolve();
    await clickA;
    expect(fakeA.update).toHaveBeenCalledTimes(1);
  });

  it('should be a no-op when the mock store is empty', async () => {
    await expect(browser.triggerCommand('click')).resolves.not.toThrow();
  });

  it('should not run a parallel batch when a click arrives between running and queued', async () => {
    const fake = seedMock('appInfo:get');

    // Block the first batch's update so the queued batch is set up.
    const firstHeld = defer<void>();
    fake.update.mockImplementationOnce(() => firstHeld.promise);
    // Block the second (queued) batch as well, so a third click can race in
    // between the first batch settling and the queued's #runOnce starting.
    const secondHeld = defer<void>();
    fake.update.mockImplementationOnce(() => secondHeld.promise);

    const c1 = browser.triggerCommand('click');
    const c2 = browser.triggerCommand('click');

    // Settle the first batch — between this and the queued batch's #runOnce,
    // a third schedule() must NOT spawn a parallel #runOnce.
    firstHeld.resolve();
    await flushMicrotasks();
    const c3 = browser.triggerCommand('click');
    await flushMicrotasks();

    // Only the queued batch should have started (update call count = 2),
    // not a third concurrent batch.
    expect(fake.update).toHaveBeenCalledTimes(2);

    secondHeld.resolve();
    await Promise.all([c1, c2, c3]);
    // After all settle, click 3's batch ran exactly once.
    expect(fake.update).toHaveBeenCalledTimes(3);
  });

  it('should route updates to the per-instance scheduler when the override fires with this.browser set', async () => {
    // Simulate the multiremote case: the override is registered on `browser`
    // (the "root"), but a click fires with `this.browser` = a per-instance
    // session that owns its own mocks.
    const instanceBrowser = createFakeBrowser();
    const fake = createFakeMock('electron.instance-channel');
    mockStore.setMock(instanceBrowser as unknown as WebdriverIO.Browser, fake.mock);

    // Trigger the override registered on `browser` but pass instanceBrowser as
    // the per-instance owner — the override should route through the
    // instance's scheduler so the per-instance mock key matches.
    await browser.triggerCommand('click', instanceBrowser as unknown as WebdriverIO.Browser);

    expect(fake.update).toHaveBeenCalledTimes(1);
  });
});

describe('browser mode — registration gate', () => {
  let service: ElectronWorkerService;
  let browser: FakeBrowser;

  beforeEach(async () => {
    mockStore.clear();
    service = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});
    browser = createFakeBrowser();
    await service.before({}, [], browser as unknown as WebdriverIO.Browser);
  });

  afterEach(() => {
    mockStore.clear();
  });

  function seedExistingMock(channel: string) {
    const mockClear = vi.fn().mockResolvedValue(undefined);
    const replayBrowserImpl = vi.fn().mockResolvedValue(undefined);
    const existing = {
      __isElectronMock: true,
      __replayBrowserImpl: replayBrowserImpl,
      mockClear,
      getMockName: () => `electron.${channel}`,
      update: vi.fn().mockResolvedValue(undefined),
    };
    mockStore.setMock(browser as unknown as WebdriverIO.Browser, existing as unknown as ElectronFunctionMock);
    return { existing, mockClear, replayBrowserImpl };
  }

  function isLivenessScript(arg: unknown): boolean {
    return typeof arg === 'string' && arg.startsWith('return !!(window.__wdio_mocks__');
  }

  function isRegistrationScript(arg: unknown, channel: string): boolean {
    return (
      typeof arg === 'string' && arg.includes(`__wdio_mocks__[${JSON.stringify(channel)}]`) && !isLivenessScript(arg)
    );
  }

  it('should register exactly once when two concurrent mock() calls race after navigation', async () => {
    const { mockClear, replayBrowserImpl } = seedExistingMock('appInfo:get');
    browser.execute.mockResolvedValue(false);

    const api = (browser.electron as { mock: (c: string) => Promise<unknown> }).mock;
    await Promise.all([api('appInfo:get'), api('appInfo:get')]);

    const livenessCalls = browser.execute.mock.calls.filter((c) => isLivenessScript(c[0]));
    const registrationCalls = browser.execute.mock.calls.filter((c) => isRegistrationScript(c[0], 'appInfo:get'));
    expect(livenessCalls).toHaveLength(1);
    expect(registrationCalls).toHaveLength(1);
    expect(replayBrowserImpl).toHaveBeenCalledTimes(1);
    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it('should not serialize concurrent mock() calls on different channels', async () => {
    seedExistingMock('chan1');
    seedExistingMock('chan2');

    const chan1Registration = defer<unknown>();
    browser.execute.mockImplementation(async (arg: unknown) => {
      if (isLivenessScript(arg)) {
        return false;
      }
      if (isRegistrationScript(arg, 'chan1')) {
        return chan1Registration.promise;
      }
      return undefined;
    });

    const api = (browser.electron as { mock: (c: string) => Promise<unknown> }).mock;
    const p1 = api('chan1');
    const p2 = api('chan2');

    await p2;
    let p1Settled = false;
    p1.finally(() => {
      p1Settled = true;
    });
    await flushMicrotasks();
    expect(p1Settled).toBe(false);

    chan1Registration.resolve(undefined);
    await p1;
  });

  it('should skip re-registration when the browser side is already live', async () => {
    const { mockClear, replayBrowserImpl } = seedExistingMock('appInfo:get');
    browser.execute.mockResolvedValue(true);

    const api = (browser.electron as { mock: (c: string) => Promise<unknown> }).mock;
    await api('appInfo:get');

    const registrationCalls = browser.execute.mock.calls.filter((c) => isRegistrationScript(c[0], 'appInfo:get'));
    expect(registrationCalls).toHaveLength(0);
    expect(replayBrowserImpl).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  });

  it('should allow a later mock() call to retry after a registration failure', async () => {
    const { mockClear, replayBrowserImpl } = seedExistingMock('appInfo:get');
    let livenessCalls = 0;
    let registrationCalls = 0;
    browser.execute.mockImplementation(async (arg: unknown) => {
      if (isLivenessScript(arg)) {
        livenessCalls++;
        return false;
      }
      if (isRegistrationScript(arg, 'appInfo:get')) {
        registrationCalls++;
        if (registrationCalls === 1) {
          throw new Error('registration failed');
        }
        return undefined;
      }
      return undefined;
    });

    const api = (browser.electron as { mock: (c: string) => Promise<unknown> }).mock;
    await expect(api('appInfo:get')).rejects.toThrow('registration failed');

    await api('appInfo:get');
    expect(livenessCalls).toBe(2);
    expect(registrationCalls).toBe(2);
    expect(replayBrowserImpl).toHaveBeenCalledTimes(1);
    expect(mockClear).toHaveBeenCalledTimes(1);
  });
});

describe('browser mode — navigation lifecycle', () => {
  let service: ElectronWorkerService;
  let browser: FakeBrowser;

  beforeEach(async () => {
    mockStore.clear();
    service = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});
    browser = createFakeBrowser();
    await service.before({}, [], browser as unknown as WebdriverIO.Browser);
  });

  afterEach(() => {
    mockStore.clear();
  });

  function isLivenessScript(arg: unknown): boolean {
    return typeof arg === 'string' && arg.startsWith('return !!(window.__wdio_mocks__');
  }

  function isRegistrationScript(arg: unknown, channel: string): boolean {
    return (
      typeof arg === 'string' && arg.includes(`__wdio_mocks__[${JSON.stringify(channel)}]`) && !isLivenessScript(arg)
    );
  }

  function isInjectionScript(arg: unknown): boolean {
    // The full IPC injection script references __wdio_mocks__ but is neither
    // a liveness probe nor a single-channel registration call.
    return (
      typeof arg === 'string' && arg.includes('__wdio_mocks__') && !isLivenessScript(arg) && !arg.startsWith('return (')
    );
  }

  it('should re-inject IPC and re-register the mock through a full navigation cycle', async () => {
    const mockClear = vi.fn().mockResolvedValue(undefined);
    const replayBrowserImpl = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const existing = {
      __isElectronMock: true,
      __replayBrowserImpl: replayBrowserImpl,
      mockClear,
      getMockName: () => 'electron.appInfo:get',
      update,
    };
    mockStore.setMock(browser as unknown as WebdriverIO.Browser, existing as unknown as ElectronFunctionMock);

    await browser.triggerCommand('click');
    expect(update).toHaveBeenCalledTimes(1);

    browser.execute.mockClear();
    await browser.url('http://localhost:5173/page2');
    const injectionAfterNav = browser.execute.mock.calls.filter((c) => isInjectionScript(c[0]));
    expect(injectionAfterNav.length).toBeGreaterThan(0);

    browser.execute.mockImplementation(async (arg: unknown) => {
      if (isLivenessScript(arg)) {
        return false;
      }
      return undefined;
    });

    const api = (browser.electron as { mock: (c: string) => Promise<unknown> }).mock;
    const returned = await api('appInfo:get');
    expect(returned).toBe(existing);
    expect(replayBrowserImpl).toHaveBeenCalledTimes(1);
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(browser.execute.mock.calls.filter((c) => isRegistrationScript(c[0], 'appInfo:get'))).toHaveLength(1);

    browser.execute.mockResolvedValue(undefined);
    await browser.triggerCommand('click');
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('should call mockClear exactly once when several consumers race to recover after navigation', async () => {
    const mockClear = vi.fn().mockResolvedValue(undefined);
    const replayBrowserImpl = vi.fn().mockResolvedValue(undefined);
    const existing = {
      __isElectronMock: true,
      __replayBrowserImpl: replayBrowserImpl,
      mockClear,
      getMockName: () => 'electron.appInfo:get',
      update: vi.fn().mockResolvedValue(undefined),
    };
    mockStore.setMock(browser as unknown as WebdriverIO.Browser, existing as unknown as ElectronFunctionMock);
    browser.execute.mockResolvedValue(false);

    const api = (browser.electron as { mock: (c: string) => Promise<unknown> }).mock;
    await Promise.all([api('appInfo:get'), api('appInfo:get'), api('appInfo:get'), api('appInfo:get')]);

    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(replayBrowserImpl).toHaveBeenCalledTimes(1);
  });

  it('should not emit unhandled rejections when in-flight work completes after browser drop', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);

    try {
      const fake = createFakeMock('electron.appInfo:get');
      const held = defer<void>();
      fake.update.mockImplementationOnce(() => held.promise);
      mockStore.setMock(browser as unknown as WebdriverIO.Browser, fake.mock);

      const click = browser.triggerCommand('click');

      mockStore.clear();
      await flushMicrotasks();

      held.resolve();
      await click;
      await flushMicrotasks();

      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });
});

describe('browser mode — multiremote mocks', () => {
  const DEV_SERVER = 'http://localhost:5173';
  const interceptor = createIpcInterceptor('electron');
  const inApp = (script: string) => `return (${script})()`;
  let root: FakeMultiremoteBrowser;
  let instances: Map<string, FakeBrowser>;

  async function setUp(
    serviceOptions: ElectronServiceGlobalOptions = {},
    instanceOptions: Record<'browserA' | 'browserB', ElectronServiceGlobalOptions> = { browserA: {}, browserB: {} },
  ): Promise<ElectronWorkerService> {
    ({ root, instances } = createFakeMultiremoteBrowser({
      browserA: { 'wdio:electronServiceOptions': instanceOptions.browserA },
      browserB: { 'wdio:electronServiceOptions': instanceOptions.browserB },
    }));
    const service = new ElectronWorkerService({ mode: 'browser', devServerUrl: DEV_SERVER, ...serviceOptions }, {
      browserA: { capabilities: {} },
      browserB: { capabilities: {} },
    } as never);
    await service.before({}, [], root as unknown as WebdriverIO.Browser);
    globalThis.browser = root as unknown as WebdriverIO.Browser;
    return service;
  }

  const instance = (name: string) => instances.get(name) as FakeBrowser;
  const electronOf = (name: string) => instance(name).electron as unknown as ElectronServiceAPI;
  const clearExecuteCalls = () => {
    for (const fake of [root, ...instances.values()]) {
      fake.execute.mockClear();
    }
  };
  const resetScript = (channel: string) => inApp(interceptor.buildInnerInvocationScript(channel, 'mockReset'));

  beforeEach(() => mockStore.clear());
  afterEach(() => {
    mockStore.clear();
    delete (globalThis as { browser?: unknown }).browser;
  });

  it('should give each instance its own mock of a channel, registered in its own app', async () => {
    await setUp();

    const mockA = await electronOf('browserA').mock('get-user');
    const mockB = await electronOf('browserB').mock('get-user');

    expect(mockB).not.toBe(mockA);
    for (const name of ['browserA', 'browserB']) {
      expect(instance(name).execute).toHaveBeenCalledWith(inApp(interceptor.buildRegistrationScript('get-user')));
    }
    expect(root.execute).not.toHaveBeenCalledWith(inApp(interceptor.buildRegistrationScript('get-user')));
    expect(await electronOf('browserA').mock('get-user')).toBe(mockA);
  });

  it("should leave the other instance's mocks alone when one instance restores", async () => {
    await setUp();
    await electronOf('browserA').mock('get-user');
    await electronOf('browserB').mock('get-user');
    clearExecuteCalls();

    await electronOf('browserA').restoreAllMocks();

    expect(instance('browserA').execute).toHaveBeenCalledWith(resetScript('get-user'));
    expect(instance('browserB').execute).not.toHaveBeenCalled();
  });

  it("should restore every instance's mocks from the root", async () => {
    await setUp();
    await electronOf('browserA').mock('get-user');
    await electronOf('browserB').mock('get-user');
    clearExecuteCalls();

    await (root.electron as unknown as ElectronServiceAPI).restoreAllMocks();

    for (const name of ['browserA', 'browserB']) {
      expect(instance(name).execute).toHaveBeenCalledWith(resetScript('get-user'));
    }
  });

  it('should restore before each test only the instances whose capabilities set restoreMocks', async () => {
    const service = await setUp({}, { browserA: { restoreMocks: true }, browserB: {} });
    await electronOf('browserA').mock('get-user');
    await electronOf('browserB').mock('get-user');
    clearExecuteCalls();

    await expect(service.beforeTest()).resolves.toBeUndefined();

    expect(instance('browserA').execute).toHaveBeenCalledWith(resetScript('get-user'));
    expect(instance('browserB').execute).not.toHaveBeenCalled();
  });

  it('should restore every instance before each test when the service sets restoreMocks', async () => {
    const service = await setUp({ restoreMocks: true });
    await electronOf('browserA').mock('get-user');
    await electronOf('browserB').mock('get-user');
    clearExecuteCalls();

    await expect(service.beforeTest()).resolves.toBeUndefined();

    for (const name of ['browserA', 'browserB']) {
      expect(instance(name).execute).toHaveBeenCalledWith(resetScript('get-user'));
    }
  });

  it("should sync only the instance's own mocks after it emits an event", async () => {
    await setUp();
    const fakeA = createFakeMock('electron.get-user');
    const fakeB = createFakeMock('electron.get-user');
    mockStore.setMock(instance('browserA') as unknown as WebdriverIO.Browser, fakeA.mock);
    mockStore.setMock(instance('browserB') as unknown as WebdriverIO.Browser, fakeB.mock);

    await electronOf('browserA').emitEvent('ping');

    expect(fakeA.update).toHaveBeenCalledOnce();
    expect(fakeB.update).not.toHaveBeenCalled();
  });
});
