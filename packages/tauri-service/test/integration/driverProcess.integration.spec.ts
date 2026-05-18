import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverProcess } from '../../src/driverProcess.js';
import type { TauriServiceOptions } from '../../src/types.js';
import { mockMarkerOnlyPath, mockSuccessPath } from '../mockPaths.js';

// Mock execSync to prevent ldd errors in tests
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track all DriverProcess instances for cleanup
const driverProcesses: DriverProcess[] = [];

// Global cleanup
afterAll(async () => {
  for (const driver of driverProcesses) {
    try {
      if (driver.isRunning()) {
        await driver.stop();
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}, 20000);

describe('DriverProcess - Integration', () => {
  let driver: DriverProcess;
  const testPort = 4444;
  const testNativePort = 4445;
  const baseOptions: TauriServiceOptions = {
    captureBackendLogs: false,
    captureFrontendLogs: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new DriverProcess();
    driverProcesses.push(driver);
  });

  afterEach(async () => {
    try {
      // Only stop if driver was started
      if (driver.isRunning()) {
        await driver.stop();
      }
    } catch {
      // Ignore errors during cleanup
    }
    // Remove from tracking
    const index = driverProcesses.indexOf(driver);
    if (index > -1) {
      driverProcesses.splice(index, 1);
    }
  }, 10000);

  describe('startup', () => {
    it('should start driver and detect startup message', async () => {
      const info = await driver.start({
        mode: 'single',
        identifier: 'test-driver',
        port: testPort,
        nativePort: testNativePort,
        tauriDriverPath: mockSuccessPath,
        options: baseOptions,
      });

      expect(info.proc.pid).toBeDefined();
      expect(driver.isRunning()).toBe(true);
      expect(driver.port).toBe(testPort);
      expect(driver.nativePort).toBe(testNativePort);
    });

    it('should resolve via the startupMarker fast-path before the TCP/HTTP poll completes', async () => {
      // mock-marker-only emits 'tauri-driver started' but never binds to a port.
      // The TCP/HTTP poll loop would therefore time out at 10s; if start() returns
      // quickly anyway, it can only have resolved through the startupMarker path.
      const start = Date.now();
      const info = await driver.start({
        mode: 'single',
        identifier: 'marker-fast-path',
        port: testPort,
        nativePort: testNativePort,
        tauriDriverPath: mockMarkerOnlyPath,
        options: baseOptions,
      });
      const elapsed = Date.now() - start;

      expect(info.proc.pid).toBeDefined();
      expect(elapsed).toBeLessThan(2000);
    });

    // Note: Error path tests (bind failure, process exit, timeout) are covered in launcher tests.
    // DriverProcess error handling is implicitly tested through the launcher integration tests.
  });

  describe('shutdown', () => {
    it('should stop with SIGTERM and wait for graceful exit', async () => {
      await driver.start({
        mode: 'single',
        identifier: 'test-driver',
        port: testPort,
        nativePort: testNativePort,
        tauriDriverPath: mockSuccessPath,
        options: baseOptions,
      });

      expect(driver.isRunning()).toBe(true);

      await driver.stop();

      expect(driver.isRunning()).toBe(false);
      // Note: driver.proc may still hold a reference to the dead process object
      // The important thing is isRunning() returns false
    });

    it('should be safe to call stop multiple times', async () => {
      await driver.start({
        mode: 'single',
        identifier: 'test-driver',
        port: testPort,
        nativePort: testNativePort,
        tauriDriverPath: mockSuccessPath,
        options: baseOptions,
      });

      await driver.stop();
      await driver.stop(); // Should not throw
      await driver.stop(); // Should not throw

      expect(driver.isRunning()).toBe(false);
    });

    it('should not hang when stop() is called after the driver has exited naturally', async () => {
      // Regression: ChildProcess.killed is only true after subprocess.kill().
      // A process that exits naturally (crash, normal exit) has killed=false
      // but exitCode/signalCode set, so the old .killed-only guard fell through
      // to SIGTERM + waitForExit(), where the 'once exit' listener never fired
      // (the event was already dispatched) and the 10-15s timeout chain ran.
      await driver.start({
        mode: 'single',
        identifier: 'test-driver',
        port: testPort,
        nativePort: testNativePort,
        tauriDriverPath: mockSuccessPath,
        options: baseOptions,
      });

      const proc = driver.proc;
      expect(proc?.pid).toBeDefined();

      // Kill via process.kill() so the wrapper's `.killed` stays false but
      // the OS-level process actually dies (mimics a natural exit/crash).
      process.kill(proc!.pid!, 'SIGKILL');
      await new Promise<void>((resolve) => proc!.once('exit', () => resolve()));

      expect(proc!.killed).toBe(false);
      expect(proc!.exitCode !== null || proc!.signalCode !== null).toBe(true);

      const start = Date.now();
      await driver.stop();
      const elapsed = Date.now() - start;

      // Without the fix this would be ≥ stopTimeout (5s local, 10s CI) + 5s SIGKILL grace.
      // Allow generous headroom for the 500ms post-cleanup port-release sleep + CI slack.
      expect(elapsed).toBeLessThan(2000);
      expect(driver.isRunning()).toBe(false);
    });

    // Note: Force kill (SIGKILL) is not tested here because:
    // 1. It's platform-specific (macOS handles SIGKILL differently than Linux)
    // 2. It's tested implicitly when cleanup runs after test timeouts
  });

  describe('state management', () => {
    it('should track running state correctly', async () => {
      expect(driver.isRunning()).toBe(false);

      await driver.start({
        mode: 'single',
        identifier: 'test-driver',
        port: testPort,
        nativePort: testNativePort,
        tauriDriverPath: mockSuccessPath,
        options: baseOptions,
      });

      expect(driver.isRunning()).toBe(true);

      await driver.stop();

      expect(driver.isRunning()).toBe(false);
    });

    it('should provide access to process info', async () => {
      await driver.start({
        mode: 'single',
        identifier: 'test-driver',
        port: testPort,
        nativePort: testNativePort,
        tauriDriverPath: mockSuccessPath,
        options: baseOptions,
      });

      expect(driver.proc).toBeDefined();
      expect(driver.proc?.pid).toBeGreaterThan(0);
      expect(driver.port).toBe(testPort);
      expect(driver.nativePort).toBe(testNativePort);
    });
  });

  describe('multiple instances', () => {
    it('should manage multiple drivers independently', async () => {
      const driver2 = new DriverProcess();
      driverProcesses.push(driver2);

      // Start both drivers on different ports
      const info1 = await driver.start({
        mode: 'single',
        identifier: 'driver-1',
        port: 4500,
        nativePort: 4501,
        tauriDriverPath: mockSuccessPath,
        options: baseOptions,
      });

      const info2 = await driver2.start({
        mode: 'single',
        identifier: 'driver-2',
        port: 4502,
        nativePort: 4503,
        tauriDriverPath: mockSuccessPath,
        options: baseOptions,
      });

      // Both should be running
      expect(driver.isRunning()).toBe(true);
      expect(driver2.isRunning()).toBe(true);

      // Different PIDs
      expect(info1.proc.pid).not.toBe(info2.proc.pid);

      // Stop first driver
      await driver.stop();
      expect(driver.isRunning()).toBe(false);
      expect(driver2.isRunning()).toBe(true);

      // Stop second driver
      await driver2.stop();
      expect(driver2.isRunning()).toBe(false);
    });
  });

  describe('environment inheritance', () => {
    it('should inherit process.env and merge with custom env', async () => {
      const driver2 = new DriverProcess();
      driverProcesses.push(driver2);

      const originalDisplay = process.env.DISPLAY;
      process.env.DISPLAY = ':99';

      try {
        await driver2.start({
          mode: 'single',
          identifier: 'env-test',
          port: 4600,
          nativePort: 4601,
          tauriDriverPath: mockSuccessPath,
          options: baseOptions,
          env: { CUSTOM_VAR: 'custom_value' },
        });

        expect(driver2.isRunning()).toBe(true);
      } finally {
        process.env.DISPLAY = originalDisplay;
      }
    });

    it('should inherit process.env when no custom env provided', async () => {
      const driver2 = new DriverProcess();
      driverProcesses.push(driver2);

      const originalDisplay = process.env.DISPLAY;
      process.env.DISPLAY = ':99';

      try {
        await driver2.start({
          mode: 'single',
          identifier: 'no-custom-env',
          port: 4602,
          nativePort: 4603,
          tauriDriverPath: mockSuccessPath,
          options: baseOptions,
        });

        expect(driver2.isRunning()).toBe(true);
      } finally {
        process.env.DISPLAY = originalDisplay;
      }
    });
  });
});
