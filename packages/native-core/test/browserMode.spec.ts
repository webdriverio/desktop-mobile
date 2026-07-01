import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  nonChromeBrowserNameError,
  probeDevServerReachable,
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
  proc.kill = vi.fn();
  proc.pid = 4242;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.killed = false;
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
    expect(spawn).toHaveBeenCalledWith('pnpm dev', expect.objectContaining({ shell: true }));
    expect(managed.url).toBe(url);
  });

  it('should spawn even when reachable if reuseExistingServer is false (string/object form)', async () => {
    vi.stubGlobal('fetch', reachable());
    const spawn = vi.fn(() => fakeChild()) as never;
    await startManagedDevServer({ command: 'pnpm dev', reuseExistingServer: false, timeoutMs: 1000 }, url, {
      spawn,
      probe: async () => true,
      isCI: false,
    });
    expect(spawn).toHaveBeenCalled();
  });
});
