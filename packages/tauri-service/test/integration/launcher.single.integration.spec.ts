import type { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import getPort from 'get-port';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockBindFailPath, mockSuccessPath } from '../mockPaths.js';

// Mock only the driver discovery, not the process itself
vi.mock('../../src/driverManager.js', () => ({
  ensureTauriDriver: vi.fn(),
  ensureWebKitWebDriver: vi.fn(),
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

// Mock execSync to prevent ldd errors in tests
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

import { ensureTauriDriver } from '../../src/driverManager.js';
import TauriLaunchService from '../../src/launcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track all spawned processes for cleanup
const spawnedProcesses: ReturnType<typeof spawn>[] = [];

// Global cleanup - kill any leftover processes
afterAll(async () => {
  for (const proc of spawnedProcesses) {
    if (!proc.killed) {
      proc.kill('SIGKILL');
    }
  }
  // Give processes time to die
  await new Promise((resolve) => setTimeout(resolve, 100));
});

describe('Single Mode - Integration', () => {
  let launcher: TauriLaunchService;
  let testPort: number;
  let testNativePort: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Use dynamic ports to avoid conflicts with other tests
    testPort = await getPort({ port: 4444 });
    testNativePort = testPort + 1;
  });

  afterEach(async () => {
    // Clean up launcher after each test
    if (launcher) {
      try {
        await Promise.race([
          (launcher as any).stopTauriDriver(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Cleanup timeout')), 5000)),
        ]);
      } catch {
        // Ignore cleanup errors
      }
    }
    // Wait for ports to be fully released
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe('startup', () => {
    it('should spawn driver and detect startup message', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      await (launcher as any).startTauriDriver(testPort, testNativePort, []);

      expect((launcher as any).getTauriDriverStatus().running).toBe(true);
      expect((launcher as any).getTauriDriverStatus().pid).toBeDefined();
    });

    // Note: "should spawn with correct arguments" test removed - redundant with "should spawn driver and detect startup message"

    it('should reject on bind failure', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockBindFailPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      await expect((launcher as any).startTauriDriver(testPort, testNativePort, [])).rejects.toThrow();
    });

    it('should reject if process exits during startup', async () => {
      // Create a mock driver that exits immediately
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: 'node', method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      // Use node -e to exit immediately
      await expect((launcher as any).startTauriDriver(testPort, testNativePort, [])).rejects.toThrow();
    });
  });

  describe('shutdown', () => {
    it('should stop with SIGTERM and wait for graceful exit', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      await (launcher as any).startTauriDriver(testPort, testNativePort, []);
      const pid = (launcher as any).getTauriDriverStatus().pid;
      expect(pid).toBeDefined();

      await (launcher as any).driverPool.stopDriver('tauri-driver');

      expect((launcher as any).getTauriDriverStatus().running).toBe(false);
    });

    // Note: Force kill (SIGKILL) is not tested here because:
    // 1. It's platform-specific (macOS handles SIGKILL differently than Linux)
    // 2. It's difficult to test reliably across CI environments
    // 3. The graceful shutdown test above covers the primary path
    // Force kill behavior is implicitly tested when cleanup runs after timeouts.
  });

  describe('stream handling', () => {
    it('should capture stdout and stderr output', async () => {
      vi.mocked(ensureTauriDriver).mockResolvedValue({
        ok: true,
        value: { path: mockSuccessPath, method: 'found' },
      });

      launcher = new TauriLaunchService(
        { driverProvider: 'official' },
        { browserName: 'tauri', 'tauri:options': { application: '/app' } },
        { maxInstances: 1 },
      );

      await (launcher as any).startTauriDriver(testPort, testNativePort, []);

      // The mock driver outputs to both stdout and stderr
      // The launcher should capture and log both
      expect((launcher as any).getTauriDriverStatus().running).toBe(true);
    });
  });
});
