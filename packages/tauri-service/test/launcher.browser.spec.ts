import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/embeddedProvider.js', () => ({
  checkEmbeddedServerAlive: vi.fn(),
  startEmbeddedDriver: vi.fn(),
  stopEmbeddedDriver: vi.fn(),
  getEmbeddedPort: vi.fn().mockReturnValue(4445),
  isEmbeddedProvider: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/diagnostics.js', () => ({
  diagnoseTauriEnvironment: vi.fn().mockResolvedValue([]),
}));

vi.mock('@wdio/native-utils', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  formatDiagnosticResults: vi.fn(),
  isErr: (r: { ok: boolean }) => r.ok === false,
  isOk: (r: { ok: boolean }) => r.ok === true,
  Ok: (v: unknown) => ({ ok: true, value: v }),
  Err: (e: unknown) => ({ ok: false, error: e }),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('../src/driverPool.js', () => ({
  DriverPool: class MockDriverPool {
    startDriver = vi.fn();
    stopDriver = vi.fn().mockResolvedValue(undefined);
    stopAll = vi.fn().mockResolvedValue(undefined);
    getStatus = vi.fn().mockReturnValue({ count: 0, running: false });
    getRunningPids = vi.fn().mockReturnValue([]);
  },
}));

vi.mock('../src/portManager.js', () => ({
  PortManager: class MockPortManager {
    allocatePortPair = vi.fn().mockResolvedValue({ port: 4444, nativePort: 4445 });
    allocatePorts = vi.fn().mockResolvedValue([{ port: 4444, nativePort: 4445 }]);
    allocatePort = vi.fn().mockResolvedValue(4444);
    clear = vi.fn();
  },
}));

vi.mock('../src/pathResolver.js', () => ({
  getWebKitWebDriverPath: vi.fn().mockReturnValue('/usr/bin/WebKitWebDriver'),
}));

vi.mock('../src/driverManager.js', () => ({
  ensureTauriDriver: vi.fn().mockResolvedValue({ ok: true, value: { path: '/tauri-driver', method: 'found' } }),
  findTestRunnerBackend: vi.fn(),
}));

vi.mock('../src/edgeDriverManager.js', () => ({
  ensureMsEdgeDriver: vi.fn().mockResolvedValue({ ok: true, value: { method: 'found', driverVersion: '120' } }),
}));

vi.mock('../src/commands/triggerDeeplink.js', () => ({
  setEmbeddedModeInfo: vi.fn(),
  setCrabnebulaModeInfo: vi.fn(),
}));

vi.mock('../src/crabnebulaBackend.js', () => ({
  startTestRunnerBackend: vi.fn(),
  stopTestRunnerBackend: vi.fn().mockResolvedValue(undefined),
  waitTestRunnerBackendReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@wdio/native-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-core')>()),
  startManagedDevServer: vi.fn(),
}));

import { startManagedDevServer } from '@wdio/native-core';
import { ensureTauriDriver } from '../src/driverManager.js';
import TauriLaunchService from '../src/launcher.js';

const DEV_SERVER = 'http://localhost:1420';

function createLauncher(globalOpts: Record<string, unknown> = {}): TauriLaunchService {
  return new TauriLaunchService(globalOpts as any, {} as any, { maxInstances: 1 } as any);
}

describe('TauriLaunchService — browser mode', () => {
  beforeEach(() => {
    // Dev server reachable by default; individual tests override for the unreachable case.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('onPrepare', () => {
    it('mutates browserName to "chrome" and removes tauri:options', async () => {
      const launcher = createLauncher();
      const caps: any[] = [
        {
          'tauri:options': { application: '/app/my-app' },
          'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER },
        },
      ];
      await launcher.onPrepare({} as any, caps);
      expect(caps[0].browserName).toBe('chrome');
      expect(caps[0]['tauri:options']).toBeUndefined();
    });

    it('does not spawn tauri-driver in browser mode', async () => {
      const launcher = createLauncher();
      const caps: any[] = [{ 'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } }];
      await launcher.onPrepare({} as any, caps);
      expect(ensureTauriDriver).not.toHaveBeenCalled();
    });

    it('throws SevereServiceError when devServerUrl is missing', async () => {
      const launcher = createLauncher();
      const caps: any[] = [{ 'wdio:tauriServiceOptions': { mode: 'browser' } }];
      await expect(launcher.onPrepare({} as any, caps)).rejects.toThrow('devServerUrl is required');
    });

    it('throws SevereServiceError when devServerUrl is not a valid URL', async () => {
      const launcher = createLauncher();
      const caps: any[] = [{ 'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: 'not-a-url' } }];
      await expect(launcher.onPrepare({} as any, caps)).rejects.toThrow('not a valid URL');
    });

    it('accepts devServerUrl via global options', async () => {
      const launcher = createLauncher({ mode: 'browser', devServerUrl: DEV_SERVER });
      const caps: any[] = [{}];
      await launcher.onPrepare({} as any, caps);
      expect(caps[0].browserName).toBe('chrome');
    });

    it('throws SevereServiceError when browserName is a non-chrome value', async () => {
      const launcher = createLauncher();
      const caps: any[] = [
        { browserName: 'firefox', 'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
      ];
      await expect(launcher.onPrepare({} as any, caps)).rejects.toThrow('Browser mode only supports');
    });

    it('throws SevereServiceError when the dev server is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      const launcher = createLauncher();
      const caps: any[] = [{ 'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } }];
      await expect(launcher.onPrepare({} as any, caps)).rejects.toThrow('Dev server not reachable');
    });
  });

  describe('onWorkerStart', () => {
    it('returns immediately without setting up drivers', async () => {
      const launcher = createLauncher();
      const caps: any[] = [{ 'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } }];
      await launcher.onPrepare({} as any, caps);
      await expect(launcher.onWorkerStart('0-0', caps as any)).resolves.toBeUndefined();
      expect(ensureTauriDriver).not.toHaveBeenCalled();
    });
  });

  describe('onWorkerEnd', () => {
    it('returns immediately in browser mode', async () => {
      const launcher = createLauncher();
      const caps: any[] = [{ 'wdio:tauriServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } }];
      await launcher.onPrepare({} as any, caps);
      await expect(launcher.onWorkerEnd('0-0')).resolves.toBeUndefined();
    });
  });
});

describe('TauriLaunchService — devServer management', () => {
  const managedStop = vi.fn(async () => {});

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    vi.mocked(startManagedDevServer).mockResolvedValue({ url: DEV_SERVER, stop: managedStop });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('should start the managed dev server and tear it down in onComplete', async () => {
    const launcher = createLauncher({ mode: 'browser', devServerUrl: DEV_SERVER, devServer: 'pnpm dev' });
    await launcher.onPrepare({} as any, [{}] as any);
    expect(startManagedDevServer).toHaveBeenCalledWith('pnpm dev', DEV_SERVER);
    await launcher.onComplete(0, {} as any, [] as any);
    expect(managedStop).toHaveBeenCalledOnce();
  });

  it('should throw SevereServiceError when the managed dev server fails to start', async () => {
    vi.mocked(startManagedDevServer).mockRejectedValue(new Error('boom'));
    const launcher = createLauncher({ mode: 'browser', devServerUrl: DEV_SERVER, devServer: 'pnpm dev' });
    await expect(launcher.onPrepare({} as any, [{}] as any)).rejects.toThrow(/Failed to start dev server/);
  });

  it('should not manage a dev server when devServer is unset', async () => {
    const launcher = createLauncher({ mode: 'browser', devServerUrl: DEV_SERVER });
    await launcher.onPrepare({} as any, [{}] as any);
    expect(startManagedDevServer).not.toHaveBeenCalled();
  });
});
