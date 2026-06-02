import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SevereServiceError } from 'webdriverio';

const spawnMock = vi.fn();
const execFileSyncMock = vi.fn();
const mkdtempSyncMock = vi.fn();
const cpSyncMock = vi.fn();
const rmSyncMock = vi.fn();
const createLogCaptureMock = vi.fn();
const writeRemoteDebuggingPortMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

vi.mock('node:fs', () => ({
  mkdtempSync: (...args: unknown[]) => mkdtempSyncMock(...args),
  cpSync: (...args: unknown[]) => cpSyncMock(...args),
  rmSync: (...args: unknown[]) => rmSyncMock(...args),
}));

vi.mock('@wdio/native-core', () => ({
  createLogCapture: (...args: unknown[]) => createLogCaptureMock(...args),
}));

vi.mock('../src/electrobunConfig.js', () => ({
  writeRemoteDebuggingPort: (...args: unknown[]) => writeRemoteDebuggingPortMock(...args),
}));

import type { ResolvedElectrobunApp } from '../src/electrobunConfig.js';
import { cloneAppBundle, spawnElectrobunApp, stopElectrobunApp, waitForCdpReady } from '../src/nativeMode.js';
import type { ElectrobunServiceOptions } from '../src/types.js';

interface FakeProc extends EventEmitter {
  pid: number;
  exitCode: number | null;
  signalCode: string | null;
  stdout: EventEmitter | null;
  stderr: EventEmitter | null;
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.pid = 4321;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

const APP: ResolvedElectrobunApp = {
  binaryPath: '/apps/Demo.app/Contents/MacOS/Demo',
  bundlePath: '/apps/Demo.app',
  resourcesDir: '/apps/Demo.app/Contents/Resources',
  buildJsonPath: '/apps/Demo.app/Contents/Resources/build.json',
  identifier: 'com.example.demo',
};

const CLONE_PARENT = '/tmp/wdio-electrobun-bundle-xyz';
const USER_HOME = '/tmp/wdio-electrobun-home-abc';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

// These suites mock setPlatform('darwin') to exercise the macOS clone/spawn paths, but
// node:path uses the RUNNER's separator regardless — so their hardcoded POSIX path
// assertions can't match on a Windows runner (the logic is OS-identical since the
// platform is mocked, and is covered on Linux/macOS; real Windows behaviour is exercised
// by the e2e suite). Skip on win32 rather than re-assert every path per separator.
// Aliased to describe.skip (not describe.skipIf) so vitest/valid-describe-callback
// doesn't trip on a curried describe modifier with no name/callback.
const describePosixPaths = process.platform === 'win32' ? describe.skip : describe;

describe('nativeMode', () => {
  let proc: FakeProc;

  beforeEach(() => {
    vi.clearAllMocks();
    proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);
    // mkdtempSync is called with distinct prefixes for the bundle clone vs the
    // the per-run --user-data-dir; key the stub off the prefix so call order doesn't matter.
    mkdtempSyncMock.mockImplementation((prefix: string) => (prefix.includes('bundle') ? CLONE_PARENT : USER_HOME));
    createLogCaptureMock.mockReturnValue({ close: vi.fn() });
    setPlatform('darwin');
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    vi.useRealTimers();
  });

  describePosixPaths('cloneAppBundle', () => {
    it('should use the APFS clonefile (cp -Rc) on darwin', () => {
      setPlatform('darwin');

      const result = cloneAppBundle('/apps/Demo.app');

      expect(execFileSyncMock).toHaveBeenCalledWith('cp', [
        '-Rc',
        '/apps/Demo.app',
        '/tmp/wdio-electrobun-bundle-xyz/Demo.app',
      ]);
      expect(cpSyncMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        cloneParentDir: CLONE_PARENT,
        clonedBundlePath: '/tmp/wdio-electrobun-bundle-xyz/Demo.app',
      });
    });

    it('should fall back to a recursive cpSync when the APFS clone fails', () => {
      setPlatform('darwin');
      execFileSyncMock.mockImplementationOnce(() => {
        throw new Error('clonefile unsupported on this volume');
      });

      const result = cloneAppBundle('/apps/Demo.app');

      expect(execFileSyncMock).toHaveBeenCalledTimes(1);
      // The failed cp -Rc may have left a partial tree — it must be cleared before the
      // cpSync fallback so the copy never merges onto a half-written destination.
      const rmOrder = rmSyncMock.mock.invocationCallOrder[0];
      const cpOrder = cpSyncMock.mock.invocationCallOrder[0];
      expect(rmSyncMock).toHaveBeenCalledWith('/tmp/wdio-electrobun-bundle-xyz/Demo.app', {
        recursive: true,
        force: true,
      });
      expect(rmOrder).toBeLessThan(cpOrder);
      expect(cpSyncMock).toHaveBeenCalledWith('/apps/Demo.app', '/tmp/wdio-electrobun-bundle-xyz/Demo.app', {
        recursive: true,
      });
      expect(result.clonedBundlePath).toBe('/tmp/wdio-electrobun-bundle-xyz/Demo.app');
    });

    it('should use cpSync (not cp -Rc) on non-darwin platforms', () => {
      setPlatform('linux');

      cloneAppBundle('/apps/Demo');

      expect(execFileSyncMock).not.toHaveBeenCalled();
      expect(cpSyncMock).toHaveBeenCalledWith('/apps/Demo', '/tmp/wdio-electrobun-bundle-xyz/Demo', {
        recursive: true,
      });
    });

    it('should remove the empty temp parent dir if the copy throws (no leak)', () => {
      setPlatform('linux');
      cpSyncMock.mockImplementationOnce(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      expect(() => cloneAppBundle('/apps/Demo')).toThrow('ENOSPC');
      expect(rmSyncMock).toHaveBeenCalledWith('/tmp/wdio-electrobun-bundle-xyz', { recursive: true, force: true });
    });
  });

  describePosixPaths('spawnElectrobunApp', () => {
    it('should clone the bundle and pin the port into the CLONE build.json (not the original)', () => {
      spawnElectrobunApp({
        app: APP,
        appArgs: ['--flag'],
        port: 9333,
        options: {} as ElectrobunServiceOptions,
      });

      expect(execFileSyncMock).toHaveBeenCalledWith('cp', [
        '-Rc',
        '/apps/Demo.app',
        '/tmp/wdio-electrobun-bundle-xyz/Demo.app',
      ]);
      expect(writeRemoteDebuggingPortMock).toHaveBeenCalledTimes(1);
      const [buildJsonPath, port] = writeRemoteDebuggingPortMock.mock.calls[0];
      expect(buildJsonPath).toBe('/tmp/wdio-electrobun-bundle-xyz/Demo.app/Contents/Resources/build.json');
      expect(buildJsonPath).not.toBe(APP.buildJsonPath);
      expect(port).toBe(9333);
    });

    it('should remove the clone if pinning the port throws (no temp-dir leak)', () => {
      writeRemoteDebuggingPortMock.mockImplementationOnce(() => {
        throw new Error('EACCES: build.json not writable');
      });

      expect(() =>
        spawnElectrobunApp({ app: APP, appArgs: [], port: 9333, options: {} as ElectrobunServiceOptions }),
      ).toThrow('EACCES');

      expect(rmSyncMock).toHaveBeenCalledWith(CLONE_PARENT, { recursive: true, force: true });
    });

    it('should spawn the CLONED binary and pin the port WITHOUT a separate --user-data-dir', () => {
      const result = spawnElectrobunApp({
        app: APP,
        appArgs: ['--flag'],
        port: 9333,
        options: {} as ElectrobunServiceOptions,
      });

      const [binary, args] = spawnMock.mock.calls[0] as [string, string[]];
      expect(binary).toBe('/tmp/wdio-electrobun-bundle-xyz/Demo.app/Contents/MacOS/Demo');
      expect(args).toEqual(['--flag']);
      // No --user-data-dir: CEF uses its own root_cache_path so the persist:default
      // partition profile is created inside the profile dir (avoids the catch-22).
      expect(writeRemoteDebuggingPortMock).toHaveBeenCalledWith(
        '/tmp/wdio-electrobun-bundle-xyz/Demo.app/Contents/Resources/build.json',
        9333,
      );
      expect(result.cleanupDirs).toEqual([CLONE_PARENT]);
    });

    it('should wrap the spawn in xvfb-run on Linux (headless CI needs an X display)', () => {
      setPlatform('linux');

      spawnElectrobunApp({ app: APP, appArgs: ['--flag'], port: 9333, options: {} as ElectrobunServiceOptions });

      const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
      expect(command).toBe('xvfb-run');
      expect(args).toEqual(['-a', '/tmp/wdio-electrobun-bundle-xyz/Demo.app/Contents/MacOS/Demo', '--flag']);
    });

    it('should take the cpSync fallback when the APFS clone fails', () => {
      execFileSyncMock.mockImplementationOnce(() => {
        throw new Error('clonefile unsupported');
      });

      spawnElectrobunApp({
        app: APP,
        appArgs: [],
        port: 9333,
        options: {} as ElectrobunServiceOptions,
      });

      expect(cpSyncMock).toHaveBeenCalledWith('/apps/Demo.app', '/tmp/wdio-electrobun-bundle-xyz/Demo.app', {
        recursive: true,
      });
      const [binary] = spawnMock.mock.calls[0] as [string];
      expect(binary).toBe('/tmp/wdio-electrobun-bundle-xyz/Demo.app/Contents/MacOS/Demo');
    });

    it('should clone with cpSync on non-darwin and spawn the cloned binary', () => {
      setPlatform('linux');
      const linuxApp: ResolvedElectrobunApp = {
        binaryPath: '/apps/Demo/Demo',
        bundlePath: '/apps/Demo',
        resourcesDir: '/apps/Demo',
        buildJsonPath: '/apps/Demo/build.json',
      };

      spawnElectrobunApp({
        app: linuxApp,
        appArgs: [],
        port: 9333,
        options: {} as ElectrobunServiceOptions,
      });

      expect(execFileSyncMock).not.toHaveBeenCalled();
      expect(writeRemoteDebuggingPortMock).toHaveBeenCalledWith(
        '/tmp/wdio-electrobun-bundle-xyz/Demo/build.json',
        9333,
      );
      // On Linux the cloned binary is spawned under xvfb-run (headless CI display).
      const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
      expect(command).toBe('xvfb-run');
      expect(args).toEqual(['-a', '/tmp/wdio-electrobun-bundle-xyz/Demo/Demo']);
    });

    it('should throw a SevereServiceError when the app has no build.json path', () => {
      const noBuildJson = { ...APP, buildJsonPath: undefined as unknown as string };

      expect(() =>
        spawnElectrobunApp({
          app: noBuildJson,
          appArgs: [],
          port: 9333,
          options: {} as ElectrobunServiceOptions,
        }),
      ).toThrow(SevereServiceError);
      expect(spawnMock).not.toHaveBeenCalled();
      expect(writeRemoteDebuggingPortMock).not.toHaveBeenCalled();
    });

    it('should merge user-supplied env over process.env', () => {
      spawnElectrobunApp({
        app: APP,
        appArgs: [],
        port: 9333,
        options: { env: { MY_FLAG: 'on' } } as ElectrobunServiceOptions,
      });

      const opts = spawnMock.mock.calls[0][2] as { env: NodeJS.ProcessEnv };
      expect(opts.env.MY_FLAG).toBe('on');
    });

    it('should not wire log capture when captureBackendLogs is off', () => {
      spawnElectrobunApp({
        app: APP,
        appArgs: [],
        port: 9333,
        options: { captureBackendLogs: false } as ElectrobunServiceOptions,
      });

      expect(createLogCaptureMock).not.toHaveBeenCalled();
    });

    it('should wire stdout + stderr log capture when captureBackendLogs is on', () => {
      const result = spawnElectrobunApp({
        app: APP,
        appArgs: [],
        port: 9333,
        options: { captureBackendLogs: true } as ElectrobunServiceOptions,
      });

      expect(createLogCaptureMock).toHaveBeenCalledTimes(2);
      expect(result.logHandlers).toHaveLength(2);
    });

    it('should not throw when the process emits a post-spawn error', () => {
      spawnElectrobunApp({
        app: APP,
        appArgs: [],
        port: 9333,
        options: {} as ElectrobunServiceOptions,
      });

      expect(() => proc.emit('error', new Error('ENOENT'))).not.toThrow();
    });
  });

  describePosixPaths('stopElectrobunApp', () => {
    it('should close log handlers, SIGTERM the live process, and remove every cleanup dir', async () => {
      const handler = { close: vi.fn() };
      // Process exits promptly after SIGTERM.
      proc.kill.mockImplementation(() => {
        proc.exitCode = 0;
        return true;
      });

      await stopElectrobunApp({
        proc: proc as unknown as import('node:child_process').ChildProcess,
        cleanupDirs: [USER_HOME, CLONE_PARENT],
        port: 9333,
        logHandlers: [handler as unknown as import('node:readline').Interface],
      });

      expect(handler.close).toHaveBeenCalled();
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(rmSyncMock).toHaveBeenCalledWith(USER_HOME, { recursive: true, force: true });
      expect(rmSyncMock).toHaveBeenCalledWith(CLONE_PARENT, { recursive: true, force: true });
    });

    it('should skip killing an already-exited process but still remove the cleanup dirs', async () => {
      proc.exitCode = 0;

      await stopElectrobunApp({
        proc: proc as unknown as import('node:child_process').ChildProcess,
        cleanupDirs: [USER_HOME, CLONE_PARENT],
        port: 9333,
        logHandlers: [],
      });

      expect(proc.kill).not.toHaveBeenCalled();
      expect(rmSyncMock).toHaveBeenCalledTimes(2);
    });

    it('should keep removing remaining dirs when one removal fails', async () => {
      proc.exitCode = 0;
      rmSyncMock.mockImplementationOnce(() => {
        throw new Error('EBUSY');
      });

      await expect(
        stopElectrobunApp({
          proc: proc as unknown as import('node:child_process').ChildProcess,
          cleanupDirs: [USER_HOME, CLONE_PARENT],
          port: 9333,
          logHandlers: [],
        }),
      ).resolves.toBeUndefined();

      expect(rmSyncMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('waitForCdpReady', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should resolve once /json reports a page target', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ type: 'page' }] });
      vi.stubGlobal('fetch', fetchMock);

      await expect(waitForCdpReady(9333, 1000)).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9333/json', expect.anything());
    });

    it('should resolve (not throw) on timeout when no page target ever appears', async () => {
      // /json responds but never lists a page target — should warn-and-proceed, not hang/throw.
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));

      await expect(waitForCdpReady(9333, 50)).resolves.toBeUndefined();
    });

    it('should resolve (not throw) when the endpoint never responds', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      await expect(waitForCdpReady(9333, 50)).resolves.toBeUndefined();
    });
  });
});
