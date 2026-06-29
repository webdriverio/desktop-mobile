import type { DioxusMock } from '@wdio/native-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mockStore from '../../src/mockStore.js';
import DioxusWorkerService from '../../src/service.js';
import { createFakeBrowser, type FakeBrowser } from './helpers.js';

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

const DEV_SERVER = 'http://localhost:8080';

// The Dioxus browser-mode IPC injection script is the only one that installs the
// __WDIO_DIOXUS__ invoke shim. Registration scripts touch __wdio_mocks__ but never
// reference __WDIO_DIOXUS__, so this distinguishes the two.
function isInjectionScript(arg: unknown): boolean {
  return typeof arg === 'string' && arg.includes('__WDIO_DIOXUS__') && arg.includes('window.__wdio_spy__');
}

function isRegistrationScript(arg: unknown, command: string): boolean {
  return (
    typeof arg === 'string' &&
    arg.includes(`window.__wdio_mocks__[${JSON.stringify(command)}]`) &&
    !isInjectionScript(arg)
  );
}

describe('browser mode — initialisation', () => {
  let service: DioxusWorkerService;
  let browser: FakeBrowser;

  beforeEach(async () => {
    mockStore.clear();
    service = new DioxusWorkerService({}, { 'wdio:dioxusServiceOptions': { devServerUrl: DEV_SERVER } });
    browser = createFakeBrowser();
    // initBrowserMode calls browser.url(devServerUrl) before patchBrowserUrl
    // replaces browser.url — capture the spy before the patch.
    const urlSpy = browser.url;
    await service.before({}, [], browser as unknown as WebdriverIO.Browser);
    (browser as unknown as { __initialUrlSpy: typeof urlSpy }).__initialUrlSpy = urlSpy;
  });

  afterEach(() => {
    mockStore.clear();
  });

  it('should navigate to the dev server URL on startup', () => {
    const urlSpy = (browser as unknown as { __initialUrlSpy: ReturnType<typeof vi.fn> }).__initialUrlSpy;
    expect(urlSpy).toHaveBeenCalledWith(DEV_SERVER);
  });

  it('should inject the IPC interception script after the initial navigation', () => {
    expect(browser.execute.mock.calls.some((c) => isInjectionScript(c[0]))).toBe(true);
  });

  it('should install the browser.dioxus API surface', () => {
    const dioxus = (browser as unknown as { dioxus?: Record<string, unknown> }).dioxus;
    expect(dioxus).toBeDefined();
    expect(typeof dioxus?.mock).toBe('function');
    expect(typeof dioxus?.execute).toBe('function');
    expect(typeof dioxus?.restoreAllMocks).toBe('function');
  });

  it('should register a url override so navigation re-injects the IPC script', () => {
    expect(browser.overrides.has('url')).toBe(true);
  });
});

describe('browser mode — navigation lifecycle', () => {
  let service: DioxusWorkerService;
  let browser: FakeBrowser;

  beforeEach(async () => {
    mockStore.clear();
    service = new DioxusWorkerService({}, { 'wdio:dioxusServiceOptions': { devServerUrl: DEV_SERVER } });
    browser = createFakeBrowser();
    await service.before({}, [], browser as unknown as WebdriverIO.Browser);
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

  it('should not re-inject when url() is called without an href', async () => {
    browser.execute.mockClear();
    await browser.url();

    expect(browser.execute.mock.calls.filter((c) => isInjectionScript(c[0]))).toHaveLength(0);
  });

  it('should call through to the original url before re-injecting', async () => {
    const order: string[] = [];
    browser.execute.mockImplementation(async (arg: unknown) => {
      if (isInjectionScript(arg)) order.push('inject');
      return undefined;
    });
    // The override calls the original url() (recorded as 'navigate') first, then re-injects.
    const override = browser.overrides.get('url');
    expect(override).toBeDefined();
    const originalUrl = vi.fn(async () => {
      order.push('navigate');
    });
    await override?.call(browser, originalUrl, `${DEV_SERVER}/page3`);

    expect(order).toEqual(['navigate', 'inject']);
  });

  it('should not throw when re-injection fails after a navigation', async () => {
    browser.execute.mockClear();
    browser.execute.mockRejectedValueOnce(new Error('inject failed'));

    // Re-injection failures are swallowed (logged) so a transient page state
    // doesn't crash the worker mid-session — the navigation itself still resolves.
    await expect(browser.url(`${DEV_SERVER}/page2`)).resolves.not.toThrow();
  });
});

describe('browser mode — mock lifecycle', () => {
  let service: DioxusWorkerService;
  let browser: FakeBrowser;

  beforeEach(async () => {
    mockStore.clear();
    service = new DioxusWorkerService({}, { 'wdio:dioxusServiceOptions': { devServerUrl: DEV_SERVER } });
    browser = createFakeBrowser();
    await service.before({}, [], browser as unknown as WebdriverIO.Browser);
    browser.execute.mockClear();
  });

  afterEach(() => {
    mockStore.clear();
  });

  function dioxusApi(): { mock: (c: string) => Promise<DioxusMock> } {
    return (browser as unknown as { dioxus: { mock: (c: string) => Promise<DioxusMock> } }).dioxus;
  }

  it('should register the inner mock in the single shared context', async () => {
    await dioxusApi().mock('read_file');

    const registrationCalls = browser.execute.mock.calls.filter((c) => isRegistrationScript(c[0], 'read_file'));
    expect(registrationCalls).toHaveLength(1);
  });

  it('should track the created mock in the shared store', async () => {
    const mock = await dioxusApi().mock('read_file');

    // Dioxus keys mocks globally (`dioxus.<command>`) in one shared store —
    // there is no per-browser keying like Electron.
    expect(mockStore.getMock('dioxus.read_file')).toBe(mock);
  });

  it('should sync call data from the inner mock on update()', async () => {
    const mock = await dioxusApi().mock('read_file');

    // The embedded driver wraps results in a { __wdio_value__ } envelope; the
    // worker unwraps it before parsing the inner mock's call data.
    browser.execute.mockResolvedValueOnce({
      __wdio_value__: {
        calls: [[{ path: '/some/file' }]],
        results: [{ type: 'return', value: 'content' }],
        invocationCallOrder: [1],
      },
    });
    await mock.update();

    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]).toEqual([{ path: '/some/file' }]);
  });

  it('should drop the inner mock entry and the store entry on mockRestore()', async () => {
    const mock = await dioxusApi().mock('read_file');
    expect(() => mockStore.getMock('dioxus.read_file')).not.toThrow();

    await mock.mockRestore();

    const unregistration = browser.execute.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('delete window.__wdio_mocks__["read_file"]'),
    );
    expect(unregistration).toBeDefined();
    expect(() => mockStore.getMock('dioxus.read_file')).toThrow();
  });

  it('should recover a mock after navigation via mockRestore() then mock()', async () => {
    const mock = await dioxusApi().mock('read_file');

    // A navigation wipes window.__wdio_mocks__; the browser-side entry is gone
    // even though the JS handle is still valid. Restore drops the store entry,
    // then mock() re-creates both sides.
    await browser.url(`${DEV_SERVER}/page2`);
    await mock.mockRestore();

    browser.execute.mockClear();
    const recovered = await dioxusApi().mock('read_file');

    expect(browser.execute.mock.calls.filter((c) => isRegistrationScript(c[0], 'read_file'))).toHaveLength(1);
    expect(mockStore.getMock('dioxus.read_file')).toBe(recovered);
  });
});
