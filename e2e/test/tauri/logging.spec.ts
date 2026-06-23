import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';
import { getLogDirName, readWdioLogs } from '../../lib/utils.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// PROBE (#179): the isCrabNebula skips are removed so the crabnebula provider runs the log
// assertions. A green crabnebula leg means test-runner-backend now forwards app stdout/stderr.
const driverProvider = process.env.DRIVER_PROVIDER as 'official' | 'crabnebula' | 'embedded' | undefined;

function getLogDir() {
  const logDirName = getLogDirName('standard', 'tauri', driverProvider);
  return path.join(__dirname, '..', '..', 'logs', logDirName);
}

describe('Tauri Log Integration', () => {
  describe('Command Execution', () => {
    it('should capture backend logs via generate_test_logs command', async function () {
      await browser.tauri.execute(({ core }) => core.invoke('generate_test_logs'));

      await browser.waitUntil(
        async () => {
          const logs = await readWdioLogs(getLogDir());
          // Match [Tauri:Backend] or [Tauri:Backend:worker-id] format
          return logs.includes('[Tauri:Backend');
        },
        { timeout: 5000, timeoutMsg: 'Backend logs not captured' },
      );

      const logs = await readWdioLogs(getLogDir());
      // Match [Tauri:Backend] or [Tauri:Backend:worker-id] format (with optional worker suffix)
      expect(logs).toMatch(/\[Tauri:Backend[^\]]*\].*INFO level log/s);
      expect(logs).toMatch(/\[Tauri:Backend[^\]]*\].*WARN level log/s);
      expect(logs).toMatch(/\[Tauri:Backend[^\]]*\].*ERROR level log/s);
    });

    it('should have working Tauri API', async () => {
      const result = (await browser.tauri.execute(({ core }) => core.invoke('get_platform_info'))) as { os: string };
      expect(result).toBeDefined();
      expect(result.os).toBeDefined();
    });

    it('should execute commands with parameters', async () => {
      const bounds = (await browser.tauri.execute(({ core }) => core.invoke('get_window_bounds'))) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      expect(bounds).toBeDefined();
      expect(bounds.x).toBeDefined();
      expect(bounds.y).toBeDefined();
    });
  });

  describe('Console Log Capture', () => {
    it('should capture frontend console.log from browser.execute', async function () {
      await browser.execute(() => {
        console.info('Frontend INFO from execute');
        console.warn('Frontend WARN from execute');
        console.error('Frontend ERROR from execute');
      });

      await browser.waitUntil(
        async () => {
          const logs = await readWdioLogs(getLogDir());
          return logs.includes('[Tauri:Frontend');
        },
        { timeout: 5000, timeoutMsg: 'Frontend logs not captured' },
      );

      const logs = await readWdioLogs(getLogDir());
      expect(logs).toMatch(/\[Tauri:Frontend[^\]]*\].*Frontend INFO from execute/s);
      expect(logs).toMatch(/\[Tauri:Frontend[^\]]*\].*Frontend WARN from execute/s);
      expect(logs).toMatch(/\[Tauri:Frontend[^\]]*\].*Frontend ERROR from execute/s);
    });

    it('should capture info, warn, error log levels from browser.execute', async function () {
      await browser.execute(() => {
        console.info('INFO from execute');
        console.warn('WARN from execute');
        console.error('ERROR from execute');
      });

      await browser.waitUntil(
        async () => {
          const logs = await readWdioLogs(getLogDir());
          return logs.includes('[Tauri:Frontend');
        },
        { timeout: 5000, timeoutMsg: 'Frontend logs not captured' },
      );

      const logs = await readWdioLogs(getLogDir());
      expect(logs).toMatch(/\[Tauri:Frontend[^\]]*\].*INFO from execute/s);
      expect(logs).toMatch(/\[Tauri:Frontend[^\]]*\].*WARN from execute/s);
      expect(logs).toMatch(/\[Tauri:Frontend[^\]]*\].*ERROR from execute/s);
    });

    it('should capture console.log with various message types', async function () {
      // Use console.info for reliable capture across all driver providers
      await browser.execute(() => {
        console.info('String message');
        console.info('Number: 42');
        console.info('Object: {"key":"value"}');
      });

      await browser.waitUntil(
        async () => {
          const logs = await readWdioLogs(getLogDir());
          return logs.includes('String message');
        },
        { timeout: 5000, timeoutMsg: 'Frontend logs not captured' },
      );

      const logs = await readWdioLogs(getLogDir());
      expect(logs).toMatch(/String message/);
    });
  });

  describe('Log Infrastructure', () => {
    it('should have log directory with log files', async () => {
      const logs = await readWdioLogs(getLogDir());
      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
