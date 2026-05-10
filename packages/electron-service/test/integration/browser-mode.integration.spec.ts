import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mockStore from '../../src/mockStore.js';
import ElectronWorkerService, { browserModeStoreKey } from '../../src/service.js';
import {
  createFakeBrowser,
  createFakeMock,
  defer,
  type FakeBrowser,
  type FakeMock,
  flushMicrotasks,
} from './helpers.js';

vi.mock('@wdio/native-utils', () => ({
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
    const key = browserModeStoreKey(browser as unknown as WebdriverIO.Browser, channel);
    mockStore.setMockWithKey(key, fake.mock);
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
    fake.update.mockRejectedValueOnce(new Error('boom'));

    await browser.triggerCommand('click');
    expect(fake.update).toHaveBeenCalledTimes(1);

    await browser.triggerCommand('click');
    expect(fake.update).toHaveBeenCalledTimes(2);
  });

  it('should run two browser instances independently without cross-blocking', async () => {
    const browserB = createFakeBrowser();
    const serviceB = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5174' }, {});
    await serviceB.before({}, [], browserB as unknown as WebdriverIO.Browser);

    const keyA = browserModeStoreKey(browser as unknown as WebdriverIO.Browser, 'a');
    const keyB = browserModeStoreKey(browserB as unknown as WebdriverIO.Browser, 'b');
    const fakeA = createFakeMock('electron.a');
    const fakeB = createFakeMock('electron.b');
    mockStore.setMockWithKey(keyA, fakeA.mock);
    mockStore.setMockWithKey(keyB, fakeB.mock);

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
});
