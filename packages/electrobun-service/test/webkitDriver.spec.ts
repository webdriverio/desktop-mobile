import { execSync, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { mockPlatform, restorePlatform } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWebKitWebDriverPath,
  spawnWebKitWebDriver,
  stopWebKitWebDriver,
  type WebKitDriverProcess,
  waitForWebKitWebDriverReady,
  webKitWebDriverArgs,
} from '../src/webkitDriver.js';

vi.mock('node:child_process', () => ({ execSync: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn(), rmSync: vi.fn() }));

const mockedExecSync = vi.mocked(execSync);
const mockedSpawn = vi.mocked(spawn);
const mockedExistsSync = vi.mocked(existsSync);
const mockedRmSync = vi.mocked(rmSync);

describe('getWebKitWebDriverPath', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return undefined on non-Linux platforms without probing', () => {
    expect(getWebKitWebDriverPath('darwin')).toBeUndefined();
    expect(getWebKitWebDriverPath('win32')).toBeUndefined();
    expect(mockedExecSync).not.toHaveBeenCalled();
  });

  it('should return the PATH match from `which` when it exists', () => {
    mockedExecSync.mockReturnValue('/usr/bin/WebKitWebDriver\n');
    mockedExistsSync.mockImplementation((p) => p === '/usr/bin/WebKitWebDriver');
    expect(getWebKitWebDriverPath('linux')).toBe('/usr/bin/WebKitWebDriver');
  });

  it('should fall back to common paths when not on PATH', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockedExistsSync.mockImplementation((p) => p === '/usr/lib/webkit2gtk-4.1/WebKitWebDriver');
    expect(getWebKitWebDriverPath('linux')).toBe('/usr/lib/webkit2gtk-4.1/WebKitWebDriver');
  });

  it('should return undefined when WebKitWebDriver is not found anywhere', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockedExistsSync.mockReturnValue(false);
    expect(getWebKitWebDriverPath('linux')).toBeUndefined();
  });
});

describe('webKitWebDriverArgs', () => {
  it('should use equals-form flags (space-form makes WebKitWebDriver print usage and exit)', () => {
    expect(webKitWebDriverArgs('127.0.0.1', 4444)).toEqual(['--host=127.0.0.1', '--port=4444']);
  });
});

describe('waitForWebKitWebDriverReady', () => {
  it('should resolve once /status returns a value', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: { ready: true, message: 'ok' } }),
    }) as unknown as typeof fetch;
    await expect(waitForWebKitWebDriverReady('127.0.0.1', 4444, 1000, fetchImpl)).resolves.toBeUndefined();
  });

  it('should throw when /status never becomes ready within the timeout', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(waitForWebKitWebDriverReady('127.0.0.1', 4444, 10, fetchImpl)).rejects.toThrow(/did not become ready/);
  });
});

describe('spawnWebKitWebDriver', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const stream = { on: vi.fn() };
    mockedSpawn.mockReturnValue({ stdout: stream, stderr: stream, on: vi.fn(), once: vi.fn() } as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ value: { ready: true } }) }));
    mockPlatform('linux');
    vi.stubEnv('DISPLAY', '');
    vi.stubEnv('WAYLAND_DISPLAY', '');
  });

  afterEach(() => {
    restorePlatform();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const spawned = () =>
    mockedSpawn.mock.calls[0] as unknown as [string, string[], { detached: boolean; env: NodeJS.ProcessEnv }];

  it.each([
    ['no display is set', {}],
    ['only a Wayland display is set', { WAYLAND_DISPLAY: 'wayland-0' }],
  ])('should run under xvfb-run on X11 when %s', async (_case, displayEnv: Record<string, string>) => {
    for (const [name, value] of Object.entries(displayEnv)) vi.stubEnv(name, value);

    const handle = await spawnWebKitWebDriver({ driverPath: '/usr/bin/WebKitWebDriver', port: 4444 });

    const [command, args, opts] = spawned();
    expect(command).toBe('xvfb-run');
    expect(args).toEqual(['-a', '/usr/bin/WebKitWebDriver', '--host=127.0.0.1', '--port=4444']);
    expect(opts.env).toMatchObject({ GDK_BACKEND: 'x11', XDG_SESSION_TYPE: 'x11' });
    expect(opts.env.WAYLAND_DISPLAY).toBeUndefined();
    expect(opts.detached).toBe(true);
    expect(handle.detached).toBe(true);
  });

  it('should reuse an X display already set, still on X11', async () => {
    vi.stubEnv('DISPLAY', ':99');
    vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0');

    const handle = await spawnWebKitWebDriver({ driverPath: '/usr/bin/WebKitWebDriver', port: 4444 });

    const [command, args, opts] = spawned();
    expect(command).toBe('/usr/bin/WebKitWebDriver');
    expect(args).toEqual(['--host=127.0.0.1', '--port=4444']);
    expect(opts.env).toMatchObject({ DISPLAY: ':99', GDK_BACKEND: 'x11', XDG_SESSION_TYPE: 'x11' });
    expect(opts.env.WAYLAND_DISPLAY).toBeUndefined();
    expect(handle.detached).toBe(true);
  });
});

describe('stopWebKitWebDriver', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should still remove per-instance clone dirs when the driver has already exited', async () => {
    const kill = vi.fn();
    const handle = {
      process: { exitCode: 1, signalCode: null, pid: 4321, once: vi.fn(), kill },
      host: '127.0.0.1',
      port: 4444,
      detached: true,
      cleanupDirs: ['/tmp/wdio-electrobun-bundle-clone-a', '/tmp/wdio-electrobun-bundle-clone-b'],
    } as unknown as WebKitDriverProcess;

    await stopWebKitWebDriver(handle);

    expect(kill).not.toHaveBeenCalled();
    expect(mockedRmSync).toHaveBeenCalledWith('/tmp/wdio-electrobun-bundle-clone-a', { recursive: true, force: true });
    expect(mockedRmSync).toHaveBeenCalledWith('/tmp/wdio-electrobun-bundle-clone-b', { recursive: true, force: true });
  });

  it('should signal a running driver and then remove its clone dirs', async () => {
    let exitCb: (() => void) | undefined;
    const kill = vi.fn(() => exitCb?.());
    const handle = {
      process: {
        exitCode: null,
        signalCode: null,
        pid: 4321,
        once: (event: string, cb: () => void) => {
          if (event === 'exit') {
            exitCb = cb;
          }
        },
        kill,
      },
      host: '127.0.0.1',
      port: 4444,
      detached: false,
      cleanupDirs: ['/tmp/wdio-electrobun-bundle-clone-c'],
    } as unknown as WebKitDriverProcess;

    await stopWebKitWebDriver(handle);

    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockedRmSync).toHaveBeenCalledWith('/tmp/wdio-electrobun-bundle-clone-c', { recursive: true, force: true });
  });

  it('should not throw when a clone dir cannot be removed', async () => {
    mockedRmSync.mockImplementation(() => {
      throw new Error('EBUSY');
    });
    const handle = {
      process: { exitCode: 0, signalCode: null, pid: 4321, once: vi.fn(), kill: vi.fn() },
      host: '127.0.0.1',
      port: 4444,
      detached: true,
      cleanupDirs: ['/tmp/wdio-electrobun-bundle-clone-d'],
    } as unknown as WebKitDriverProcess;

    await expect(stopWebKitWebDriver(handle)).resolves.toBeUndefined();
  });
});
