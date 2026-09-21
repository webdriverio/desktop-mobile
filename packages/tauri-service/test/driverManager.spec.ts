import assert from 'node:assert';
import { exec, execSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mockPlatform, restorePlatform } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureTauriDriver,
  ensureWebKitWebDriver,
  findTauriDriver,
  getWebKitDriverInstallCommand,
  installTauriDriver,
  isCargoAvailable,
} from '../src/driverManager.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  exec: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        fn(...args, (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      }),
}));

describe('WebKitWebDriver Management', () => {
  describe('getWebKitDriverInstallCommand', () => {
    it('should return correct install command for apt (Debian/Ubuntu)', () => {
      const command = getWebKitDriverInstallCommand('apt');
      expect(command).toBe('sudo apt-get install -y webkit2gtk-driver');
    });

    it('should return correct install command for dnf (Fedora)', () => {
      const command = getWebKitDriverInstallCommand('dnf');
      expect(command).toBe('sudo dnf install -y webkit2gtk-driver');
    });

    it('should return correct install command for yum (CentOS/RHEL)', () => {
      const command = getWebKitDriverInstallCommand('yum');
      expect(command).toBe('sudo yum install -y webkit2gtk-driver');
    });

    it('should return correct install command for zypper (SUSE)', () => {
      const command = getWebKitDriverInstallCommand('zypper');
      expect(command).toBe('sudo zypper install -y webkit2gtk-driver');
    });

    it('should return correct install command for pacman (Arch)', () => {
      const command = getWebKitDriverInstallCommand('pacman');
      expect(command).toBe('sudo pacman -S webkit2gtk-driver');
    });

    it('should return correct install command for apk (Alpine)', () => {
      const command = getWebKitDriverInstallCommand('apk');
      expect(command).toBe('sudo apk add webkit2gtk-driver');
    });

    it('should return correct install command for xbps (Void)', () => {
      const command = getWebKitDriverInstallCommand('xbps');
      expect(command).toBe('sudo xbps-install -y webkit2gtk-driver');
    });

    it('should default to apt for unknown package managers', () => {
      const command = getWebKitDriverInstallCommand('unknown');
      expect(command).toBe('sudo apt-get install -y webkit2gtk-driver');
    });
  });

  describe('ensureWebKitWebDriver', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('should return success on non-Linux platforms', async () => {
      mockPlatform('darwin');

      const result = await ensureWebKitWebDriver();
      assert(result.ok);

      restorePlatform();
    });

    it('should return Ok with path when WebKitWebDriver is found on Linux', async () => {
      mockPlatform('linux');

      vi.mocked(execSync).mockReturnValue('/usr/bin/WebKitWebDriver\n');
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await ensureWebKitWebDriver();

      assert(result.ok);
      expect(result.value.path).toBe('/usr/bin/WebKitWebDriver');

      restorePlatform();
    });

    it('should return Err with install instructions when not found on Linux', async () => {
      mockPlatform('linux');

      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not found');
      });
      vi.mocked(exec as any).mockImplementation((_cmd: string, callback: any) => {
        callback(new Error('not found'), '', '');
        return {} as any;
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await ensureWebKitWebDriver();

      assert(!result.ok);
      expect(result.error.message).toContain('WebKitWebDriver not found');

      restorePlatform();
    });
  });
});

describe('isCargoAvailable', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return true when cargo --version succeeds', () => {
    vi.mocked(execSync).mockReturnValue('cargo 1.75.0');
    expect(isCargoAvailable()).toBe(true);
  });

  it('should return false when cargo --version throws', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('command not found');
    });
    expect(isCargoAvailable()).toBe(false);
  });
});

describe('findTauriDriver', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    restorePlatform();
  });

  it('should return path when which command finds tauri-driver on Unix', () => {
    mockPlatform('linux');
    vi.mocked(execSync).mockReturnValue('/usr/local/bin/tauri-driver\n');
    vi.mocked(existsSync).mockReturnValue(true);

    expect(findTauriDriver()).toBe('/usr/local/bin/tauri-driver');
  });

  it('should return path when where command finds tauri-driver on Windows', () => {
    mockPlatform('win32');
    vi.mocked(execSync).mockReturnValue('C:\\Users\\user\\.cargo\\bin\\tauri-driver.exe\n');
    vi.mocked(existsSync).mockReturnValue(true);

    expect(findTauriDriver()).toBe('C:\\Users\\user\\.cargo\\bin\\tauri-driver.exe');
  });

  it('should return undefined when command throws and no common paths exist', () => {
    mockPlatform('linux');
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found');
    });
    vi.mocked(existsSync).mockReturnValue(false);

    expect(findTauriDriver()).toBeUndefined();
  });

  it('should fall back to common paths when command fails', () => {
    mockPlatform('linux');
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found');
    });
    vi.mocked(existsSync).mockImplementation((p) => {
      return p === '/usr/local/bin/tauri-driver';
    });

    expect(findTauriDriver()).toBe('/usr/local/bin/tauri-driver');
  });
});

describe('installTauriDriver', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should resolve with driver path on successful install', async () => {
    const mockProc = new EventEmitter() as any;
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();
    mockProc.stdout.on = vi.fn().mockReturnThis();
    mockProc.stderr.on = vi.fn().mockReturnThis();

    vi.mocked(spawn).mockReturnValue(mockProc);
    vi.mocked(existsSync).mockReturnValue(true);

    const promise = installTauriDriver();

    setImmediate(() => {
      mockProc.emit('close', 0);
    });

    const result = await promise;
    expect(result).toContain('tauri-driver');
  });

  it('should reject when cargo install fails with non-zero exit code', async () => {
    const mockProc = new EventEmitter() as any;
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();
    mockProc.stdout.on = vi.fn().mockReturnThis();
    mockProc.stderr.on = vi.fn().mockReturnThis();

    vi.mocked(spawn).mockReturnValue(mockProc);

    const promise = installTauriDriver();

    setImmediate(() => {
      mockProc.emit('close', 1);
    });

    await expect(promise).rejects.toThrow('cargo install failed with code 1');
  });

  it('should reject when binary not found after successful install', async () => {
    const mockProc = new EventEmitter() as any;
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();
    mockProc.stdout.on = vi.fn().mockReturnThis();
    mockProc.stderr.on = vi.fn().mockReturnThis();

    vi.mocked(spawn).mockReturnValue(mockProc);
    vi.mocked(existsSync).mockReturnValue(false);

    const promise = installTauriDriver();

    setImmediate(() => {
      mockProc.emit('close', 0);
    });

    await expect(promise).rejects.toThrow('binary not found');
  });

  it('should reject on spawn error', async () => {
    const mockProc = new EventEmitter() as any;
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();
    mockProc.stdout.on = vi.fn().mockReturnThis();
    mockProc.stderr.on = vi.fn().mockReturnThis();

    vi.mocked(spawn).mockReturnValue(mockProc);

    const promise = installTauriDriver();

    setImmediate(() => {
      mockProc.emit('error', new Error('spawn ENOENT'));
    });

    await expect(promise).rejects.toThrow('Failed to spawn cargo install');
  });
});

describe('ensureTauriDriver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restorePlatform();
  });

  describe('crabnebula provider', () => {
    it('should return Ok with custom path when crabnebulaDriverPath exists', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await ensureTauriDriver({
        driverProvider: 'crabnebula',
        crabnebulaDriverPath: '/custom/cn-driver',
      });

      assert(result.ok);
      expect(result.value.path).toBe('/custom/cn-driver');
      expect(result.value.method).toBe('found');
    });

    it('should return Err when custom crabnebulaDriverPath does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await ensureTauriDriver({
        driverProvider: 'crabnebula',
        crabnebulaDriverPath: '/missing/cn-driver',
      });

      assert(!result.ok);
      expect(result.error.message).toContain('CrabNebula driver not found');
    });

    it('should return Err when no crabnebula driver detected in node_modules', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await ensureTauriDriver({ driverProvider: 'crabnebula' });

      assert(!result.ok);
      expect(result.error.message).toContain('@crabnebula/tauri-driver not found');
    });
  });

  describe('official provider', () => {
    it('should return Ok with custom tauriDriverPath when it exists', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await ensureTauriDriver({
        tauriDriverPath: '/custom/tauri-driver',
      });

      assert(result.ok);
      expect(result.value.path).toBe('/custom/tauri-driver');
      expect(result.value.method).toBe('found');
    });

    it('should return Err when custom tauriDriverPath does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await ensureTauriDriver({
        tauriDriverPath: '/missing/tauri-driver',
      });

      assert(!result.ok);
      expect(result.error.message).toContain('tauri-driver not found at provided path');
    });

    it('should return Ok when findTauriDriver finds existing driver', async () => {
      mockPlatform('linux');
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/tauri-driver\n');
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await ensureTauriDriver({});

      assert(result.ok);
      expect(result.value.method).toBe('found');
    });

    it('should auto-install when enabled and driver not found', async () => {
      mockPlatform('linux');

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd === 'cargo --version') return 'cargo 1.75.0';
        throw new Error('not found');
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const mockProc = new EventEmitter() as any;
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.stdout.on = vi.fn().mockReturnThis();
      mockProc.stderr.on = vi.fn().mockReturnThis();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = ensureTauriDriver({ autoInstallTauriDriver: true });

      setImmediate(() => {
        vi.mocked(existsSync).mockReturnValue(true);
        mockProc.emit('close', 0);
      });

      const result = await promise;
      assert(result.ok);
      expect(result.value.method).toBe('installed');
    });

    it('should return Err when auto-install is enabled but cargo is unavailable', async () => {
      mockPlatform('linux');

      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not found');
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await ensureTauriDriver({ autoInstallTauriDriver: true });

      assert(!result.ok);
      expect(result.error.message).toContain('Rust toolchain (cargo) not found');
    });

    it('should return Err when auto-install fails', async () => {
      mockPlatform('linux');

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd === 'cargo --version') return 'cargo 1.75.0';
        throw new Error('not found');
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const mockProc = new EventEmitter() as any;
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.stdout.on = vi.fn().mockReturnThis();
      mockProc.stderr.on = vi.fn().mockReturnThis();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = ensureTauriDriver({ autoInstallTauriDriver: true });

      setImmediate(() => {
        mockProc.emit('close', 1);
      });

      const result = await promise;
      assert(!result.ok);
      expect(result.error.message).toContain('cargo install failed');
    });

    it('should return Err with install instructions when driver not found and no auto-install', async () => {
      mockPlatform('linux');

      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not found');
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await ensureTauriDriver({});

      assert(!result.ok);
      expect(result.error.message).toContain('tauri-driver not found');
      expect(result.error.message).toContain('cargo install tauri-driver');
    });
  });
});
