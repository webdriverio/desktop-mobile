import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

const mockLog = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }));

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
  createLogger: () => mockLog,
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
    useNativeDriver = vi.fn();
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
import { SevereServiceError } from 'webdriverio';
import { startTestRunnerBackend } from '../src/crabnebulaBackend.js';
import { ensureTauriDriver } from '../src/driverManager.js';
import { ensureMsEdgeDriver } from '../src/edgeDriverManager.js';
import { checkEmbeddedServerAlive, startEmbeddedDriver } from '../src/embeddedProvider.js';
import TauriLaunchService from '../src/launcher.js';
import type { TauriCapabilities, TauriServiceGlobalOptions } from '../src/types.js';

const APP = '/app/my-app';

type DriverStart = { identifier: string; options?: { env?: NodeJS.ProcessEnv }; env?: NodeJS.ProcessEnv };

function createLauncher(options: TauriServiceGlobalOptions, maxInstances = 1) {
  return new TauriLaunchService(options, {}, { maxInstances });
}

function driverPool(launcher: TauriLaunchService) {
  return (launcher as unknown as { driverPool: { startDriver: Mock; useNativeDriver: Mock } }).driverPool;
}

function driverStarts(launcher: TauriLaunchService): DriverStart[] {
  return driverPool(launcher).startDriver.mock.calls.map(([config]) => config as DriverStart);
}

// What DriverPool gives the driver over process.env: the app's env from its options, under the launcher's own
function driverEnv({ options, env }: DriverStart): NodeJS.ProcessEnv {
  return { ...options?.env, ...env };
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

    await launcher.onPrepare({ maxInstances: 2 }, caps);

    expect(caps.map((cap) => cap['tauri:options'].args)).toEqual([['--cap'], ['--service']]);
  });

  it('should keep tauri:options.args over appArgs, even when it is empty', async () => {
    const caps = [appCap({ appArgs: ['--cap'] }, ['--from-options']), appCap({ appArgs: ['--cap'] }, [])];
    const launcher = createLauncher({ driverProvider: 'external' });

    await launcher.onPrepare({ maxInstances: 1 }, caps);

    expect(caps.map((cap) => cap['tauri:options'].args)).toEqual([['--from-options'], []]);
  });

  it("should give each capability its own tauri:options, so a shared one doesn't pass its args on", async () => {
    const shared = { application: APP };
    const capA: TauriCapabilities = { 'tauri:options': shared, 'wdio:tauriServiceOptions': { appArgs: ['--a'] } };
    const capB: TauriCapabilities = { 'tauri:options': shared, 'wdio:tauriServiceOptions': { appArgs: ['--b'] } };
    const launcher = createLauncher({ driverProvider: 'external' });

    await launcher.onPrepare({ maxInstances: 1 }, { a: { capabilities: capA }, b: { capabilities: capB } });

    expect([capA, capB].map((cap) => cap['tauri:options']?.args)).toEqual([['--a'], ['--b']]);
    expect(shared).toEqual({ application: APP });
  });

  it('should stop the run with a SevereServiceError when the driver it needs is missing, logging the original', async () => {
    const missing = new Error('tauri-driver not found');
    vi.mocked(ensureTauriDriver).mockResolvedValueOnce({ ok: false, error: missing });
    const launcher = createLauncher({ driverProvider: 'external' });

    const prepared = launcher.onPrepare({ maxInstances: 1 }, [appCap()]);

    await expect(prepared).rejects.toBeInstanceOf(SevereServiceError);
    await expect(prepared).rejects.toMatchObject({ message: 'tauri-driver not found' });
    expect(mockLog.error).toHaveBeenCalledWith('Tauri service failed to prepare', missing);
  });

  it("should keep env values out of the capabilities onWorkerStart logs when it can't find the app", async () => {
    const launcher = createLauncher({ driverProvider: 'external' });

    await launcher.onWorkerStart('0-0', { a: { capabilities: appCap({ env: { APP_TOKEN: 'secret-worker-value' } }) } });

    const logged = JSON.stringify(mockLog.debug.mock.calls);
    expect(logged).toContain('Capabilities structure');
    expect(logged).toContain('APP_TOKEN');
    expect(logged).not.toContain('secret-');
  });

  it("should keep env values out of its debug logs, showing only the variables' names", async () => {
    const launcher = createLauncher({ driverProvider: 'external', env: { CN_API_KEY: 'secret-service-value' } });

    await launcher.onPrepare({ maxInstances: 1 }, [appCap({ env: { APP_TOKEN: 'secret-capability-value' } })]);

    const logged = JSON.stringify(mockLog.debug.mock.calls);
    expect(logged).toContain('APP_TOKEN');
    expect(logged).not.toContain('secret-');
  });

  it('should stop the run with a SevereServiceError for args that are not an array of strings', async () => {
    const launcher = createLauncher({ driverProvider: 'external' });

    const prepared = launcher.onPrepare({ maxInstances: 1 }, [appCap({ appArgs: '--debug' as unknown as string[] })]);

    await expect(prepared).rejects.toBeInstanceOf(SevereServiceError);
    await expect(prepared).rejects.toMatchObject({ message: expect.stringContaining('must be arrays of strings') });
  });

  it('should launch each embedded app with its resolved args', async () => {
    const caps = [appCap({ appArgs: ['--cap'] }, ['--from-options']), appCap()];
    const launcher = createLauncher({ appArgs: ['--service'] });

    await launcher.onPrepare({ maxInstances: 1 }, caps);

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
    await launcher.onPrepare({ maxInstances: 1 }, capabilities);
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
  it("should give a worker's driver the service-level env, with the data directory winning", async () => {
    const cap = appCap();
    const launcher = createLauncher(
      { driverProvider: 'external', env: { WDIO_936_FLAG: 'service', XDG_DATA_HOME: '/user/data' } },
      2,
    );
    await launcher.onPrepare({ maxInstances: 2 }, [cap]);

    await launcher.onWorkerStart('0-0', cap);

    const env = driverEnv(driverStarts(launcher)[0]);
    expect(env).toMatchObject({ WDIO_936_FLAG: 'service' });
    expect(env.XDG_DATA_HOME).toMatch(/tauri-worker-0-0-/);
  });

  it("should give a worker's driver the capability's env in place of the service-level one", async () => {
    const cap = appCap({ env: { WDIO_936_CAP: 'cap' } });
    const launcher = createLauncher({ driverProvider: 'external', env: { WDIO_936_SERVICE: 'service' } }, 2);
    await launcher.onPrepare({ maxInstances: 2 }, [cap]);

    await launcher.onWorkerStart('0-0', cap);

    const env = driverEnv(driverStarts(launcher)[0]);
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

      await launcher.onPrepare({ maxInstances: 1 }, capabilities);

      expect(driverStarts(launcher).map((start) => [start.identifier, driverEnv(start).WDIO_936_INSTANCE])).toEqual([
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
      await launcher.onPrepare({ maxInstances: 1 }, [cap]);

      await launcher.onWorkerEnd('0-0');

      const starts = driverStarts(launcher);
      expect(starts).toHaveLength(2);
      expect(driverEnv(starts[1])).toMatchObject({ WDIO_936_FLAG: 'service' });
      expect(vi.mocked(startTestRunnerBackend).mock.calls.at(-1)?.[0].serviceOptions?.env).toEqual({
        WDIO_936_FLAG: 'service',
      });
    });

    it('should point the shared driver at the backend it started, over a REMOTE_WEBDRIVER_URL in env', async () => {
      const cap = appCap();
      const launcher = createLauncher({
        driverProvider: 'crabnebula',
        env: { REMOTE_WEBDRIVER_URL: 'http://user:9999' },
      });
      await launcher.onPrepare({ maxInstances: 1 }, [cap]);

      await launcher.onWorkerEnd('0-0');

      expect(driverStarts(launcher).map((start) => driverEnv(start).REMOTE_WEBDRIVER_URL)).toEqual([
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3000',
      ]);
      expect(process.env.REMOTE_WEBDRIVER_URL).toBeUndefined();
    });

    it("should leave the shared driver and the user's own backend alone between workers", async () => {
      const cap = appCap();
      const launcher = createLauncher({ driverProvider: 'crabnebula', crabnebulaManageBackend: false });
      await launcher.onPrepare({ maxInstances: 1 }, [cap]);

      await launcher.onWorkerEnd('0-0');

      expect(startTestRunnerBackend).not.toHaveBeenCalled();
      expect(driverStarts(launcher)).toHaveLength(1);
    });

    it('should accept a CN_API_KEY from env, which the backend gets', async () => {
      vi.stubEnv('CN_API_KEY', undefined);
      const launcher = createLauncher({ driverProvider: 'crabnebula', env: { CN_API_KEY: 'from-env' } });

      await expect(launcher.onPrepare({ maxInstances: 1 }, [appCap()])).resolves.toBeUndefined();
    });

    it("should give a worker's backend, which launches the app, the same data directory as its driver", async () => {
      const cap = appCap();
      const launcher = createLauncher({ driverProvider: 'crabnebula' }, 2);
      await launcher.onPrepare({ maxInstances: 2 }, [cap]);

      await launcher.onWorkerStart('0-0', cap);

      const backendDataDir = vi.mocked(startTestRunnerBackend).mock.calls.at(-1)?.[0].env?.TAURI_DATA_DIR;
      expect(backendDataDir).toMatch(/tauri-worker-0-0-/);
      expect(driverEnv(driverStarts(launcher)[0]).TAURI_DATA_DIR).toBe(backendDataDir);
    });

    it("should give each multiremote instance's backend its driver's data directory, and keep it across a restart", async () => {
      const capabilities = { a: { capabilities: appCap() }, b: { capabilities: appCap() } };
      const launcher = createLauncher({ driverProvider: 'crabnebula' });
      await launcher.onPrepare({ maxInstances: 1 }, capabilities);

      await launcher.onWorkerEnd('0-0');

      const backendDataDirs = vi
        .mocked(startTestRunnerBackend)
        .mock.calls.map(([options]) => options.env?.TAURI_DATA_DIR);
      expect(backendDataDirs).toEqual(driverStarts(launcher).map((start) => driverEnv(start).TAURI_DATA_DIR));
      expect(backendDataDirs).toEqual([
        expect.stringMatching(/tauri-multiremote-a-/),
        expect.stringMatching(/tauri-multiremote-b-/),
        backendDataDirs[0],
        backendDataDirs[1],
      ]);
    });

    it("should give each multiremote instance's driver its env and backend URL, before and after a restart", async () => {
      const capabilities = {
        a: { capabilities: appCap({ env: { WDIO_936_INSTANCE: 'a' } }) },
        b: { capabilities: appCap({ env: { WDIO_936_INSTANCE: 'b' } }) },
      };
      const launcher = createLauncher({ driverProvider: 'crabnebula' });
      await launcher.onPrepare({ maxInstances: 1 }, capabilities);

      await launcher.onWorkerEnd('0-0');

      expect(
        driverStarts(launcher).map((start) => [
          start.identifier,
          driverEnv(start).WDIO_936_INSTANCE,
          driverEnv(start).REMOTE_WEBDRIVER_URL,
        ]),
      ).toEqual([
        ['a', 'a', 'http://127.0.0.1:3000'],
        ['b', 'b', 'http://127.0.0.1:3002'],
        ['a', 'a', 'http://127.0.0.1:3000'],
        ['b', 'b', 'http://127.0.0.1:3002'],
      ]);
    });
  });

  it('should hand tauri-driver the msedgedriver it checked by path, which a PATH in env cannot hide', async () => {
    mockPlatform('win32');
    vi.mocked(ensureMsEdgeDriver).mockResolvedValueOnce({
      ok: true,
      value: { method: 'downloaded', driverPath: 'C:\\drivers\\msedgedriver.exe', driverVersion: '149' },
    } as never);
    const launcher = createLauncher({ driverProvider: 'external', env: { PATH: 'C:\\app' } });

    await launcher.onPrepare({ maxInstances: 1 }, [appCap()]);

    expect(driverPool(launcher).useNativeDriver).toHaveBeenCalledWith('C:\\drivers\\msedgedriver.exe');
  });

  it('should leave the native driver alone when the msedgedriver check was skipped', async () => {
    mockPlatform('win32');
    vi.mocked(ensureMsEdgeDriver).mockResolvedValueOnce({ ok: true, value: { method: 'skipped' } } as never);
    const launcher = createLauncher({ driverProvider: 'external' });

    await launcher.onPrepare({ maxInstances: 1 }, [appCap()]);

    expect(driverPool(launcher).useNativeDriver).not.toHaveBeenCalled();
  });

  it("should match msedgedriver to the first capability's env and webviewOptions, which its app gets", async () => {
    mockPlatform('win32');
    const first: TauriCapabilities = {
      'tauri:options': { application: APP, webviewOptions: { browserExecutableFolder: 'C:\\options' } },
      'wdio:tauriServiceOptions': { env: { WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: 'C:\\env' } },
    };
    const second = appCap({ env: { WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: 'C:\\other' } });
    const launcher = createLauncher({ driverProvider: 'external', edgeDriverVersion: '149.0.4022.98' });

    await launcher.onPrepare({ maxInstances: 1 }, [first, second]);

    expect(ensureMsEdgeDriver).toHaveBeenCalledWith(APP, true, {
      edgeDriverVersion: '149.0.4022.98',
      env: { WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: 'C:\\env' },
      browserExecutableFolder: 'C:\\options',
    });
  });
});
