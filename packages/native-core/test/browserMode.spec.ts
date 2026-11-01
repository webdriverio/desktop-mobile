import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mixedModesError,
  nonChromeBrowserNameError,
  probeDevServerReachable,
  resolveDevServerUrls,
  startManagedDevServer,
  waitForDevServerReachable,
} from '../src/browserMode.js';

const reachable = () => vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
const unreachable = () => vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

/** A minimal fake child process for the command-form (DevServerProcess) spawn path. */
function fakeChild() {
  const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  // No pid: with one, stop() would kill the real process with that pid instead of calling kill() below.
  proc.pid = undefined;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.killed = false;
  proc.kill = vi.fn(() => {
    queueMicrotask(() => {
      proc.exitCode = 143;
      proc.emit('exit', null, 'SIGTERM');
    });
  });
  return proc;
}

describe('nonChromeBrowserNameError', () => {
  it('returns undefined when browserName is unset', () => {
    expect(nonChromeBrowserNameError(undefined)).toBeUndefined();
  });

  it('returns undefined for chrome (case-insensitive)', () => {
    expect(nonChromeBrowserNameError('chrome')).toBeUndefined();
    expect(nonChromeBrowserNameError('Chrome')).toBeUndefined();
  });

  it('returns an actionable message for a non-chrome browserName', () => {
    const message = nonChromeBrowserNameError('firefox');
    expect(message).toContain("got 'firefox'");
    expect(message).toContain("'chrome'");
  });

  it('honours a custom allow list', () => {
    expect(nonChromeBrowserNameError('electron', ['chrome', 'electron'])).toBeUndefined();
    // A genuinely foreign browserName still errors; the message guides to chrome (not the
    // tolerated native names in the allow-list).
    const message = nonChromeBrowserNameError('firefox', ['chrome', 'electron']);
    expect(message).toContain("got 'firefox'");
    expect(message).toContain("'chrome'");
  });
});

describe('mixedModesError', () => {
  it('should return undefined when every capability uses the same mode', () => {
    expect(mixedModesError(['browser', 'browser'], 'Tauri', 'wdio:tauriServiceOptions')).toBeUndefined();
  });

  it('should return undefined when there are no capabilities', () => {
    expect(mixedModesError([], 'Tauri', 'wdio:tauriServiceOptions')).toBeUndefined();
  });

  it('should count a capability with no mode as native', () => {
    expect(mixedModesError([undefined, 'native'], 'Tauri', 'wdio:tauriServiceOptions')).toBeUndefined();
  });

  it('should name the service, the modes found and the options key when the modes differ', () => {
    expect(mixedModesError(['browser', undefined], 'Dioxus', 'wdio:dioxusServiceOptions')).toBe(
      'All Dioxus capabilities must use the same mode, but found mixed modes: browser, native. ' +
        "Set mode consistently across all 'wdio:dioxusServiceOptions' entries.",
    );
  });
});

describe('resolveDevServerUrls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should give each capability its own URL and probe each distinct URL once', async () => {
    const fetchMock = reachable();
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveDevServerUrls([
      'http://localhost:1420',
      'http://localhost:1421',
      'http://localhost:1420',
    ]);

    expect(result).toEqual({
      ok: true,
      value: ['http://localhost:1420', 'http://localhost:1421', 'http://localhost:1420'],
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['http://localhost:1420', 'http://localhost:1421']);
  });

  it('should give every capability the managed URL without probing it', async () => {
    const fetchMock = reachable();
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveDevServerUrls(['http://localhost:1420', undefined], 'http://localhost:5173');

    expect(result).toEqual({ ok: true, value: ['http://localhost:5173', 'http://localhost:5173'] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should fail when a capability has no URL', async () => {
    vi.stubGlobal('fetch', reachable());

    const result = await resolveDevServerUrls(['http://localhost:1420', undefined]);

    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('devServerUrl is required') },
    });
  });

  it('should fail when a URL is invalid', async () => {
    vi.stubGlobal('fetch', reachable());

    const result = await resolveDevServerUrls(['not-a-url']);

    expect(result).toMatchObject({ ok: false, error: { message: 'devServerUrl is not a valid URL: not-a-url' } });
  });

  it('should fail when a dev server is unreachable', async () => {
    vi.stubGlobal('fetch', unreachable());

    const result = await resolveDevServerUrls(['http://localhost:1420']);

    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('Dev server not reachable at http://localhost:1420') },
    });
  });
});

describe('probeDevServerReachable', () => {
  const url = 'http://localhost:1420';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves Ok when the dev server responds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeDevServerReachable(url);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'HEAD' }));
  });

  it('resolves Ok even on a 404/405 (server is listening)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    const result = await probeDevServerReachable(url);

    expect(result.ok).toBe(true);
  });

  it('resolves Err with an actionable message when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const result = await probeDevServerReachable(url);

    expect(result.ok).toBe(false);
    const message = result.ok ? '' : result.error.message;
    expect(message).toContain(`Dev server not reachable at ${url}`);
    expect(message).toContain('is it running?');
  });
});

describe('waitForDevServerReachable', () => {
  const url = 'http://localhost:1420';
  afterEach(() => vi.unstubAllGlobals());

  it('should resolve Ok as soon as the server is reachable', async () => {
    vi.stubGlobal('fetch', reachable());
    const result = await waitForDevServerReachable(url, { timeoutMs: 1000, pollMs: 10 });
    expect(result.ok).toBe(true);
  });

  it('should poll until the server comes up', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await waitForDevServerReachable(url, { timeoutMs: 1000, pollMs: 5 });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should resolve Err after the timeout when never reachable', async () => {
    vi.stubGlobal('fetch', unreachable());
    const result = await waitForDevServerReachable(url, { timeoutMs: 30, pollMs: 10 });
    expect(result.ok).toBe(false);
  });
});

describe('startManagedDevServer', () => {
  const url = 'http://localhost:1420';
  afterEach(() => vi.unstubAllGlobals());

  it('should await readiness and return close() as the teardown for the function form', async () => {
    vi.stubGlobal('fetch', reachable());
    const close = vi.fn(async () => {});
    const devServer = async () => ({ url: 'http://localhost:5173', close });

    const managed = await startManagedDevServer(devServer, url);

    expect(managed.url).toBe('http://localhost:5173'); // function url overrides devServerUrl
    await managed.stop();
    expect(close).toHaveBeenCalledOnce();
  });

  it('should close and throw when the function-form url never becomes reachable', async () => {
    vi.stubGlobal('fetch', unreachable());
    const close = vi.fn(async () => {});
    const devServer = async () => ({ url: 'http://localhost:5173', close });

    await expect(
      startManagedDevServer(devServer, url, { readinessTimeoutMs: 30, readinessPollMs: 10 }),
    ).rejects.toThrow(/not reachable/);
    expect(close).toHaveBeenCalledOnce();
  });

  it('should reuse an already-reachable server (no spawn) for the string/object form when not in CI', async () => {
    vi.stubGlobal('fetch', reachable());
    const spawn = vi.fn();
    const managed = await startManagedDevServer('pnpm dev', url, { spawn: spawn as never, isCI: false });
    expect(spawn).not.toHaveBeenCalled();
    await expect(managed.stop()).resolves.toBeUndefined();
  });

  it('should spawn even if reachable in CI for the string/object form (no reuse)', async () => {
    vi.stubGlobal('fetch', reachable());
    const spawn = vi.fn(() => fakeChild()) as never;
    const managed = await startManagedDevServer({ command: 'pnpm dev', timeoutMs: 1000 }, url, {
      spawn,
      probe: async () => true,
      isCI: true,
    });
    try {
      expect(spawn).toHaveBeenCalledWith('pnpm dev', expect.objectContaining({ shell: true }));
      expect(managed.url).toBe(url);
    } finally {
      await managed.stop();
    }
  });

  it('should spawn even when reachable if reuseExistingServer is false (string/object form)', async () => {
    vi.stubGlobal('fetch', reachable());
    const spawn = vi.fn(() => fakeChild()) as never;
    const managed = await startManagedDevServer(
      { command: 'pnpm dev', reuseExistingServer: false, timeoutMs: 1000 },
      url,
      {
        spawn,
        probe: async () => true,
        isCI: false,
      },
    );
    try {
      expect(spawn).toHaveBeenCalled();
    } finally {
      await managed.stop();
    }
  });

  it('should stop the spawned process and rethrow when it never becomes ready (no orphan)', async () => {
    const proc = fakeChild();
    const spawn = vi.fn(() => proc) as never;

    await expect(
      startManagedDevServer({ command: 'pnpm dev', timeoutMs: 20 }, url, {
        spawn,
        probe: async () => false,
        isCI: true,
      }),
    ).rejects.toThrow(/did not become ready/);
    expect(proc.kill).toHaveBeenCalled();
  });

  it('should reject a concurrent start that would reuse an active managed server in this process', async () => {
    vi.stubGlobal('fetch', unreachable());
    const spawn = vi.fn(() => fakeChild()) as never;
    const first = await startManagedDevServer('pnpm dev', url, {
      spawn,
      probe: async () => true,
      isCI: false,
    });

    try {
      vi.stubGlobal('fetch', reachable());
      await expect(
        startManagedDevServer('pnpm dev', `${url}/index.html`, {
          spawn,
          probe: async () => true,
          isCI: false,
        }),
      ).rejects.toThrow(/devServerUrl without devServer.*separate processes/);
    } finally {
      await first.stop();
    }
  });

  it('should reject a concurrent start at the same URL in CI, where it would spawn a second server', async () => {
    const spawn = vi.fn(() => fakeChild()) as never;
    const first = await startManagedDevServer('pnpm dev', url, { spawn, probe: async () => true, isCI: true });

    try {
      await expect(
        startManagedDevServer('pnpm dev', url, { spawn, probe: async () => true, isCI: true }),
      ).rejects.toThrow(/still in use by another session/);
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      await first.stop();
    }
  });

  it('should let only one of two sessions starting at once claim the same URL', async () => {
    vi.stubGlobal('fetch', unreachable());
    const spawn = vi.fn(() => fakeChild()) as never;
    const deps = { spawn, probe: async () => true, isCI: false };

    const [a, b] = await Promise.allSettled([
      startManagedDevServer('pnpm dev', url, deps),
      startManagedDevServer('pnpm dev', url, deps),
    ]);

    const started = [a, b].filter((result) => result.status === 'fulfilled');
    try {
      expect(started).toHaveLength(1);
      expect([a, b].filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      for (const result of started) {
        await result.value.stop();
      }
    }
  });

  it('should allow starting again at the same URL after the owning managed server stops', async () => {
    vi.stubGlobal('fetch', unreachable());
    const spawn = vi.fn(() => fakeChild()) as never;
    const first = await startManagedDevServer('pnpm dev', url, {
      spawn,
      probe: async () => true,
      isCI: false,
    });
    await first.stop();

    const second = await startManagedDevServer('pnpm dev', url, {
      spawn,
      probe: async () => true,
      isCI: false,
    });
    try {
      expect(spawn).toHaveBeenCalledTimes(2);
    } finally {
      await second.stop();
    }
  });

  it('should allow concurrent managed servers on different URLs', async () => {
    vi.stubGlobal('fetch', unreachable());
    const spawn = vi.fn(() => fakeChild()) as never;
    const first = await startManagedDevServer('pnpm dev', 'http://localhost:1420', {
      spawn,
      probe: async () => true,
      isCI: false,
    });
    try {
      const second = await startManagedDevServer('pnpm dev', 'http://localhost:1421', {
        spawn,
        probe: async () => true,
        isCI: false,
      });
      try {
        expect(spawn).toHaveBeenCalledTimes(2);
      } finally {
        await second.stop();
      }
    } finally {
      await first.stop();
    }
  });
});
