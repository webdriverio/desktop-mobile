import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, init } from '../../src/session.js';
import { defer } from './helpers.js';

const { onComplete } = vi.hoisted(() => ({ onComplete: vi.fn() }));

vi.mock('../../src/launcher.js', () => ({
  default: class {
    onPrepare = vi.fn();
    onWorkerStart = vi.fn();
    onWorkerEnd = vi.fn();
    onComplete = onComplete;
  },
}));

vi.mock('../../src/service.js', () => ({
  default: class {
    before = vi.fn();
  },
}));

describe('standalone HTTP cancellation', () => {
  let server: Server;
  let port: number;
  let browser: WebdriverIO.Browser | undefined;

  beforeEach(async () => {
    onComplete.mockReset().mockResolvedValue(undefined);
    server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    port = address.port;
  });

  afterEach(async () => {
    if (browser) await cleanup(browser);
    browser = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  function start(signal: AbortSignal) {
    return init({ hostname: '127.0.0.1', port, 'wdio:tauriServiceOptions': {} }, { abortSignal: signal });
  }

  it.each(['/status', '/session'])('cancels pending startup at %s and waits for cleanup', async (endpoint) => {
    const received = defer();
    const disconnected = defer();
    const stopped = defer();
    let settled = false;
    server.on('request', (request, response) => {
      if (request.url === endpoint) {
        response.on('close', () => disconnected.resolve());
        received.resolve();
        return;
      }
      response.end(JSON.stringify({ value: { ready: true } }));
    });
    onComplete.mockImplementationOnce(() => stopped.promise);
    const controller = new AbortController();
    const result = start(controller.signal).catch((error: unknown) => {
      settled = true;
      return error;
    });
    await received.promise;
    controller.abort(new Error('test cancelled startup'));
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    stopped.resolve();
    expect(await result).toBeInstanceOf(Error);
    await disconnected.promise;
  });

  it('cancels commands after successful session creation and still allows launcher cleanup', async () => {
    const commandReceived = defer();
    const disconnected = defer();
    server.on('request', (request, response) => {
      if (request.url?.endsWith('/title')) {
        response.on('close', () => disconnected.resolve());
        commandReceived.resolve();
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          value:
            request.url === '/session'
              ? { sessionId: 'test-session', capabilities: { browserName: 'wry' } }
              : { ready: true },
        }),
      );
    });
    const controller = new AbortController();
    browser = await start(controller.signal);
    const result = browser.getTitle().catch((error: unknown) => error);
    await commandReceived.promise;
    controller.abort(new Error('test cancelled command'));
    expect(await result).toBeInstanceOf(Error);
    await disconnected.promise;
    await cleanup(browser);
    expect(onComplete).toHaveBeenCalledOnce();
    browser = undefined;
  });
});
