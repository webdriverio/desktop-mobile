import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/providers/embedded.js', () => ({
  getEmbeddedPort: vi.fn().mockReturnValue(4444),
  startEmbeddedDriver: vi.fn().mockResolvedValue({ proc: { pid: 1234, kill: vi.fn() }, logHandlers: [] }),
  stopEmbeddedDriver: vi.fn().mockResolvedValue(undefined),
  DEFAULT_EMBEDDED_PORT: 4444,
  EMBEDDED_PORT_ENV_VAR: 'WDIO_EMBEDDED_PORT',
}));

vi.mock('@wdio/native-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-core')>()),
  startManagedDevServer: vi.fn(),
}));

import { startManagedDevServer } from '@wdio/native-core';
import DioxusLaunchService from '../src/launcher.js';
import { startEmbeddedDriver } from '../src/providers/embedded.js';
import type { DioxusCapabilities, DioxusServiceGlobalOptions } from '../src/types.js';

const DEV_SERVER = 'http://localhost:1420';
const baseConfig = {} as Parameters<DioxusLaunchService['onPrepare']>[0];

function createLauncher(globalOpts: Partial<DioxusServiceGlobalOptions> = {}): DioxusLaunchService {
  return new DioxusLaunchService(globalOpts as DioxusServiceGlobalOptions, {} as DioxusCapabilities, baseConfig);
}

describe('DioxusLaunchService — browser mode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('mutates browserName to "chrome" and removes dioxus:options', async () => {
    const launcher = createLauncher();
    const caps: any[] = [
      {
        'dioxus:options': { application: '/app/my-app' },
        'wdio:dioxusServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER },
      },
    ];
    await launcher.onPrepare(baseConfig, caps);
    expect(caps[0].browserName).toBe('chrome');
    expect(caps[0]['dioxus:options']).toBeUndefined();
  });

  it('does not start the embedded driver in browser mode', async () => {
    const launcher = createLauncher();
    const caps: any[] = [{ 'wdio:dioxusServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } }];
    await launcher.onPrepare(baseConfig, caps);
    expect(startEmbeddedDriver).not.toHaveBeenCalled();
  });

  it('accepts mode and devServerUrl from global options', async () => {
    const launcher = createLauncher({ mode: 'browser', devServerUrl: DEV_SERVER });
    const caps: any[] = [{}];
    await launcher.onPrepare(baseConfig, caps);
    expect(caps[0].browserName).toBe('chrome');
  });

  it('throws SevereServiceError when devServerUrl is missing', async () => {
    const launcher = createLauncher();
    const caps: any[] = [{ 'wdio:dioxusServiceOptions': { mode: 'browser' } }];
    await expect(launcher.onPrepare(baseConfig, caps)).rejects.toThrow('devServerUrl is required');
  });

  it('throws SevereServiceError when devServerUrl is not a valid URL', async () => {
    const launcher = createLauncher();
    const caps: any[] = [{ 'wdio:dioxusServiceOptions': { mode: 'browser', devServerUrl: 'not-a-url' } }];
    await expect(launcher.onPrepare(baseConfig, caps)).rejects.toThrow('not a valid URL');
  });

  it('throws SevereServiceError when browserName is a non-chrome value', async () => {
    const launcher = createLauncher();
    const caps: any[] = [
      { browserName: 'firefox', 'wdio:dioxusServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } },
    ];
    await expect(launcher.onPrepare(baseConfig, caps)).rejects.toThrow('Browser mode only supports');
  });

  it('throws SevereServiceError when the dev server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const launcher = createLauncher();
    const caps: any[] = [{ 'wdio:dioxusServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER } }];
    await expect(launcher.onPrepare(baseConfig, caps)).rejects.toThrow('Dev server not reachable');
  });
});

describe('DioxusLaunchService — devServer management', () => {
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
    await launcher.onPrepare(baseConfig, [{}] as any);
    expect(startManagedDevServer).toHaveBeenCalledWith('pnpm dev', DEV_SERVER);
    await launcher.onComplete();
    expect(managedStop).toHaveBeenCalledOnce();
  });

  it('should skip the HEAD preflight when managing the dev server', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const launcher = createLauncher({ mode: 'browser', devServerUrl: DEV_SERVER, devServer: 'pnpm dev' });
    await launcher.onPrepare(baseConfig, [{}] as any);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should throw SevereServiceError when the managed dev server fails to start', async () => {
    vi.mocked(startManagedDevServer).mockRejectedValue(new Error('boom'));
    const launcher = createLauncher({ mode: 'browser', devServerUrl: DEV_SERVER, devServer: 'pnpm dev' });
    await expect(launcher.onPrepare(baseConfig, [{}] as any)).rejects.toThrow(/Failed to start dev server/);
  });

  it('should propagate a function-provided url override to the capability', async () => {
    vi.mocked(startManagedDevServer).mockResolvedValue({ url: 'http://localhost:5173', stop: managedStop });
    const launcher = createLauncher({
      mode: 'browser',
      devServer: async () => ({ url: 'http://localhost:5173', close: managedStop }),
    });
    const caps: any[] = [{}];
    await launcher.onPrepare(baseConfig, caps);
    expect(caps[0]['wdio:dioxusServiceOptions'].devServerUrl).toBe('http://localhost:5173');
  });

  it('should not start a managed dev server when devServer is unset', async () => {
    const launcher = createLauncher({ mode: 'browser', devServerUrl: DEV_SERVER });
    await launcher.onPrepare(baseConfig, [{}] as any);
    expect(startManagedDevServer).not.toHaveBeenCalled();
  });

  it('should reject a non-chrome browserName before starting the dev server (no orphan)', async () => {
    const launcher = createLauncher({ mode: 'browser', devServerUrl: DEV_SERVER, devServer: 'pnpm dev' });
    const caps: any[] = [{ browserName: 'firefox' }];
    await expect(launcher.onPrepare(baseConfig, caps)).rejects.toThrow(/Browser mode only supports/);
    // Fail fast before spawning — nothing to orphan.
    expect(startManagedDevServer).not.toHaveBeenCalled();
  });

  it('should stop the managed dev server when a later step fails (e.g. an invalid resolved url)', async () => {
    vi.mocked(startManagedDevServer).mockResolvedValue({ url: 'not-a-url', stop: managedStop });
    const launcher = createLauncher({
      mode: 'browser',
      devServer: async () => ({ url: 'not-a-url', close: managedStop }),
    });
    await expect(launcher.onPrepare(baseConfig, [{}] as any)).rejects.toThrow(/not a valid URL/);
    expect(managedStop).toHaveBeenCalledOnce();
  });
});
