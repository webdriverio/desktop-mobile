import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn().mockResolvedValue(undefined);
const sendMock = vi.fn();
const switchTargetMock = vi.fn().mockResolvedValue(undefined);
const listWindowsMock = vi.fn().mockReturnValue(['main', 'second']);
const closeMock = vi.fn().mockResolvedValue(undefined);
const cdpBridgeCtor = vi.fn();

vi.mock('@wdio/electrobun-cdp-bridge', () => ({
  CdpBridge: class {
    constructor(opts: unknown) {
      cdpBridgeCtor(opts);
    }
    connect = connectMock;
    send = sendMock;
    switchTarget = switchTargetMock;
    listWindows = listWindowsMock;
    close = closeMock;
  },
}));

import type { ElectrobunServiceAPI } from '@wdio/native-types';
import ElectrobunWorkerService from '../src/service.js';

type Installed = { electrobun: ElectrobunServiceAPI };

function nativeCap(port = 9333): Record<string, unknown> {
  return { 'goog:chromeOptions': { debuggerAddress: `localhost:${port}` } };
}

function makeBrowser(): WebdriverIO.Browser {
  return { isMultiremote: false, sessionId: 'abc' } as unknown as WebdriverIO.Browser;
}

describe('ElectrobunWorkerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectMock.mockResolvedValue(undefined);
    sendMock.mockResolvedValue({ result: { value: undefined } });
    listWindowsMock.mockReturnValue(['main', 'second']);
    closeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('before() — native mode', () => {
    it('should attach the CDP bridge using the capability debuggerAddress', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});

      await service.before(nativeCap(9350), [], browser);

      expect(cdpBridgeCtor).toHaveBeenCalledTimes(1);
      expect(cdpBridgeCtor.mock.calls[0][0]).toMatchObject({ host: 'localhost', port: 9350 });
      expect(connectMock).toHaveBeenCalledTimes(1);
    });

    it('should install browser.electrobun with the full API surface', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});

      await service.before(nativeCap(), [], browser);

      const { electrobun } = browser as unknown as Installed;
      expect(electrobun).toBeDefined();
      for (const name of [
        'execute',
        'switchWindow',
        'listWindows',
        'mock',
        'isMockFunction',
        'clearAllMocks',
        'resetAllMocks',
        'restoreAllMocks',
        'triggerDeeplink',
      ]) {
        expect(typeof (electrobun as unknown as Record<string, unknown>)[name]).toBe('function');
      }
    });

    it('should not attach a bridge when no debuggerAddress is present', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});

      await service.before({}, [], browser);

      expect(cdpBridgeCtor).not.toHaveBeenCalled();
      expect((browser as unknown as Partial<Installed>).electrobun).toBeUndefined();
    });
  });

  describe('before() — browser mode', () => {
    it('should skip CDP attach when devServerUrl is set', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({ devServerUrl: 'http://localhost:3000' }, {});

      await service.before(nativeCap(), [], browser);

      expect(cdpBridgeCtor).not.toHaveBeenCalled();
      expect((browser as unknown as Partial<Installed>).electrobun).toBeUndefined();
    });

    it('should read devServerUrl from capability-level options', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService(
        {},
        { 'wdio:electrobunServiceOptions': { devServerUrl: 'http://localhost:4000' } },
      );

      await service.before(nativeCap(), [], browser);

      expect(cdpBridgeCtor).not.toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    it('should evaluate a function in the active target via Runtime.evaluate and return its value', async () => {
      sendMock.mockResolvedValueOnce({ result: { value: 42 } });
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);

      const result = await (browser as unknown as Installed).electrobun.execute(() => 42);

      expect(result).toBe(42);
      const [method, params] = sendMock.mock.calls[0];
      expect(method).toBe('Runtime.evaluate');
      expect(params).toMatchObject({ returnByValue: true, awaitPromise: true });
      expect(params.expression).toContain('__WDIO_ELECTROBUN__');
    });

    it('should wrap a raw string expression so its value is returned', async () => {
      sendMock.mockResolvedValueOnce({ result: { value: 'ok' } });
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);

      const result = await (browser as unknown as Installed).electrobun.execute('1 + 1');

      expect(result).toBe('ok');
      expect(sendMock.mock.calls[0][1].expression).toBe('(async function () { return (1 + 1); })()');
    });

    it('should throw when Runtime.evaluate reports exceptionDetails', async () => {
      sendMock.mockResolvedValueOnce({ exceptionDetails: { exception: { description: 'boom' } } });
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);

      await expect((browser as unknown as Installed).electrobun.execute(() => 1)).rejects.toThrow(/boom/);
    });
  });

  describe('switchWindow / listWindows', () => {
    it('should delegate switchWindow to bridge.switchTarget', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);

      await (browser as unknown as Installed).electrobun.switchWindow('second');

      expect(switchTargetMock).toHaveBeenCalledWith('second');
    });

    it('should delegate listWindows to bridge.listWindows', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);

      const windows = await (browser as unknown as Installed).electrobun.listWindows();

      expect(windows).toEqual(['main', 'second']);
    });
  });

  describe('mock surface (wired over the bridge)', () => {
    // Detailed inner-recorder semantics live in test/mock.spec.ts / allMocks.spec.ts;
    // here we assert installApi wires the family onto the bridge-backed store.
    it('should install a recorder via Runtime.evaluate and return an electrobun mock', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);
      const { electrobun } = browser as unknown as Installed;

      const mock = await electrobun.mock('api.fetchData');

      expect((mock as unknown as { __isElectrobunMock: boolean }).__isElectrobunMock).toBe(true);
      expect(mock.getMockName()).toBe('electrobun.api.fetchData');
      const [method, params] = sendMock.mock.calls[0];
      expect(method).toBe('Runtime.evaluate');
      expect(params.expression).toContain('__WDIO_ELECTROBUN_MOCKS__');
      expect(params.expression).toContain('api.fetchData');
    });

    it('should report mocks via isMockFunction and resolve clear/reset/restore-all', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);
      const { electrobun } = browser as unknown as Installed;

      const mock = await electrobun.mock('api.fetchData');
      expect(electrobun.isMockFunction(mock)).toBe(true);
      expect(electrobun.isMockFunction('api.fetchData')).toBe(true);
      expect(electrobun.isMockFunction(() => undefined)).toBe(false);

      await expect(electrobun.clearAllMocks()).resolves.toBeUndefined();
      await expect(electrobun.resetAllMocks()).resolves.toBeUndefined();
      await expect(electrobun.restoreAllMocks()).resolves.toBeUndefined();
    });

    it('should keep a separate mock store per multiremote instance', async () => {
      const instanceA = {} as WebdriverIO.Browser;
      const instanceB = {} as WebdriverIO.Browser;
      const mrBrowser = {
        isMultiremote: true,
        instances: ['browserA', 'browserB'],
        getInstance: (name: string) => (name === 'browserA' ? instanceA : instanceB),
      } as unknown as WebdriverIO.MultiRemoteBrowser;
      const caps = { browserA: { capabilities: nativeCap(9361) }, browserB: { capabilities: nativeCap(9362) } };

      const service = new ElectrobunWorkerService({}, {});
      await service.before(caps, [], mrBrowser);

      const electrobunA = (instanceA as unknown as Installed).electrobun;
      const electrobunB = (instanceB as unknown as Installed).electrobun;
      await electrobunA.mock('api.only');
      expect(electrobunA.isMockFunction('api.only')).toBe(true);
      expect(electrobunB.isMockFunction('api.only')).toBe(false);
    });
    // triggerDeeplink is now real (macOS) — covered in test/triggerDeeplink.spec.ts.
  });

  describe('teardown', () => {
    it('should close the bridge on after() and afterSession()', async () => {
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);

      await service.after();
      expect(closeMock).toHaveBeenCalledTimes(1);

      // after() emptied the bridge list, so afterSession() has nothing more to close.
      await service.afterSession();
      expect(closeMock).toHaveBeenCalledTimes(1);
    });

    it('should tolerate a bridge.close() rejection', async () => {
      closeMock.mockRejectedValueOnce(new Error('socket gone'));
      const browser = makeBrowser();
      const service = new ElectrobunWorkerService({}, {});
      await service.before(nativeCap(), [], browser);

      await expect(service.after()).resolves.toBeUndefined();
    });
  });

  describe('multiremote', () => {
    it('should attach a bridge per instance', async () => {
      const instanceA = {} as WebdriverIO.Browser;
      const instanceB = {} as WebdriverIO.Browser;
      const mrBrowser = {
        isMultiremote: true,
        instances: ['browserA', 'browserB'],
        getInstance: (name: string) => (name === 'browserA' ? instanceA : instanceB),
      } as unknown as WebdriverIO.MultiRemoteBrowser;

      const caps = {
        browserA: { capabilities: nativeCap(9341) },
        browserB: { capabilities: nativeCap(9342) },
      };

      const service = new ElectrobunWorkerService({}, {});
      await service.before(caps, [], mrBrowser);

      expect(cdpBridgeCtor).toHaveBeenCalledTimes(2);
      expect((instanceA as unknown as Partial<Installed>).electrobun).toBeDefined();
      expect((instanceB as unknown as Partial<Installed>).electrobun).toBeDefined();
    });
  });
});
