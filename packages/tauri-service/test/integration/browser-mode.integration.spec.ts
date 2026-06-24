import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mockStore from '../../src/mockStore.js';
import TauriWorkerService from '../../src/service.js';
import {
  createFakeBrowser,
  createFakeMock,
  defer,
  type FakeBrowser,
  type FakeMock,
  flushMicrotasks,
} from './helpers.js';

// Keep `installMockSyncOverride` / `hasSemicolonOutsideQuotes` real (they drive the
// click override + scheduler under test); only silence the logger.
vi.mock('@wdio/native-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-utils')>()),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  })),
}));

const DEV_SERVER = 'http://localhost:1420';

// The Tauri browser-mode IPC injection script is the only one that installs the
// __TAURI_INTERNALS__ shim plus the event bus — registration scripts touch
// __wdio_mocks__/__wdio_spy__ but never these markers.
function isInjectionScript(arg: unknown): boolean {
  return typeof arg === 'string' && arg.includes('__TAURI_INTERNALS__') && arg.includes('__wdio_emit_tauri_event__');
}

// Tauri keys mocks globally (`tauri.<command>`), not per-browser like Electron, so
// there's no store key to thread through — the scheduler reads the whole store.
function seedMock(channel: string): FakeMock {
  const fake = createFakeMock(`tauri.${channel}`);
  mockStore.setMock(fake.mock);
  return fake;
}

describe('browser mode — MockUpdateScheduler', () => {
  let service: TauriWorkerService;
  let browser: FakeBrowser;

  beforeEach(async () => {
    mockStore.clear();
    service = new TauriWorkerService({ mode: 'browser', devServerUrl: DEV_SERVER }, {} as never);
    browser = createFakeBrowser();
    await service.before({} as never, [], browser as unknown as WebdriverIO.Browser);
  });

  afterEach(() => {
    mockStore.clear();
  });

  it('should trigger two update batches when two concurrent clicks fire', async () => {
    const fake = seedMock('greet');

    const c1 = browser.triggerCommand('click');
    const c2 = browser.triggerCommand('click');
    await Promise.all([c1, c2]);

    expect(fake.update).toHaveBeenCalledTimes(2);
  });

  it('should coalesce three rapid clicks into exactly two batches', async () => {
    const fake = seedMock('greet');

    const c1 = browser.triggerCommand('click');
    const c2 = browser.triggerCommand('click');
    const c3 = browser.triggerCommand('click');
    await Promise.all([c1, c2, c3]);

    expect(fake.update).toHaveBeenCalledTimes(2);
  });

  it('should be a no-op when the mock store is empty', async () => {
    await expect(browser.triggerCommand('click')).resolves.not.toThrow();
  });

  it('should not run a parallel batch when a click arrives between running and queued', async () => {
    const fake = seedMock('greet');

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
});

describe('browser mode — scheduler error handling', () => {
  let service: TauriWorkerService;
  let browser: FakeBrowser;

  beforeEach(async () => {
    mockStore.clear();
    service = new TauriWorkerService({ mode: 'browser', devServerUrl: DEV_SERVER }, {} as never);
    browser = createFakeBrowser();
    await service.before({} as never, [], browser as unknown as WebdriverIO.Browser);
  });

  afterEach(() => {
    mockStore.clear();
  });

  it('should retry a transient mock-update failure once and still settle the batch', async () => {
    const fake = seedMock('greet');
    // One rejection is recoverable: the scheduler retries update() once after 50ms.
    fake.update.mockRejectedValueOnce(new Error('transient'));

    await expect(browser.triggerCommand('click')).resolves.not.toThrow();

    // Initial attempt + one retry.
    expect(fake.update).toHaveBeenCalledTimes(2);
  });

  it('should surface a persistently failing batch and recover on the next click', async () => {
    const fake = seedMock('greet');
    // Both the initial attempt and its retry fail, so the batch rejects.
    fake.update.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new Error('boom-retry'));

    await expect(browser.triggerCommand('click')).rejects.toThrow();
    expect(fake.update).toHaveBeenCalledTimes(2);

    // A failed batch must not poison the scheduler — the next click recovers.
    await browser.triggerCommand('click');
    expect(fake.update).toHaveBeenCalledTimes(3);
  });
});

describe('browser mode — navigation lifecycle', () => {
  let service: TauriWorkerService;
  let browser: FakeBrowser;

  beforeEach(async () => {
    mockStore.clear();
    service = new TauriWorkerService({ mode: 'browser', devServerUrl: DEV_SERVER }, {} as never);
    browser = createFakeBrowser();
    await service.before({} as never, [], browser as unknown as WebdriverIO.Browser);
  });

  afterEach(() => {
    mockStore.clear();
  });

  it('should re-inject the IPC script after a navigation', async () => {
    browser.execute.mockClear();
    await browser.url(`${DEV_SERVER}/page2`);

    const injectionCalls = browser.execute.mock.calls.filter((c) => isInjectionScript(c[0]));
    expect(injectionCalls.length).toBeGreaterThan(0);
  });

  it('should not re-inject when the session is not flagged for browser mode', async () => {
    (browser as unknown as Record<string, boolean>).__wdioBrowserMode__ = false;
    browser.execute.mockClear();
    await browser.url(`${DEV_SERVER}/page2`);

    expect(browser.execute.mock.calls.filter((c) => isInjectionScript(c[0]))).toHaveLength(0);
  });

  it('should not re-inject when url() is called without an href', async () => {
    browser.execute.mockClear();
    await browser.url();

    expect(browser.execute.mock.calls.filter((c) => isInjectionScript(c[0]))).toHaveLength(0);
  });

  it('should rethrow when re-injection fails after a navigation', async () => {
    browser.execute.mockClear();
    browser.execute.mockRejectedValueOnce(new Error('inject failed'));

    await expect(browser.url(`${DEV_SERVER}/page2`)).rejects.toThrow('inject failed');
  });

  it('should keep mock updates working after a navigation cycle', async () => {
    const fake = seedMock('greet');

    await browser.triggerCommand('click');
    expect(fake.update).toHaveBeenCalledTimes(1);

    await browser.url(`${DEV_SERVER}/page2`);

    await browser.triggerCommand('click');
    expect(fake.update).toHaveBeenCalledTimes(2);
  });
});
