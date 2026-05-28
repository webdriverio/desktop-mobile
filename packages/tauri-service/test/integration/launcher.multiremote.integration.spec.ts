import type { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TauriCapabilities } from '../../src/types.js';

// Mock CrabNebula backend functions
vi.mock('../../src/crabnebulaBackend.js', () => ({
  startTestRunnerBackend: vi.fn().mockResolvedValue({
    proc: {
      kill: vi.fn(),
      killed: false,
      stdout: { on: vi.fn(), pipe: vi.fn() },
      stderr: { on: vi.fn() },
    },
    port: 3000,
  }),
  waitTestRunnerBackendReady: vi.fn().mockResolvedValue(undefined),
  stopTestRunnerBackend: vi.fn().mockResolvedValue(undefined),
}));

// Mock driver discovery
vi.mock('../../src/driverManager.js', () => ({
  ensureTauriDriver: vi.fn(),
  ensureWebKitWebDriver: vi.fn().mockResolvedValue({
    ok: true,
    value: { path: '/usr/bin/WebKitWebDriver' },
  }),
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
  ensureMsEdgeDriver: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      method: 'found',
      driverVersion: '120.0.0',
    },
  }),
}));

// Mock fs.existsSync to always return true for app binaries
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

// Mock execSync to prevent ldd errors in tests
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

import {
  startTestRunnerBackend,
  stopTestRunnerBackend,
  waitTestRunnerBackendReady,
} from '../../src/crabnebulaBackend.js';
import { ensureTauriDriver } from '../../src/driverManager.js';
import TauriLaunchService from '../../src/launcher.js';
import { mockSuccessPath } from '../mockPaths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track all spawned processes for cleanup
const spawnedProcesses: ReturnType<typeof spawn>[] = [];

// Global cleanup
afterAll(async () => {
  for (const proc of spawnedProcesses) {
    if (!proc.killed) {
      proc.kill('SIGKILL');
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
});

describe('Multiremote Mode - Integration', () => {
  let launcher: TauriLaunchService;

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (launcher) {
      try {
        await Promise.race([
          (launcher as any).onComplete?.(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Cleanup timeout')), 10000)),
        ]);
      } catch {
        // Ignore cleanup errors
      }
    }
    // Wait for ports to be fully released
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  describe('instance spawning', () => {
    it('should spawn separate driver per multiremote instance', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 }, // Multiremote doesn't need maxInstances > 1
      );

      // Multiremote capabilities structure
      const capabilities = {
        browserA: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
        browserB: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
      };

      // Simulate onPrepare (this spawns drivers for multiremote)
      await (launcher as any).onPrepare({}, capabilities);

      // Verify at least one driver is running
      expect((launcher as any).getTauriDriverStatus().running).toBe(true);
    });

    it('should allocate unique ports for each instance', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      const capabilities = {
        browserA: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        } as { capabilities: TauriCapabilities; port?: number },
        browserB: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        } as { capabilities: TauriCapabilities; port?: number },
      };

      await (launcher as any).onPrepare({}, capabilities);

      // Verify ports are unique (set on the entry object, not inside capabilities)
      const portA = capabilities.browserA.port;
      const portB = capabilities.browserB.port;

      expect(portA).toBeDefined();
      expect(portB).toBeDefined();
      expect(portA).not.toBe(portB);
      expect(portA).toBeGreaterThan(0);
      expect(portB).toBeGreaterThan(0);
    });

    it('should update capabilities with correct ports and hostname', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      const capabilities = {
        browserA: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        } as { capabilities: TauriCapabilities; port?: number; hostname?: string },
      };

      await (launcher as any).onPrepare({}, capabilities);

      // Verify port and hostname are set on the entry object
      expect(capabilities.browserA.port).toBeDefined();
      expect(capabilities.browserA.hostname).toBe('127.0.0.1');
    });
  });

  describe('instance isolation', () => {
    it('should stop correct instance without affecting others', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      const capabilities = {
        browserA: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
        browserB: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
      };

      await (launcher as any).onPrepare({}, capabilities);

      // Stop one instance
      await (launcher as any).stopTauriDriverForInstance?.('browserA');

      // Other instance should still be running
      expect((launcher as any).getTauriDriverStatus().running).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should handle instance-specific data directories', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      const capabilities = {
        browserA: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
            'wdio:tauriServiceOptions': {
              env: { XDG_DATA_HOME: '/tmp/browserA-data' },
            },
          } as TauriCapabilities,
        },
        browserB: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
            'wdio:tauriServiceOptions': {
              env: { XDG_DATA_HOME: '/tmp/browserB-data' },
            },
          } as TauriCapabilities,
        },
      };

      // Should not throw when starting with different data directories
      await expect((launcher as any).onPrepare({}, capabilities)).resolves.not.toThrow();
    });

    it('should cleanup all instances in onComplete', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      const capabilities = {
        browserA: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
        browserB: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
      };

      await (launcher as any).onPrepare({}, capabilities);

      // onComplete should clean up all instances without errors
      await expect((launcher as any).onComplete?.()).resolves.not.toThrow();
    });

    it('should handle instance start failures gracefully', async () => {
      // Use a driver that will fail to start
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: 'node', method: 'found' }, // This will exit immediately
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      const capabilities = {
        browserA: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
      };

      // Should reject when driver fails to start
      await expect((launcher as any).onPrepare({}, capabilities)).rejects.toThrow();
    });
  });

  describe('provider configuration', () => {
    it('should default to embedded provider when no driverProvider is set', async () => {
      launcher = new TauriLaunchService(
        { startTimeout: 5000 },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      const capabilities = {
        browserA: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
      };

      await expect((launcher as any).onPrepare({}, capabilities)).rejects.toThrow();
    });

    it('should use official provider when explicitly set', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      const capabilities = {
        browserA: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
      };

      await (launcher as any).onPrepare({}, capabilities);

      expect((launcher as any).getTauriDriverStatus().running).toBe(true);
    });
  });

  describe('CrabNebula provider', () => {
    beforeEach(() => {
      // Set required env var for CrabNebula
      process.env.CN_API_KEY = 'test-api-key';
    });

    afterEach(() => {
      delete process.env.CN_API_KEY;
    });

    it.skipIf(process.platform !== 'darwin')(
      'should spawn separate test-runner-backend per multiremote instance',
      async () => {
        vi.mocked(ensureTauriDriver).mockResolvedValue({
          ok: true,
          value: { path: mockSuccessPath, method: 'found' },
        });

        launcher = new TauriLaunchService(
          { driverProvider: 'crabnebula', crabnebulaManageBackend: false },
          { browserName: 'tauri', 'tauri:options': { application: '/app' } },
          { maxInstances: 1 },
        );

        const capabilities = {
          browserA: {
            capabilities: {
              browserName: 'tauri',
              'tauri:options': { application: '/app' },
            } as TauriCapabilities,
          },
          browserB: {
            capabilities: {
              browserName: 'tauri',
              'tauri:options': { application: '/app' },
            } as TauriCapabilities,
          },
        };

        await (launcher as any).onPrepare({}, capabilities);

        // Verify test-runner-backend was called for each instance
        expect(startTestRunnerBackend).toHaveBeenCalledTimes(2);
      },
    );

    it.skipIf(process.platform !== 'darwin')(
      'should allocate unique ports for each CrabNebula backend instance',
      async () => {
        vi.mocked(ensureTauriDriver).mockResolvedValue({
          ok: true,
          value: { path: mockSuccessPath, method: 'found' },
        });

        launcher = new TauriLaunchService(
          { driverProvider: 'crabnebula', crabnebulaManageBackend: false },
          { browserName: 'tauri', 'tauri:options': { application: '/app' } },
          { maxInstances: 1 },
        );

        const capabilities = {
          browserA: {
            capabilities: {
              browserName: 'tauri',
              'tauri:options': { application: '/app' },
            } as TauriCapabilities,
          } as { capabilities: TauriCapabilities; port?: number },
          browserB: {
            capabilities: {
              browserName: 'tauri',
              'tauri:options': { application: '/app' },
            } as TauriCapabilities,
          } as { capabilities: TauriCapabilities; port?: number },
        };

        await (launcher as any).onPrepare({}, capabilities);

        // Verify ports are unique
        const portA = capabilities.browserA.port;
        const portB = capabilities.browserB.port;

        expect(portA).toBeDefined();
        expect(portB).toBeDefined();
        expect(portA).not.toBe(portB);
        expect(portA).toBeGreaterThan(0);
        expect(portB).toBeGreaterThan(0);
      },
    );

    it.skipIf(process.platform !== 'darwin')('should update capabilities with correct ports and hostname', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'crabnebula', crabnebulaManageBackend: false },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      const capabilities = {
        browserA: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        } as { capabilities: TauriCapabilities; port?: number; hostname?: string },
      };

      await (launcher as any).onPrepare({}, capabilities);

      // Verify port and hostname are set
      expect(capabilities.browserA.port).toBeDefined();
      expect(capabilities.browserA.hostname).toBe('127.0.0.1');
    });

    it.skipIf(process.platform !== 'darwin')('should call waitTestRunnerBackendReady for each instance', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'crabnebula', crabnebulaManageBackend: false },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      const capabilities = {
        browserA: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
        browserB: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
      };

      await (launcher as any).onPrepare({}, capabilities);

      // Verify wait was called for each backend
      expect(waitTestRunnerBackendReady).toHaveBeenCalledTimes(2);
    });

    it.skipIf(process.platform !== 'darwin')('should cleanup all CrabNebula backends in onComplete', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'crabnebula', crabnebulaManageBackend: false },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      const capabilities = {
        browserA: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
        browserB: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
      };

      await (launcher as any).onPrepare({}, capabilities);

      // onComplete should clean up all backends
      await expect((launcher as any).onComplete?.()).resolves.not.toThrow();

      // Verify stop was called for each backend
      expect(stopTestRunnerBackend).toHaveBeenCalledTimes(2);
    });

    it.skipIf(process.platform !== 'darwin')(
      'should cycle backends and drivers between workers in onWorkerEnd',
      async () => {
        vi.mocked(ensureTauriDriver).mockResolvedValue({
          ok: true,
          value: { path: mockSuccessPath, method: 'found' },
        });

        launcher = new TauriLaunchService(
          { driverProvider: 'crabnebula', crabnebulaManageBackend: false },
          { browserName: 'tauri', 'tauri:options': { application: '/app' } },
          { maxInstances: 1 },
        );

        const capabilities = {
          browserA: {
            capabilities: {
              browserName: 'tauri',
              'tauri:options': { application: '/app' },
            } as TauriCapabilities,
          },
          browserB: {
            capabilities: {
              browserName: 'tauri',
              'tauri:options': { application: '/app' },
            } as TauriCapabilities,
          },
        };

        await (launcher as any).onPrepare({}, capabilities);

        // onPrepare starts 2 backends
        expect(startTestRunnerBackend).toHaveBeenCalledTimes(2);
        expect(waitTestRunnerBackendReady).toHaveBeenCalledTimes(2);

        vi.mocked(startTestRunnerBackend).mockClear();
        vi.mocked(waitTestRunnerBackendReady).mockClear();
        vi.mocked(stopTestRunnerBackend).mockClear();

        // onWorkerEnd should cycle: stop 2 backends + restart 2 backends
        await (launcher as any).onWorkerEnd('0-0');

        expect(stopTestRunnerBackend).toHaveBeenCalledTimes(2);
        expect(startTestRunnerBackend).toHaveBeenCalledTimes(2);
        expect(waitTestRunnerBackendReady).toHaveBeenCalledTimes(2);
      },
    );

    it('should not cycle infrastructure on non-CrabNebula multiremote', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      const capabilities = {
        browserA: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
        browserB: {
          capabilities: {
            browserName: 'tauri',
            'tauri:options': { application: '/app' },
          } as TauriCapabilities,
        },
      };

      await (launcher as any).onPrepare({}, capabilities);

      vi.mocked(startTestRunnerBackend).mockClear();
      vi.mocked(stopTestRunnerBackend).mockClear();

      // onWorkerEnd should NOT cycle for non-CrabNebula
      await (launcher as any).onWorkerEnd('0-0');

      expect(stopTestRunnerBackend).not.toHaveBeenCalled();
      expect(startTestRunnerBackend).not.toHaveBeenCalled();
    });
  });
});
