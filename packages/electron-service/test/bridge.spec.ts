import os from 'node:os';
import { CdpBridge } from '@wdio/native-cdp-bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElectronCdpBridge, getDebuggerEndpoint } from '../src/bridge.js';

vi.mock('@wdio/native-utils', () => import('./mocks/native-utils.js'));

describe('getDebuggerEndpoint', () => {
  it('should return the endpoint information of the node debugger', () => {
    const host = 'localhost';
    const port = 50000;
    const result = getDebuggerEndpoint({
      'goog:chromeOptions': {
        args: ['foo=bar', `--inspect=${host}:${port}`],
      },
    });
    expect(result).toStrictEqual({
      host,
      port,
    });
  });

  it('should throw the error when `--inspect` is not set', () => {
    expect(() =>
      getDebuggerEndpoint({
        'goog:chromeOptions': {
          args: ['foo=bar'],
        },
      }),
    ).toThrowError(/--inspect/);
  });

  it('should throw the error when invalid host is set', () => {
    const host = '';
    const port = 'xxx';
    expect(() =>
      getDebuggerEndpoint({
        'goog:chromeOptions': {
          args: ['foo=bar', `--inspect=${host}:${port}`],
        },
      }),
    ).toThrowError(/host|port|invalid/i);
  });

  it('should throw the error when invalid port number is set', () => {
    const host = 'localhost';
    const port = 'xxx';
    expect(() =>
      getDebuggerEndpoint({
        'goog:chromeOptions': {
          args: ['foo=bar', `--inspect=${host}:${port}`],
        },
      }),
    ).toThrowError(/port|invalid|NaN/i);
  });
});

describe('ElectronCdpBridge', () => {
  // ElectronCdpBridge composes a CdpBridge and delegates connect/send/on/off to it. Mock the held
  // bridge's prototype so those delegated calls are captured; spread `...actual` so REQUEST_TIMEOUT
  // (read by the wrapper's constructor) and the other exports survive the mock.
  vi.mock('@wdio/native-cdp-bridge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@wdio/native-cdp-bridge')>();
    actual.CdpBridge.prototype.connect = vi.fn();
    actual.CdpBridge.prototype.send = vi.fn();
    actual.CdpBridge.prototype.on = vi.fn();
    actual.CdpBridge.prototype.off = vi.fn();
    return { ...actual };
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe('connect', () => {
    const expectedContextId = 999;
    // Returns the wrapper (for `contextId`) plus the held CdpBridge instance (for the mocked
    // connect/send/on/off assertions). The single `await` lets connect() advance past
    // `await bridge.connect()` so the executionContextCreated listener is registered before we read it.
    const getMockedBridge = async () => {
      const cdpBridge = new ElectronCdpBridge();

      const promise = cdpBridge.connect();
      const bridge = (await vi.mocked(CdpBridge.prototype.connect).mock.instances.slice(-1)[0]) as unknown as CdpBridge;

      const [_method, callback] = vi.mocked(bridge.on).mock.calls.slice(-1)[0];
      callback({
        context: {
          id: expectedContextId,
          auxData: {
            isDefault: true,
          },
        },
      } as any);
      await promise;
      return { cdpBridge, bridge };
    };

    it('should throw error when getting contextId with timeout', async () => {
      const cdpBridge = new ElectronCdpBridge({ timeout: 10 });
      await expect(() => cdpBridge.connect()).rejects.toThrowError(/Timeout exceeded to get the ContextId/);
    });

    it('should register the executionContextCreated listener with expected arguments', async () => {
      const { bridge } = await getMockedBridge();
      const [method, _callback] = vi.mocked(bridge.on).mock.calls.slice(-1)[0];
      expect(bridge.on).toHaveBeenCalledTimes(1);
      expect(method).toBe('Runtime.executionContextCreated');
    });

    it('should set contextId', async () => {
      const { cdpBridge, bridge } = await getMockedBridge();
      expect(bridge.on).toHaveBeenCalledTimes(1);
      expect(cdpBridge.contextId).toBe(expectedContextId);
    });

    it('should send the initialization script with expected args on windows', async () => {
      vi.spyOn(os, 'type').mockReturnValue('Windows');
      const { bridge } = await getMockedBridge();
      const expectedArgsOfEval = {
        contextId: expectedContextId,
        expression: [
          'globalThis.__name = globalThis.__name ?? ((func) => func);',
          "globalThis.electron = require('electron');",
          "globalThis.process = require('node:process');",
        ].join('\n'),
        includeCommandLineAPI: true,
        replMode: true,
      };

      expect(bridge.send).toHaveBeenCalledTimes(3);
      expect(bridge.send).toHaveBeenNthCalledWith(1, 'Runtime.enable');
      expect(bridge.send).toHaveBeenNthCalledWith(2, 'Runtime.disable');
      expect(bridge.send).toHaveBeenNthCalledWith(3, 'Runtime.evaluate', expectedArgsOfEval);
    });

    it('should send the initialization script with expected args on not windows', async () => {
      vi.spyOn(os, 'type').mockReturnValue('Linux');
      const { bridge } = await getMockedBridge();
      const expectedArgsOfEval = {
        contextId: expectedContextId,
        expression: [
          'globalThis.__name = globalThis.__name ?? ((func) => func);',
          "globalThis.electron = require('electron');",
        ].join('\n'),
        includeCommandLineAPI: true,
        replMode: true,
      };

      expect(bridge.send).toHaveBeenCalledTimes(3);
      expect(bridge.send).toHaveBeenNthCalledWith(1, 'Runtime.enable');
      expect(bridge.send).toHaveBeenNthCalledWith(2, 'Runtime.disable');
      expect(bridge.send).toHaveBeenNthCalledWith(3, 'Runtime.evaluate', expectedArgsOfEval);
    });

    it('should remove event listener after resolving with default context', async () => {
      const { bridge } = await getMockedBridge();
      expect(bridge.off).toHaveBeenCalledTimes(1);
      expect(bridge.off).toHaveBeenCalledWith('Runtime.executionContextCreated', expect.any(Function));
    });

    it('should remove event listener on timeout with fallback context', async () => {
      const cdpBridge = new ElectronCdpBridge({ timeout: 10 });
      const promise = cdpBridge.connect();
      const bridge = (await vi.mocked(CdpBridge.prototype.connect).mock.instances.slice(-1)[0]) as unknown as CdpBridge;

      const [_method, callback] = vi.mocked(bridge.on).mock.calls.slice(-1)[0];
      callback({
        context: {
          id: 123,
          auxData: { isDefault: false },
        },
      } as any);

      await promise;
      expect(bridge.off).toHaveBeenCalledWith('Runtime.executionContextCreated', expect.any(Function));
    });
  });
});
