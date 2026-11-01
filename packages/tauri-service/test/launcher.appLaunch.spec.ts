import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('../src/embeddedProvider.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/embeddedProvider.js')>()),
  checkEmbeddedServerAlive: vi.fn(),
  startEmbeddedDriver: vi.fn(),
  stopEmbeddedDriver: vi.fn(),
}));

vi.mock('../src/diagnostics.js', () => ({
  diagnoseTauriEnvironment: vi.fn().mockResolvedValue([]),
}));

vi.mock('@wdio/native-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-utils')>()),
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  formatDiagnosticResults: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('../src/driverPool.js', () => ({
  DriverPool: class MockDriverPool {
    startDriver = vi.fn().mockResolvedValue({});
    stopDriver = vi.fn().mockResolvedValue(undefined);
    stopAll = vi.fn().mockResolvedValue(undefined);
    getStatus = vi.fn().mockReturnValue({ count: 0, running: false });
    getRunningPids = vi.fn().mockReturnValue([]);
  },
}));

vi.mock('@wdio/native-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-core')>()),
  PortManager: class MockPortManager {
    allocatePortPair = vi.fn().mockResolvedValue({ port: 4444, nativePort: 4445 });
    allocatePorts = vi
      .fn()
      .mockImplementation(async (count: number) =>
        Array.from({ length: count }, (_, i) => ({ port: 4444 + i * 2, nativePort: 4445 + i * 2 })),
      );
    allocatePort = vi.fn().mockImplementation(async (preferred?: number) => preferred ?? 3000);
    clear = vi.fn();
  },
}));

vi.mock('../src/pathResolver.js', () => ({
  getWebKitWebDriverPath: vi.fn().mockReturnValue('/usr/bin/WebKitWebDriver'),
}));

vi.mock('../src/driverManager.js', () => ({
  ensureTauriDriver: vi.fn().mockResolvedValue({ ok: true, value: { path: '/tauri-driver', method: 'found' } }),
  findTestRunnerBackend: vi.fn().mockReturnValue('/test-runner-backend'),
}));

vi.mock('../src/edgeDriverManager.js', () => ({
  ensureMsEdgeDriver: vi.fn().mockResolvedValue({ ok: true, value: { method: 'found', driverVersion: '120' } }),
}));

vi.mock('../src/crabnebulaBackend.js', () => ({
  startTestRunnerBackend: vi.fn().mockResolvedValue({ proc: { pid: 1 }, port: 3000 }),
  stopTestRunnerBackend: vi.fn().mockResolvedValue(undefined),
  waitTestRunnerBackendReady: vi.fn().mockResolvedValue(undefined),
}));

import { mockPlatform, restorePlatform } from '@repo/test-utils';
import { startTestRunnerBackend } from '../src/crabnebulaBackend.js';
import { ensureMsEdgeDriver } from '../src/edgeDriverManager.js';
import { checkEmbeddedServerAlive, startEmbeddedDriver } from '../src/embeddedProvider.js';
import TauriLaunchService from '../src/launcher.js';
import type { TauriCapabilities, TauriServiceGlobalOptions } from '../src/types.js';

const APP = '/app/my-app';

type DriverStart = { identifier: string; env?: NodeJS.ProcessEnv };

function createLauncher(options: TauriServiceGlobalOptions & { appArgs?: string[] }, maxInstances = 1) {
  return new TauriLaunchService(options, {}, { capabilities: [], maxInstances });
}

function driverStarts(launcher: TauriLaunchService): DriverStart[] {
  const { startDriver } = (launcher as unknown as { driverPool: { startDriver: Mock } }).driverPool;
  return startDriver.mock.calls.map(([config]) => config as DriverStart);
}

function appCap(serviceOptions: TauriCapabilities['wdio:tauriServiceOptions'] = {}, args?: string[]) {
  return {
    'tauri:options': { application: APP, ...(args && { args }) },
    'wdio:tauriServiceOptions': serviceOptions,
  } satisfies TauriCapabilities;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(startEmbeddedDriver).mockResolvedValue({ proc: { pid: 42 } as never, logHandlers: [] });
  mockPlatform('linux');
});

afterEach(() => {
  restorePlatform();
  vi.unstubAllEnvs();
});

describe('app args', () => {
  it("should write each capability's appArgs into tauri:options.args, where tauri-driver reads them", async () => {
    const caps = [appCap({ appArgs: ['--cap'] }), appCap()];
    const launcher = createLauncher({ driverProvider: 'external', appArgs: ['--service'] }, 2);

    await launcher.onPrepare({ capabilities: [], maxInstances: 2 }, caps);

    expect(caps.map((cap) => cap['tauri:options'].args)).toEqual([['--cap'], ['--service']]);
  });

  it('should keep tauri:options.args over appArgs, even when it is empty', async () => {
    const caps = [appCap({ appArgs: ['--cap'] }, ['--from-options']), appCap({ appArgs: ['--cap'] }, [])];
    const launcher = createLauncher({ driverProvider: 'external' });

    await launcher.onPrepare({ capabilities: [], maxInstances: 1 }, caps);

    expect(caps.map((cap) => cap['tauri:options'].args)).toEqual([['--from-options'], []]);
  });

  it('should launch each embedded app with its resolved args', async () => {
    const caps = [appCap({ appArgs: ['--cap'] }, ['--from-options']), appCap()];
    const launcher = createLauncher({ appArgs: ['--service'] });

    await launcher.onPrepare({ capabilities: [], maxInstances: 1 }, caps);

    expect(vi.mocked(startEmbeddedDriver).mock.calls.map(([, args]) => args)).toEqual([
      ['--from-options'],
      ['--service'],
    ]);
  });

  it('should launch each embedded multiremote instance with its resolved args, and restart it with them', async () => {
    const capabilities = {
      a: { capabilities: appCap({}, ['--a']) },
      b: { capabilities: appCap({ appArgs: ['--b'] }) },
    };
    const launcher = createLauncher({});
    await launcher.onPrepare({ capabilities: [], maxInstances: 1 }, capabilities);
    vi.mocked(checkEmbeddedServerAlive).mockImplementation(async (port) => port !== 4445);

    await (launcher as unknown as { ensureEmbeddedServersHealthy(): Promise<void> }).ensureEmbeddedServersHealthy();

    expect(vi.mocked(startEmbeddedDriver).mock.calls.map(([, args, , , id]) => [id, args])).toEqual([
      ['a', ['--a']],
      ['b', ['--b']],
      ['a', ['--a']],
    ]);
  });
});

describe('app env', () => {
  it("should give a worker's driver the service-level env over process.env, with the data directory winning", async () => {
    vi.stubEnv('WDIO_936_KEPT', 'process');
    vi.stubEnv('WDIO_936_FLAG', 'process');
    const cap = appCap();
    const launcher = createLauncher(
      { driverProvider: 'external', env: { WDIO_936_FLAG: 'service', XDG_DATA_HOME: '/user/data' } },
      2,
    );
    await launcher.onPrepare({ capabilities: [], maxInstances: 2 }, [cap]);

    await launcher.onWorkerStart('0-0', cap);

    const [{ env }] = driverStarts(launcher);
    expect(env).toMatchObject({ WDIO_936_KEPT: 'process', WDIO_936_FLAG: 'service' });
    expect(env?.XDG_DATA_HOME).toMatch(/tauri-worker-0-0-/);
  });

  it("should give a worker's driver the capability's env in place of the service-level one", async () => {
    const cap = appCap({ env: { WDIO_936_CAP: 'cap' } });
    const launcher = createLauncher({ driverProvider: 'external', env: { WDIO_936_SERVICE: 'service' } }, 2);
    await launcher.onPrepare({ capabilities: [], maxInstances: 2 }, [cap]);

    await launcher.onWorkerStart('0-0', cap);

    const [{ env }] = driverStarts(launcher);
    expect(env).toMatchObject({ WDIO_936_CAP: 'cap' });
    expect(env).not.toHaveProperty('WDIO_936_SERVICE');
  });

  it.each(['external', 'crabnebula'] as const)(
    "should give each multiremote %s driver its own instance's env",
    async (driverProvider) => {
      const capabilities = {
        a: { capabilities: appCap({ env: { WDIO_936_INSTANCE: 'a' } }) },
        b: { capabilities: appCap({ env: { WDIO_936_INSTANCE: 'b' } }) },
      };
      const launcher = createLauncher({ driverProvider });

      await launcher.onPrepare({ capabilities: [], maxInstances: 1 }, capabilities);

      expect(driverStarts(launcher).map(({ identifier, env }) => [identifier, env?.WDIO_936_INSTANCE])).toEqual([
        ['a', 'a'],
        ['b', 'b'],
      ]);
    },
  );

  describe('CrabNebula on macOS', () => {
    beforeEach(() => {
      mockPlatform('darwin');
      vi.stubEnv('CN_API_KEY', 'test-key');
      vi.stubEnv('REMOTE_WEBDRIVER_URL', undefined);
    });

    it('should keep the env when it restarts the shared driver between workers', async () => {
      const cap = appCap();
      const launcher = createLauncher({ driverProvider: 'crabnebula', env: { WDIO_936_FLAG: 'service' } });
      await launcher.onPrepare({ capabilities: [], maxInstances: 1 }, [cap]);

      await launcher.onWorkerEnd('0-0');

      const starts = driverStarts(launcher);
      expect(starts).toHaveLength(2);
      expect(starts.at(-1)?.env).toMatchObject({ WDIO_936_FLAG: 'service' });
      expect(vi.mocked(startTestRunnerBackend).mock.calls.at(-1)?.[0].serviceOptions?.env).toEqual({
        WDIO_936_FLAG: 'service',
      });
    });

    it("should give each multiremote instance's driver its env and backend URL, before and after a restart", async () => {
      const capabilities = {
        a: { capabilities: appCap({ env: { WDIO_936_INSTANCE: 'a' } }) },
        b: { capabilities: appCap({ env: { WDIO_936_INSTANCE: 'b' } }) },
      };
      const launcher = createLauncher({ driverProvider: 'crabnebula' });
      await launcher.onPrepare({ capabilities: [], maxInstances: 1 }, capabilities);

      await launcher.onWorkerEnd('0-0');

      expect(
        driverStarts(launcher).map(({ identifier, env }) => [
          identifier,
          env?.WDIO_936_INSTANCE,
          env?.REMOTE_WEBDRIVER_URL,
        ]),
      ).toEqual([
        ['a', 'a', 'http://127.0.0.1:3000'],
        ['b', 'b', 'http://127.0.0.1:3002'],
        ['a', 'a', 'http://127.0.0.1:3000'],
        ['b', 'b', 'http://127.0.0.1:3002'],
      ]);
    });
  });

  it("should match msedgedriver to the first capability's env, which the app gets", async () => {
    mockPlatform('win32');
    const cap = appCap({ env: { WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: 'C:\\fixed' } });
    const launcher = createLauncher({ driverProvider: 'external', edgeDriverVersion: '149.0.4022.98' });

    await launcher.onPrepare({ capabilities: [], maxInstances: 1 }, [cap]);

    expect(ensureMsEdgeDriver).toHaveBeenCalledWith(APP, true, {
      edgeDriverVersion: '149.0.4022.98',
      env: { WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: 'C:\\fixed' },
    });
  });
});
