import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const mkdtempSyncMock = vi.fn();
const rmSyncMock = vi.fn();
const createLogCaptureMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock('node:fs', () => ({
  mkdtempSync: (...args: unknown[]) => mkdtempSyncMock(...args),
  rmSync: (...args: unknown[]) => rmSyncMock(...args),
}));

vi.mock('@wdio/native-core', () => ({
  createLogCapture: (...args: unknown[]) => createLogCaptureMock(...args),
}));

import { spawnElectrobunApp, stopElectrobunApp } from '../src/nativeMode.js';
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

describe('nativeMode', () => {
  let proc: FakeProc;

  beforeEach(() => {
    vi.clearAllMocks();
    proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);
    mkdtempSyncMock.mockReturnValue('/tmp/wdio-electrobun-home-abc');
    createLogCaptureMock.mockReturnValue({ close: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('spawnElectrobunApp', () => {
    it('should create a per-run CFFIXED_USER_HOME and pass it in the spawn env', () => {
      const result = spawnElectrobunApp({
        binaryPath: '/apps/Demo',
        appArgs: ['--flag'],
        port: 9333,
        options: {} as ElectrobunServiceOptions,
      });

      expect(mkdtempSyncMock).toHaveBeenCalledTimes(1);
      expect(result.userHomeDir).toBe('/tmp/wdio-electrobun-home-abc');

      const [binary, args, opts] = spawnMock.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
      expect(binary).toBe('/apps/Demo');
      expect(args).toEqual(['--flag']);
      expect(opts.env.CFFIXED_USER_HOME).toBe('/tmp/wdio-electrobun-home-abc');
    });

    it('should merge user-supplied env over process.env', () => {
      spawnElectrobunApp({
        binaryPath: '/apps/Demo',
        appArgs: [],
        port: 9333,
        options: { env: { MY_FLAG: 'on' } } as ElectrobunServiceOptions,
      });

      const opts = spawnMock.mock.calls[0][2] as { env: NodeJS.ProcessEnv };
      expect(opts.env.MY_FLAG).toBe('on');
    });

    it('should not wire log capture when captureBackendLogs is off', () => {
      spawnElectrobunApp({
        binaryPath: '/apps/Demo',
        appArgs: [],
        port: 9333,
        options: { captureBackendLogs: false } as ElectrobunServiceOptions,
      });

      expect(createLogCaptureMock).not.toHaveBeenCalled();
    });

    it('should wire stdout + stderr log capture when captureBackendLogs is on', () => {
      const result = spawnElectrobunApp({
        binaryPath: '/apps/Demo',
        appArgs: [],
        port: 9333,
        options: { captureBackendLogs: true } as ElectrobunServiceOptions,
      });

      expect(createLogCaptureMock).toHaveBeenCalledTimes(2);
      expect(result.logHandlers).toHaveLength(2);
    });

    it('should not throw when the process emits a post-spawn error', () => {
      spawnElectrobunApp({
        binaryPath: '/apps/Demo',
        appArgs: [],
        port: 9333,
        options: {} as ElectrobunServiceOptions,
      });

      expect(() => proc.emit('error', new Error('ENOENT'))).not.toThrow();
    });
  });

  describe('stopElectrobunApp', () => {
    it('should close log handlers, SIGTERM the live process, and remove the temp dir', async () => {
      const handler = { close: vi.fn() };
      // Process exits promptly after SIGTERM.
      proc.kill.mockImplementation(() => {
        proc.exitCode = 0;
        return true;
      });

      await stopElectrobunApp({
        proc: proc as unknown as import('node:child_process').ChildProcess,
        userHomeDir: '/tmp/wdio-electrobun-home-abc',
        port: 9333,
        logHandlers: [handler as unknown as import('node:readline').Interface],
      });

      expect(handler.close).toHaveBeenCalled();
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(rmSyncMock).toHaveBeenCalledWith('/tmp/wdio-electrobun-home-abc', { recursive: true, force: true });
    });

    it('should skip killing an already-exited process but still remove the temp dir', async () => {
      proc.exitCode = 0;

      await stopElectrobunApp({
        proc: proc as unknown as import('node:child_process').ChildProcess,
        userHomeDir: '/tmp/wdio-electrobun-home-abc',
        port: 9333,
        logHandlers: [],
      });

      expect(proc.kill).not.toHaveBeenCalled();
      expect(rmSyncMock).toHaveBeenCalled();
    });

    it('should not throw when temp-dir removal fails', async () => {
      proc.exitCode = 0;
      rmSyncMock.mockImplementationOnce(() => {
        throw new Error('EBUSY');
      });

      await expect(
        stopElectrobunApp({
          proc: proc as unknown as import('node:child_process').ChildProcess,
          userHomeDir: '/tmp/wdio-electrobun-home-abc',
          port: 9333,
          logHandlers: [],
        }),
      ).resolves.toBeUndefined();
    });
  });
});
