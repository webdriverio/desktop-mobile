import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startEmbeddedDriver, stopEmbeddedDriver } from '../../src/embeddedProvider.js';
import { defer } from './helpers.js';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawn: vi.fn(original.spawn) };
});

describe('embedded process and HTTP lifecycle', () => {
  let server: Server;
  let port: number;
  let child: ChildProcess | undefined;

  beforeEach(async () => {
    vi.mocked(spawn).mockClear();
    server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    port = address.port;
  });

  afterEach(async () => {
    if (child) await stopEmbeddedDriver({ proc: child, logHandlers: [] });
    child = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  function start(signal?: AbortSignal, script = "console.log('started'); setInterval(() => {}, 1000)") {
    const result = startEmbeddedDriver(process.execPath, port, { appArgs: ['-e', script] }, undefined, signal);
    child = vi.mocked(spawn).mock.results.at(-1)?.value as ChildProcess;
    return result;
  }

  it('waits for W3C readiness rather than accepting an open TCP port', async () => {
    const notReady = defer();
    let ready = false;
    let settled = false;
    server.on('request', (_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ value: { ready } }));
      if (!ready) notReady.resolve();
    });
    const result = start().then((info) => {
      settled = true;
      return info;
    });
    await notReady.promise;
    expect(settled).toBe(false);
    ready = true;
    const info = await result;
    expect(info.proc.exitCode).toBeNull();
    await stopEmbeddedDriver(info);
    expect(info.proc.exitCode !== null || info.proc.signalCode !== null).toBe(true);
    expect(info.proc.stdout?.destroyed).toBe(true);
    expect(info.proc.stderr?.destroyed).toBe(true);
  });

  it.each(['headers', 'body'] as const)('cancels a stalled response %s and reaps the child', async (stage) => {
    const received = defer();
    const disconnected = defer();
    server.on('request', (_request, response) => {
      response.on('close', () => disconnected.resolve());
      if (stage === 'body') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.write('{"value":');
      }
      received.resolve();
    });
    const controller = new AbortController();
    const result = start(controller.signal).catch((error: unknown) => error);
    const reason = new Error('cancelled by test');
    await received.promise;
    controller.abort(reason);
    expect(await result).toBe(reason);
    await disconnected.promise;
    expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
    expect(child?.stdout?.destroyed).toBe(true);
  });

  it('reports early exit and cancels a pending readiness request', async () => {
    const result = start(undefined, 'process.exit(17)');
    await expect(result).rejects.toThrow('code=17');
    expect(child?.exitCode).toBe(17);
    expect(child?.listenerCount('exit')).toBe(0);
  });

  it('preserves the OS spawn error without waiting for the startup timeout', async () => {
    const result = startEmbeddedDriver('/nonexistent-wdio-tauri-app', port, {});
    child = vi.mocked(spawn).mock.results.at(-1)?.value as ChildProcess;
    await expect(result).rejects.toMatchObject({ cause: { code: 'ENOENT' } });
  });

  it.skipIf(process.platform === 'win32')('waits for SIGKILL to reap a child that ignores SIGTERM', async () => {
    const booted = defer();
    server.on('request', async (_request, response) => {
      await booted.promise;
      response.end(JSON.stringify({ value: { ready: true } }));
    });
    const result = start(
      undefined,
      "process.on('SIGTERM', () => {}); console.log('started'); setInterval(() => {}, 1000)",
    );
    if (!child?.stdout) throw new Error('Expected child stdout');
    await once(child.stdout, 'data');
    booted.resolve();
    const info = await result;
    await stopEmbeddedDriver(info);
    expect(info.proc.signalCode).toBe('SIGKILL');
    expect(info.proc.listenerCount('exit')).toBe(0);
    expect(info.proc.listenerCount('error')).toBe(0);
  });
});
