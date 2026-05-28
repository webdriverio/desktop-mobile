import path from 'node:path';
import { fileURLToPath } from 'node:url';
import getPort from 'get-port';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSuccessPath } from '../mockPaths.js';

vi.mock('../../src/crabnebulaBackend.js', () => ({
  startTestRunnerBackend: vi.fn().mockResolvedValue({
    proc: { kill: vi.fn(), killed: false },
    port: 3000,
  }),
  waitTestRunnerBackendReady: vi.fn().mockResolvedValue(undefined),
  stopTestRunnerBackend: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/driverManager.js', () => ({
  ensureTauriDriver: vi.fn(),
  ensureWebKitWebDriver: vi.fn(),
  findTestRunnerBackend: vi.fn().mockReturnValue('/mock/test-runner-backend'),
}));

vi.mock('../../src/pathResolver.js', () => ({
  getWebKitWebDriverPath: vi.fn().mockReturnValue('/usr/bin/WebKitWebDriver'),
}));

vi.mock('@wdio/native-utils', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  })),
  isErr: vi.fn(() => false),
  isOk: vi.fn(() => true),
  Ok: vi.fn((v: unknown) => ({ ok: true, value: v })),
  Err: vi.fn((e: unknown) => ({ ok: false, error: e })),
}));

vi.mock('../../src/edgeDriverManager.js', () => ({
  ensureMsEdgeDriver: vi.fn().mockResolvedValue({ ok: true, value: { method: 'found', driverVersion: '120.0.0' } }),
}));

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, execSync: vi.fn() };
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { ensureTauriDriver } from '../../src/driverManager.js';
import TauriLaunchService from '../../src/launcher.js';

const crabnebulaCapabilities = [
  {
    browserName: 'tauri',
    'tauri:options': { application: '/app/tauri-app' },
    'wdio:tauriServiceOptions': { driverProvider: 'crabnebula', crabnebulaManageBackend: false },
  },
];

describe.skipIf(process.platform !== 'darwin')('CrabNebula onPrepare (macOS)', () => {
  let launcher: TauriLaunchService;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CN_API_KEY = 'test-key-long-enough-to-pass-validation';
    vi.mocked(ensureTauriDriver).mockResolvedValue({
      ok: true,
      value: { path: mockSuccessPath, method: 'found' },
    });
  });

  afterEach(async () => {
    delete process.env.CN_API_KEY;
    if (launcher) {
      try {
        await Promise.race([
          (launcher as any).onComplete?.(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
      } catch {
        // ignore
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('should complete onPrepare without throwing when backend and driver start successfully', async () => {
    const port = await getPort({ port: 14444 });
    launcher = new TauriLaunchService(
      { driverProvider: 'crabnebula', tauriDriverPort: port },
      crabnebulaCapabilities[0] as any,
      { maxInstances: 1 },
    );

    await expect((launcher as any).onPrepare({ maxInstances: 1 }, crabnebulaCapabilities)).resolves.not.toThrow();
  });
});
