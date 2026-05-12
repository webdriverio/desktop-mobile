import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkEmbeddedServerAlive,
  DEFAULT_EMBEDDED_PORT,
  EMBEDDED_PORT_ENV_VAR,
  type EmbeddedDriverInfo,
  getEmbeddedPort,
  startEmbeddedDriver,
  stopEmbeddedDriver,
} from '../src/providers/embedded.js';
import type { DioxusServiceOptions } from '../src/types.js';

class FakeChildProcess extends EventEmitter {
  pid = 9999;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new EventEmitter() as unknown as NodeJS.ReadableStream;
  stderr = new EventEmitter() as unknown as NodeJS.ReadableStream;
  /** Whether kill() should emit an 'exit' event (set false for spawn-error tests). */
  killEmitsExit = true;
  kill = vi.fn((signal?: string) => {
    if (this.killEmitsExit && (signal === 'SIGTERM' || signal === 'SIGKILL')) {
      this.exitCode = 0;
      this.emit('exit', 0, null);
    }
    return true;
  });
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

const { spawn } = await import('node:child_process');

describe('getEmbeddedPort', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    delete process.env[EMBEDDED_PORT_ENV_VAR];
    vi.restoreAllMocks();
  });

  it('returns DEFAULT_EMBEDDED_PORT when no options or env var set', () => {
    delete process.env[EMBEDDED_PORT_ENV_VAR];
    expect(getEmbeddedPort({} as DioxusServiceOptions)).toBe(DEFAULT_EMBEDDED_PORT);
  });

  it('prefers embeddedPort option over env var', () => {
    process.env[EMBEDDED_PORT_ENV_VAR] = '5000';
    expect(getEmbeddedPort({ embeddedPort: 9876 } as DioxusServiceOptions)).toBe(9876);
  });

  it('reads port from env var when embeddedPort not set', () => {
    process.env[EMBEDDED_PORT_ENV_VAR] = '5555';
    expect(getEmbeddedPort({} as DioxusServiceOptions)).toBe(5555);
  });

  it('ignores invalid env var value', () => {
    process.env[EMBEDDED_PORT_ENV_VAR] = 'not-a-number';
    expect(getEmbeddedPort({} as DioxusServiceOptions)).toBe(DEFAULT_EMBEDDED_PORT);
  });
});

describe('checkEmbeddedServerAlive', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns true when status endpoint responds ok with ready=true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ value: { ready: true } }),
      }),
    );
    expect(await checkEmbeddedServerAlive(4444)).toBe(true);
  });

  it('returns false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await checkEmbeddedServerAlive(4444)).toBe(false);
  });

  it('returns false when response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await checkEmbeddedServerAlive(4444)).toBe(false);
  });
});

describe('startEmbeddedDriver', () => {
  let fakeChild: FakeChildProcess;

  beforeEach(() => {
    fakeChild = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fakeChild as unknown as ReturnType<typeof spawn>);
  });

  afterEach(() => vi.restoreAllMocks());

  it('rejects when app exits before server is ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const promise = startEmbeddedDriver('/app/dioxus-app', 4444, {
      startTimeout: 200,
    } as DioxusServiceOptions);

    // Simulate early process exit
    setTimeout(() => fakeChild.emit('exit', 1, null), 50);

    await expect(promise).rejects.toThrow(/exited before the embedded WebDriver server became ready/);
  });

  it('rejects when spawn fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    fakeChild.killEmitsExit = false; // kill() is called during cleanup; don't let it race with the error

    const promise = startEmbeddedDriver('/bad/path', 4444, {
      startTimeout: 200,
    } as DioxusServiceOptions);

    setTimeout(() => fakeChild.emit('error', new Error('ENOENT')), 20);

    await expect(promise).rejects.toThrow(/Failed to spawn Dioxus app/);
  });

  it('resolves with proc when server becomes ready', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ value: { ready: true } }),
      }),
    );

    const info = await startEmbeddedDriver('/app/dioxus-app', 4444, {} as DioxusServiceOptions);
    expect(info.proc).toBe(fakeChild);
    expect(info.logHandlers).toBeInstanceOf(Array);
  });

  it('passes WDIO_EMBEDDED_PORT to the child process env', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ value: { ready: true } }),
      }),
    );

    await startEmbeddedDriver('/app/dioxus-app', 7777, {} as DioxusServiceOptions);

    const calls = vi.mocked(spawn).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[2]?.env?.[EMBEDDED_PORT_ENV_VAR]).toBe('7777');
  });
});

describe('stopEmbeddedDriver', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls SIGTERM and resolves when process exits', async () => {
    const fakeChild = new FakeChildProcess();
    const info: EmbeddedDriverInfo = { proc: fakeChild as unknown as EmbeddedDriverInfo['proc'], logHandlers: [] };

    await stopEmbeddedDriver(info);

    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('handles missing pid gracefully', async () => {
    const fakeChild = new FakeChildProcess();
    fakeChild.pid = undefined as unknown as number;
    const info: EmbeddedDriverInfo = { proc: fakeChild as unknown as EmbeddedDriverInfo['proc'], logHandlers: [] };

    await expect(stopEmbeddedDriver(info)).resolves.toBeUndefined();
  });
});
