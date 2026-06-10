import type { Options } from '@wdio/types';
import { describe, expect, it, vi } from 'vitest';

const deleteSession = vi.fn().mockResolvedValue(undefined);
const fakeBrowser = { sessionId: 'sid', deleteSession } as unknown as WebdriverIO.Browser;
const remoteMock = vi.fn().mockResolvedValue(fakeBrowser);
vi.mock('webdriverio', () => ({ remote: (...args: unknown[]) => remoteMock(...args) }));

import { createMobileSession } from '../src/session.js';

const onPrepare = vi.fn().mockResolvedValue(undefined);
const before = vi.fn().mockResolvedValue(undefined);
const after = vi.fn().mockResolvedValue(undefined);

class FakeLauncher {
  constructor(
    public options: unknown,
    public capability: unknown,
    public config: Options.Testrunner,
  ) {}
  onPrepare = onPrepare;
}
class FakeWorker {
  constructor(
    public options: unknown,
    public capability: unknown,
  ) {}
  before = before;
  after = after;
}

const makeSession = () =>
  createMobileSession<Record<string, unknown>, { platformName?: string }>({
    LauncherClass: FakeLauncher as never,
    WorkerClass: FakeWorker as never,
    logNamespace: 'test-service',
  });

const resetMocks = () => {
  onPrepare.mockClear().mockResolvedValue(undefined);
  before.mockClear().mockResolvedValue(undefined);
  after.mockClear().mockResolvedValue(undefined);
  deleteSession.mockClear();
  remoteMock.mockClear().mockResolvedValue(fakeBrowser);
};

describe('createMobileSession init', () => {
  it('should drive launcher.onPrepare, open the session, and call worker.before', async () => {
    resetMocks();
    const browser = await makeSession().init({ platformName: 'Android' });
    expect(onPrepare).toHaveBeenCalled();
    expect(remoteMock).toHaveBeenCalled();
    expect(before).toHaveBeenCalled();
    expect(browser).toBe(fakeBrowser);
  });

  it('should default the Appium connection to localhost:4723/', async () => {
    resetMocks();
    await makeSession().init({ platformName: 'Android' });
    expect(remoteMock).toHaveBeenCalledWith(expect.objectContaining({ hostname: 'localhost', port: 4723, path: '/' }));
  });

  it('should let the caller override the connection', async () => {
    resetMocks();
    await makeSession().init({ platformName: 'Android' }, {}, { port: 4444, path: '/wd/hub' });
    expect(remoteMock).toHaveBeenCalledWith(expect.objectContaining({ port: 4444, path: '/wd/hub' }));
  });

  it('should delete the session and rethrow when worker.before fails', async () => {
    resetMocks();
    before.mockRejectedValueOnce(new Error('before boom'));
    await expect(makeSession().init({ platformName: 'Android' })).rejects.toThrow('before boom');
    expect(deleteSession).toHaveBeenCalled();
  });

  it('should throw a clear error for an empty capabilities array (no remote() call)', async () => {
    resetMocks();
    await expect(makeSession().init([])).rejects.toThrow(/no capability/);
    expect(remoteMock).not.toHaveBeenCalled();
  });

  it('should throw a clear error for an undefined capability', async () => {
    resetMocks();
    await expect(makeSession().init(undefined as never)).rejects.toThrow(/no capability/);
    expect(remoteMock).not.toHaveBeenCalled();
  });
});

describe('createMobileSession cleanup', () => {
  it('should call worker.after and deleteSession for a managed browser', async () => {
    resetMocks();
    const session = makeSession();
    const browser = await session.init({ platformName: 'Android' });
    await session.cleanup(browser);
    expect(after).toHaveBeenCalled();
    expect(deleteSession).toHaveBeenCalled();
  });

  it('should warn and no-op for a browser it did not create', async () => {
    resetMocks();
    await makeSession().cleanup({ sessionId: 'x', deleteSession: vi.fn() } as unknown as WebdriverIO.Browser);
    expect(after).not.toHaveBeenCalled();
  });
});
