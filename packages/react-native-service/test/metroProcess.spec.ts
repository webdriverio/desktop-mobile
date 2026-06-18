import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return { ...actual, createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) };
});

import { existsSync } from 'node:fs';
import { MetroProcess, resolveReactNativeBin } from '../src/metroProcess.js';

const existsMock = vi.mocked(existsSync);

/** A fake long-lived child process. */
function fakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    exitCode: number | null;
    signalCode: string | null;
    killed: boolean;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.exitCode = null;
  proc.signalCode = null;
  proc.killed = false;
  return proc;
}

afterEach(() => vi.clearAllMocks());

describe('resolveReactNativeBin', () => {
  it('should use the project-local CLI when present', () => {
    existsMock.mockReturnValueOnce(true);
    expect(resolveReactNativeBin('/proj')).toEqual({ cmd: expect.stringContaining('react-native'), prefixArgs: [] });
  });

  it('should fall back to npx --no-install when the local CLI is absent', () => {
    existsMock.mockReturnValueOnce(false);
    const r = resolveReactNativeBin('/proj');
    expect(r.cmd).toContain('npx');
    expect(r.prefixArgs).toEqual(['--no-install', 'react-native']);
  });
});

describe('MetroProcess.start', () => {
  it('should spawn react-native start and resolve once Metro is ready', async () => {
    existsMock.mockReturnValue(true);
    const proc = fakeProc();
    const spawn = vi.fn(() => proc) as never;
    const probe = vi.fn(async () => true);
    const mp = new MetroProcess({ spawn, probe });

    await mp.start({ projectRoot: '/proj', port: 8090, readyTimeoutMs: 1000, pollIntervalMs: 10 });

    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('react-native'),
      ['start', '--port', '8090'],
      expect.objectContaining({ cwd: '/proj' }),
    );
    expect(mp.port).toBe(8090);
  });

  it('should pre-bundle when requested', async () => {
    existsMock.mockReturnValue(true);
    const fetchBundle = vi.fn(async () => {});
    const mp = new MetroProcess({ spawn: vi.fn(() => fakeProc()) as never, probe: async () => true, fetchBundle });
    await mp.start({ port: 8081, platform: 'ios', prebundle: true, readyTimeoutMs: 1000, pollIntervalMs: 10 });
    expect(fetchBundle).toHaveBeenCalledWith(8081, 'ios');
  });

  it('should not fail the run when pre-bundle fails', async () => {
    existsMock.mockReturnValue(true);
    const fetchBundle = vi.fn(async () => {
      throw new Error('bundle 500');
    });
    const mp = new MetroProcess({ spawn: vi.fn(() => fakeProc()) as never, probe: async () => true, fetchBundle });
    await expect(mp.start({ prebundle: true, readyTimeoutMs: 1000, pollIntervalMs: 10 })).resolves.toBeUndefined();
  });

  it('should throw when Metro never becomes ready', async () => {
    existsMock.mockReturnValue(true);
    const mp = new MetroProcess({ spawn: vi.fn(() => fakeProc()) as never, probe: async () => false });
    await expect(mp.start({ readyTimeoutMs: 40, pollIntervalMs: 10 })).rejects.toThrow(/did not become ready/);
  });

  it('should throw when the Metro process exits during startup', async () => {
    existsMock.mockReturnValue(true);
    const proc = fakeProc();
    proc.exitCode = 1;
    const mp = new MetroProcess({ spawn: vi.fn(() => proc) as never, probe: async () => false });
    await expect(mp.start({ readyTimeoutMs: 1000, pollIntervalMs: 10 })).rejects.toThrow(/exited during startup/);
  });

  it('should fail fast with the spawn error instead of timing out (ENOENT)', async () => {
    existsMock.mockReturnValue(true);
    const proc = fakeProc();
    const mp = new MetroProcess({ spawn: vi.fn(() => proc) as never, probe: async () => false });
    const starting = mp.start({ readyTimeoutMs: 5000, pollIntervalMs: 20 });
    proc.emit('error', new Error('spawn react-native ENOENT'));
    await expect(starting).rejects.toThrow(/ENOENT/);
  });

  it('should stop() immediately after a spawn error without hanging on a never-fired exit', async () => {
    existsMock.mockReturnValue(true);
    const proc = fakeProc();
    const mp = new MetroProcess({ spawn: vi.fn(() => proc) as never, probe: async () => false });
    const starting = mp.start({ readyTimeoutMs: 5000, pollIntervalMs: 20 });
    proc.emit('error', new Error('spawn react-native ENOENT'));
    await expect(starting).rejects.toThrow(/ENOENT/);
    // No 'exit' will fire for a failed spawn — stop() must early-return, not await SIGKILL.
    await mp.stop();
    expect(proc.kill).not.toHaveBeenCalled();
  });
});

describe('MetroProcess.stop', () => {
  it('should SIGTERM the process and resolve on exit', async () => {
    existsMock.mockReturnValue(true);
    const proc = fakeProc();
    const mp = new MetroProcess({ spawn: vi.fn(() => proc) as never, probe: async () => true });
    await mp.start({ readyTimeoutMs: 1000, pollIntervalMs: 10 });

    const stopping = mp.stop();
    proc.emit('exit', 0);
    await stopping;
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mp.isRunning()).toBe(false);
  });

  it('should be a no-op when nothing is running', async () => {
    const mp = new MetroProcess();
    await expect(mp.stop()).resolves.toBeUndefined();
  });
});
