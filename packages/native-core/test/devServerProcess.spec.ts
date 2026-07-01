import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return { ...actual, createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) };
});

import { DevServerProcess } from '../src/devServerProcess.js';

const URL = 'http://localhost:1420';

/** A fake long-lived child process. */
function fakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
    exitCode: number | null;
    signalCode: string | null;
    killed: boolean;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.pid = 4242;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.killed = false;
  return proc;
}

afterEach(() => {
  vi.clearAllMocks();
  // Restore real timers even if a fake-timer test threw before its own restore, so leaked fake
  // timers don't hang the next test.
  vi.useRealTimers();
});

describe('DevServerProcess.start', () => {
  it('should spawn the command in a shell and resolve once the server is reachable', async () => {
    const proc = fakeProc();
    const spawn = vi.fn(() => proc) as never;
    const probe = vi.fn(async () => true);
    const dsp = new DevServerProcess({ spawn, probe });

    await dsp.start({ command: 'pnpm dev', url: URL, cwd: '/proj', timeoutMs: 1000, pollMs: 10 });

    expect(spawn).toHaveBeenCalledWith('pnpm dev', expect.objectContaining({ shell: true, cwd: '/proj' }));
    expect(probe).toHaveBeenCalledWith(URL);
    expect(dsp.isRunning()).toBe(true);
  });

  it('should merge env over process.env', async () => {
    const proc = fakeProc();
    const spawn = vi.fn(() => proc) as never;
    const dsp = new DevServerProcess({ spawn, probe: async () => true });
    await dsp.start({ command: 'pnpm dev', url: URL, env: { FOO: 'bar' }, timeoutMs: 1000, pollMs: 10 });
    expect(spawn).toHaveBeenCalledWith(
      'pnpm dev',
      expect.objectContaining({ env: expect.objectContaining({ FOO: 'bar', PATH: process.env.PATH }) }),
    );
  });

  it('should throw when the server never becomes reachable', async () => {
    const dsp = new DevServerProcess({ spawn: vi.fn(() => fakeProc()) as never, probe: async () => false });
    await expect(dsp.start({ command: 'x', url: URL, timeoutMs: 40, pollMs: 10 })).rejects.toThrow(
      /did not become ready/,
    );
  });

  it('should throw when the process exits during startup', async () => {
    const proc = fakeProc();
    proc.exitCode = 1;
    const dsp = new DevServerProcess({ spawn: vi.fn(() => proc) as never, probe: async () => false });
    await expect(dsp.start({ command: 'x', url: URL, timeoutMs: 1000, pollMs: 10 })).rejects.toThrow(
      /exited during startup/,
    );
  });

  it('should surface captured stderr in a startup-failure error', async () => {
    const proc = fakeProc();
    queueMicrotask(() => {
      proc.stderr.emit('data', Buffer.from('error: listen EADDRINUSE: address already in use :::1420'));
      proc.exitCode = 1;
    });
    const dsp = new DevServerProcess({ spawn: vi.fn(() => proc) as never, probe: async () => false });
    await expect(dsp.start({ command: 'x', url: URL, timeoutMs: 1000, pollMs: 10 })).rejects.toThrow(/EADDRINUSE/);
  });

  it('should fail fast with the spawn error instead of timing out (ENOENT)', async () => {
    const proc = fakeProc();
    const dsp = new DevServerProcess({ spawn: vi.fn(() => proc) as never, probe: async () => false });
    const starting = dsp.start({ command: 'x', url: URL, timeoutMs: 5000, pollMs: 20 });
    proc.emit('error', new Error('spawn sh ENOENT'));
    await expect(starting).rejects.toThrow(/ENOENT/);
    expect(dsp.isRunning()).toBe(false);
  });

  it('should surface a spawn error even when a pre-existing server answers the probe', async () => {
    const proc = fakeProc();
    const probe = vi.fn(async () => {
      proc.emit('error', new Error('spawn sh ENOENT'));
      return true;
    });
    const dsp = new DevServerProcess({ spawn: vi.fn(() => proc) as never, probe });
    await expect(dsp.start({ command: 'x', url: URL, timeoutMs: 1000, pollMs: 10 })).rejects.toThrow(/ENOENT/);
  });

  it('should throw when the owned process exits during the probe even if a pre-existing server answers', async () => {
    const proc = fakeProc();
    const probe = vi.fn(async () => {
      proc.exitCode = 1;
      return true;
    });
    const dsp = new DevServerProcess({ spawn: vi.fn(() => proc) as never, probe });
    await expect(dsp.start({ command: 'x', url: URL, timeoutMs: 1000, pollMs: 10 })).rejects.toThrow(
      /exited during startup/,
    );
    expect(dsp.isRunning()).toBe(false);
  });
});

describe('DevServerProcess.stop', () => {
  it('should kill the process tree with SIGTERM and resolve on exit', async () => {
    const proc = fakeProc();
    const kill = vi.fn();
    const dsp = new DevServerProcess({ spawn: vi.fn(() => proc) as never, probe: async () => true, kill });
    await dsp.start({ command: 'pnpm dev', url: URL, timeoutMs: 1000, pollMs: 10 });

    const stopping = dsp.stop();
    proc.emit('exit', 0);
    await stopping;

    expect(kill).toHaveBeenCalledWith(proc, 'SIGTERM');
    expect(dsp.isRunning()).toBe(false);
  });

  it('should escalate to SIGKILL when the process does not exit in time', async () => {
    vi.useFakeTimers();
    const proc = fakeProc();
    const kill = vi.fn();
    const dsp = new DevServerProcess({ spawn: vi.fn(() => proc) as never, probe: async () => true, kill });
    await dsp.start({ command: 'x', url: URL, timeoutMs: 1000, pollMs: 10 });

    const stopping = dsp.stop();
    // #waitForExit's grace timeout is 10s in CI (5s locally); advance past the larger value so the
    // SIGKILL fires deterministically regardless of process.env.CI.
    await vi.advanceTimersByTimeAsync(10_000); // grace timeout → SIGKILL
    expect(kill).toHaveBeenCalledWith(proc, 'SIGKILL');
    await vi.advanceTimersByTimeAsync(5000); // post-SIGKILL grace → resolve
    await stopping;
    vi.useRealTimers();
  });

  it('should early-return after a spawn error without attempting a kill', async () => {
    const proc = fakeProc();
    const kill = vi.fn();
    const dsp = new DevServerProcess({ spawn: vi.fn(() => proc) as never, probe: async () => false, kill });
    const starting = dsp.start({ command: 'x', url: URL, timeoutMs: 5000, pollMs: 20 });
    proc.emit('error', new Error('spawn sh ENOENT'));
    await expect(starting).rejects.toThrow(/ENOENT/);
    await dsp.stop();
    expect(kill).not.toHaveBeenCalled();
  });

  it('should be a no-op when nothing is running', async () => {
    const dsp = new DevServerProcess();
    await expect(dsp.stop()).resolves.toBeUndefined();
  });
});
