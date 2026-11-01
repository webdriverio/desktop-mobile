import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import type { BrowserExtension } from '@wdio/native-types';
import { executeHooksWithArgs } from '@wdio/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ElectronWorkerService from '../../src/service.js';
import { clearPuppeteerSessions } from '../../src/window.js';

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

vi.mock('@wdio/native-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-utils')>()),
  createLogger: vi.fn(() => logger),
  waitUntilWindowAvailable: vi.fn().mockResolvedValue(undefined),
}));

const fastFailOptions = { cdpBridgeRetryCount: 1, cdpBridgeWaitInterval: 10, cdpBridgeTimeout: 1000 };

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function createBrowser(sessionId: string) {
  return {
    sessionId,
    getPuppeteer: vi.fn().mockResolvedValue({ targets: () => [] }),
  } as unknown as WebdriverIO.Browser;
}

// Runs the service's before() the way the testrunner does, which logs a thrown error and carries on.
async function runBeforeHook(capabilities: WebdriverIO.Capabilities, browser: WebdriverIO.Browser) {
  const service = new ElectronWorkerService(fastFailOptions, capabilities);
  const [result] = await executeHooksWithArgs('before', [service.before.bind(service)], [capabilities, [], browser]);
  return result;
}

function apiError(browser: WebdriverIO.Browser): unknown {
  try {
    (browser.electron as BrowserExtension['electron']).execute(() => undefined);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('CDP bridge connection failure', () => {
  afterEach(() => {
    clearPuppeteerSessions();
    vi.clearAllMocks();
  });

  it('should report the connection error from browser.electron when the inspector is unreachable', async () => {
    const port = await closedPort();
    const capabilities = { 'goog:chromeOptions': { args: [`--inspect=localhost:${port}`] } };
    const browser = createBrowser('unreachable-inspector');

    const hookResult = await runBeforeHook(capabilities, browser);

    expect(hookResult).not.toBeInstanceOf(Error);
    const error = apiError(browser);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      `CDP bridge could not connect to the main process, API is disabled: Timeout exceeded while waiting for debugger port to open: localhost:${port}`,
    );
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('CDP bridge could not connect to the main process'),
    );
  });

  it('should report a missing --inspect argument from browser.electron', async () => {
    const capabilities = { 'goog:chromeOptions': { args: [] } };
    const browser = createBrowser('missing-inspect-arg');

    const hookResult = await runBeforeHook(capabilities, browser);

    expect(hookResult).not.toBeInstanceOf(Error);
    expect(apiError(browser)).toMatchObject({
      message: expect.stringContaining('Failed to detect the debugger endpoint'),
    });
  });
});
