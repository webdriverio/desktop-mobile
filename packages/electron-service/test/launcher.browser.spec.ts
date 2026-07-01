import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@wdio/native-utils', async () => {
  const actual = await vi.importActual('@wdio/native-utils');
  return {
    ...actual,
    readPackageUp: vi.fn(),
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    })),
    formatDiagnosticResults: vi.fn(),
  };
});

vi.mock('../src/appBuildInfo.js', () => ({ getAppBuildInfo: vi.fn() }));
vi.mock('../src/binaryPath.js', () => ({ getBinaryPath: vi.fn() }));
vi.mock('../src/electronVersion.js', () => ({ getElectronVersion: vi.fn() }));
vi.mock('../src/diagnostics.js', () => ({ diagnoseElectronEnvironment: vi.fn().mockResolvedValue([]) }));
vi.mock('../src/apparmor.js', () => ({ applyApparmorWorkaround: vi.fn() }));

vi.mock('get-port', () => ({ default: vi.fn().mockResolvedValue(9229) }));

vi.mock('@wdio/native-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-core')>()),
  startManagedDevServer: vi.fn(),
}));

import { startManagedDevServer } from '@wdio/native-core';
import ElectronLaunchService from '../src/launcher.js';

const DEV_SERVER = 'http://localhost:5173';

function makeLauncher(globalOpts: Record<string, unknown> = {}): ElectronLaunchService {
  return new ElectronLaunchService(globalOpts as any, {} as any, {} as any);
}

describe('ElectronLaunchService — browser mode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('onPrepare', () => {
    it('should set browserName to "chrome" and strip Electron-specific capability bits', async () => {
      const launcher = makeLauncher();
      const caps: any[] = [
        {
          browserName: 'electron',
          'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER },
        },
      ];
      await launcher.onPrepare({} as any, caps);
      expect(caps[0].browserName).toBe('chrome');
      expect(caps[0]['goog:chromeOptions']).toBeUndefined();
      expect(caps[0]['wdio:enforceWebDriverClassic']).toBeUndefined();
    });

    it('should preserve user-supplied goog:chromeOptions and strip only the Electron binary', async () => {
      const launcher = makeLauncher();
      const caps: any[] = [
        {
          browserName: 'electron',
          'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER },
          'goog:chromeOptions': {
            binary: '/path/to/Electron.app/Contents/MacOS/Electron',
            args: ['--disable-features=IsolateOrigins', '--no-sandbox'],
            prefs: { 'profile.default_content_setting_values.notifications': 2 },
          },
        },
      ];
      await launcher.onPrepare({} as any, caps);
      expect(caps[0]['goog:chromeOptions']).toEqual({
        args: ['--disable-features=IsolateOrigins', '--no-sandbox'],
        prefs: { 'profile.default_content_setting_values.notifications': 2 },
      });
    });

    it('throws SevereServiceError when devServerUrl is missing', async () => {
      const launcher = makeLauncher();
      const caps: any[] = [{ browserName: 'electron', 'wdio:electronServiceOptions': { mode: 'browser' } }];
      await expect(launcher.onPrepare({} as any, caps)).rejects.toThrow('devServerUrl is required');
    });

    it('throws SevereServiceError when devServerUrl is not a valid URL', async () => {
      const launcher = makeLauncher();
      const caps: any[] = [
        { browserName: 'electron', 'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: 'not-a-url' } },
      ];
      await expect(launcher.onPrepare({} as any, caps)).rejects.toThrow('not a valid URL');
    });

    it('accepts mode and devServerUrl from global options', async () => {
      const launcher = makeLauncher({ mode: 'browser', devServerUrl: DEV_SERVER });
      const caps: any[] = [{ browserName: 'electron', 'wdio:electronServiceOptions': {} }];
      await launcher.onPrepare({} as any, caps);
      expect(caps[0].browserName).toBe('chrome');
    });

    it('throws SevereServiceError when a per-capability devServerUrl is invalid', async () => {
      const launcher = makeLauncher();
      const caps: any[] = [
        { browserName: 'electron', 'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
        { browserName: 'electron', 'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: 'bad-url' } },
      ];
      await expect(launcher.onPrepare({} as any, caps)).rejects.toThrow('not a valid URL');
    });

    it('throws SevereServiceError when a per-capability devServerUrl is missing', async () => {
      const launcher = makeLauncher();
      const caps: any[] = [
        { browserName: 'electron', 'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
        { browserName: 'electron', 'wdio:electronServiceOptions': { mode: 'browser' } },
      ];
      await expect(launcher.onPrepare({} as any, caps)).rejects.toThrow('devServerUrl is required');
    });

    it('validates devServerUrl for W3C alwaysMatch-wrapped capabilities', async () => {
      const launcher = makeLauncher();
      const caps: any[] = [
        {
          alwaysMatch: {
            browserName: 'electron',
            'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: 'not-a-url' },
          },
        },
      ];
      await expect(launcher.onPrepare({} as any, caps)).rejects.toThrow('not a valid URL');
    });

    it('throws SevereServiceError when capabilities have mixed modes', async () => {
      const launcher = makeLauncher();
      const caps: any[] = [
        { browserName: 'electron', 'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
        { browserName: 'electron', 'wdio:electronServiceOptions': { mode: 'native' } },
      ];
      await expect(launcher.onPrepare({} as any, caps)).rejects.toThrow('mixed modes');
    });

    it('applies browser mode to all capabilities when all agree', async () => {
      const launcher = makeLauncher();
      const caps: any[] = [
        { browserName: 'electron', 'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
        { browserName: 'electron', 'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
      ];
      await launcher.onPrepare({} as any, caps);
      expect(caps[0].browserName).toBe('chrome');
      expect(caps[1].browserName).toBe('chrome');
    });

    it('accepts the native detection browserName "electron" and rewrites it to chrome', async () => {
      const launcher = makeLauncher();
      const caps: any[] = [
        { browserName: 'electron', 'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
      ];
      await launcher.onPrepare({} as any, caps);
      expect(caps[0].browserName).toBe('chrome');
    });

    it('throws SevereServiceError when the dev server is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      const launcher = makeLauncher();
      const caps: any[] = [
        { browserName: 'electron', 'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
      ];
      await expect(launcher.onPrepare({} as any, caps)).rejects.toThrow('Dev server not reachable');
    });
  });

  describe('onWorkerStart', () => {
    it('returns immediately without allocating debug ports', async () => {
      const launcher = makeLauncher();
      const caps: any[] = [
        { browserName: 'electron', 'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
      ];
      await launcher.onPrepare({} as any, caps);
      const getPort = (await import('get-port')).default as ReturnType<typeof vi.fn>;
      getPort.mockClear();
      await expect(launcher.onWorkerStart('0-0', caps[0])).resolves.toBeUndefined();
      expect(getPort).not.toHaveBeenCalled();
    });
  });
});

describe('ElectronLaunchService — devServer management', () => {
  const managedStop = vi.fn(async () => {});

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    vi.mocked(startManagedDevServer).mockResolvedValue({ url: DEV_SERVER, stop: managedStop });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const browserCap = () => ({ browserName: 'electron', 'wdio:electronServiceOptions': { mode: 'browser' } });

  it('should start the managed dev server from global options and stop it in onComplete', async () => {
    const launcher = makeLauncher({ devServerUrl: DEV_SERVER, devServer: 'pnpm dev' });
    await launcher.onPrepare({} as any, [browserCap()] as any);
    expect(startManagedDevServer).toHaveBeenCalledWith('pnpm dev', DEV_SERVER);
    await launcher.onComplete();
    expect(managedStop).toHaveBeenCalledOnce();
  });

  it('should stamp the resolved url onto every cap (multiremote) so workers navigate to it', async () => {
    vi.mocked(startManagedDevServer).mockResolvedValue({ url: 'http://localhost:4321', stop: managedStop });
    const launcher = makeLauncher({ devServer: 'pnpm dev' });
    const caps: any[] = [browserCap(), browserCap()];
    await launcher.onPrepare({} as any, caps);
    expect(caps[0]['wdio:electronServiceOptions'].devServerUrl).toBe('http://localhost:4321');
    expect(caps[1]['wdio:electronServiceOptions'].devServerUrl).toBe('http://localhost:4321');
  });

  it('should throw SevereServiceError when the managed dev server fails to start', async () => {
    vi.mocked(startManagedDevServer).mockRejectedValue(new Error('boom'));
    const launcher = makeLauncher({ devServerUrl: DEV_SERVER, devServer: 'pnpm dev' });
    await expect(launcher.onPrepare({} as any, [browserCap()] as any)).rejects.toThrow(/Failed to start dev server/);
  });

  it('should not manage a dev server when devServer is unset', async () => {
    const launcher = makeLauncher({ devServerUrl: DEV_SERVER });
    await launcher.onPrepare({} as any, [browserCap()] as any);
    expect(startManagedDevServer).not.toHaveBeenCalled();
  });
});
