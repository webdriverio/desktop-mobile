import assert from 'node:assert';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EdgeDriverResult, ResolvedEdgeVersion, ResolveEdgeVersionOptions } from '../src/edgeDriverManager.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  exec: vi.fn(),
  execFile: vi.fn(),
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

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  chmodSync: vi.fn(),
  readdirSync: vi.fn(),
}));

describe('Edge Driver Manager', () => {
  let detectEdgeVersion: () => Promise<string | undefined>;
  let detectWebView2Version: () => Promise<string | undefined>;
  let getMajorVersion: (version: string) => string;
  let findMsEdgeDriver: () => Promise<{ path?: string; version?: string }>;
  let ensureMsEdgeDriver: (
    tauriBinaryPath?: string,
    autoDownload?: boolean,
    options?: ResolveEdgeVersionOptions,
  ) => Promise<EdgeDriverResult>;
  let downloadMsEdgeDriver: (edgeVersion: string, exactVersion?: boolean) => Promise<string>;
  let detectFixedRuntimeVersion: (folder?: string) => Promise<string | undefined>;
  let resolveTargetEdgeVersion: (options?: ResolveEdgeVersionOptions) => Promise<ResolvedEdgeVersion | undefined>;

  const originalPlatform = process.platform;

  beforeEach(async () => {
    const module = await import('../src/edgeDriverManager.js');
    detectEdgeVersion = module.detectEdgeVersion;
    detectWebView2Version = module.detectWebView2Version;
    getMajorVersion = module.getMajorVersion;
    findMsEdgeDriver = module.findMsEdgeDriver;
    ensureMsEdgeDriver = module.ensureMsEdgeDriver;
    downloadMsEdgeDriver = module.downloadMsEdgeDriver;
    detectFixedRuntimeVersion = module.detectFixedRuntimeVersion;
    resolveTargetEdgeVersion = module.resolveTargetEdgeVersion;

    vi.clearAllMocks();

    Object.defineProperty(process, 'platform', {
      value: 'win32',
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
    delete process.env.EDGEDRIVER_VERSION;
    delete process.env.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER;
  });

  describe('getMajorVersion', () => {
    it('should extract major version from full version string', () => {
      expect(getMajorVersion('143.0.3650.139')).toBe('143');
      expect(getMajorVersion('144.0.0.0')).toBe('144');
      expect(getMajorVersion('120.1.2345.67')).toBe('120');
    });

    it('should handle version with only major', () => {
      expect(getMajorVersion('143')).toBe('143');
    });
  });

  describe('detectEdgeVersion', () => {
    it('should return undefined on non-Windows platforms', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      });

      const version = await detectEdgeVersion();
      expect(version).toBeUndefined();
    });

    it('should detect Edge version from registry on Windows', async () => {
      const { exec } = await import('node:child_process');

      vi.mocked(exec as any).mockImplementation(((cmd: string, _opts: any, callback: any) => {
        if (typeof _opts === 'function') {
          callback = _opts;
        }
        if (cmd.includes('reg query') && cmd.includes('56EB18F8')) {
          callback?.(null, '    pv    REG_SZ    143.0.3650.139\n', '');
        } else {
          callback?.(new Error('Not found'), '', '');
        }
        return {} as any;
      }) as any);

      const version = await detectEdgeVersion();
      expect(version).toBe('143.0.3650.139');
    });

    it('should fall back to wmic when registry queries fail', async () => {
      const { exec } = await import('node:child_process');

      vi.mocked(exec as any).mockImplementation(((cmd: string, _opts: any, callback: any) => {
        if (typeof _opts === 'function') {
          callback = _opts;
        }
        if (cmd.includes('wmic')) {
          callback?.(null, 'Version=143.0.3650.139\n', '');
        } else {
          callback?.(new Error('Not found'), '', '');
        }
        return {} as any;
      }) as any);

      const version = await detectEdgeVersion();
      expect(version).toBe('143.0.3650.139');
    });

    it('should return undefined when all detection methods fail', async () => {
      const { exec } = await import('node:child_process');

      vi.mocked(exec as any).mockImplementation(((_cmd: string, _opts: any, callback: any) => {
        if (typeof _opts === 'function') {
          callback = _opts;
        }
        callback?.(new Error('Not found'), '', '');
        return {} as any;
      }) as any);

      const version = await detectEdgeVersion();
      expect(version).toBeUndefined();
    });
  });

  describe('detectWebView2Version', () => {
    it('should return undefined on non-Windows platforms', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      });

      const version = await detectWebView2Version();
      expect(version).toBeUndefined();
    });
  });

  describe('findMsEdgeDriver', () => {
    it('should return empty object on non-Windows', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      });

      const result = await findMsEdgeDriver();
      expect(result).toEqual({});
    });
  });

  describe('ensureMsEdgeDriver', () => {
    it('should skip on non-Windows platforms', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      });

      const result = await ensureMsEdgeDriver();
      assert(result.ok);
      expect(result.value.method).toBe('skipped');
    });

    it('should handle Edge version detection failure gracefully', async () => {
      const { exec } = await import('node:child_process');

      vi.mocked(exec as any).mockImplementation(((_cmd: string, _opts: any, callback: any) => {
        if (typeof _opts === 'function') {
          callback = _opts;
        }
        callback?.(new Error('Registry error'), '', '');
        return {} as any;
      }) as any);

      const result = await ensureMsEdgeDriver();
      assert(result.ok);
      expect(result.value.method).toBe('skipped');
    });

    it('should return found when driver version matches Edge version', async () => {
      const { exec } = await import('node:child_process');
      const { existsSync } = await import('node:fs');

      vi.mocked(exec as any).mockImplementation(((cmd: string, _opts: any, callback: any) => {
        if (typeof _opts === 'function') {
          callback = _opts;
        }
        if (cmd.includes('reg query') && cmd.includes('F3017226')) {
          callback?.(null, '    pv    REG_SZ    143.0.3650.139\n', '');
        } else if (cmd.includes('where msedgedriver')) {
          callback?.(null, 'C:\\driver\\msedgedriver.exe\n', '');
        } else if (cmd.includes('--version')) {
          callback?.(null, 'MSEdgeDriver 143.0.3650.140\n', '');
        } else {
          callback?.(new Error('Not found'), '', '');
        }
        return {} as any;
      }) as any);

      vi.mocked(existsSync).mockReturnValue(true);

      const result = await ensureMsEdgeDriver();
      assert(result.ok);
      expect(result.value.method).toBe('found');
      expect(result.value.driverVersion).toBe('143.0.3650.140');
      expect(result.value.edgeVersion).toBe('143.0.3650.139');
    });

    it('should return error when version mismatch and autoDownload is false', async () => {
      const { exec } = await import('node:child_process');
      const { existsSync } = await import('node:fs');

      vi.mocked(exec as any).mockImplementation(((cmd: string, _opts: any, callback: any) => {
        if (typeof _opts === 'function') {
          callback = _opts;
        }
        if (cmd.includes('reg query') && cmd.includes('F3017226')) {
          callback?.(null, '    pv    REG_SZ    143.0.3650.139\n', '');
        } else if (cmd.includes('where msedgedriver')) {
          callback?.(null, 'C:\\driver\\msedgedriver.exe\n', '');
        } else if (cmd.includes('--version')) {
          callback?.(null, 'MSEdgeDriver 120.0.1000.0\n', '');
        } else {
          callback?.(new Error('Not found'), '', '');
        }
        return {} as any;
      }) as any);

      vi.mocked(existsSync).mockReturnValue(true);

      const result = await ensureMsEdgeDriver(undefined, false);
      assert(!result.ok);
      expect(result.error.message).toContain('version mismatch');
    });
  });

  describe('downloadMsEdgeDriver', () => {
    it('should succeed when PowerShell download completes', async () => {
      const { execFile } = await import('node:child_process');
      const { existsSync } = await import('node:fs');

      vi.mocked(execFile as any).mockImplementation(((_cmd: string, _args: string[], _opts: any, callback: any) => {
        if (typeof _opts === 'function') {
          callback = _opts;
        }
        callback?.(null, 'SUCCESS: downloaded', '');
        return {} as any;
      }) as any);

      vi.mocked(existsSync).mockReturnValue(true);

      const result = await downloadMsEdgeDriver('143.0.3650.139');
      expect(result).toContain('msedgedriver.exe');
    });

    it('should throw when download fails', async () => {
      const { execFile } = await import('node:child_process');
      const { existsSync } = await import('node:fs');

      vi.mocked(execFile as any).mockImplementation(((_cmd: string, _args: string[], _opts: any, callback: any) => {
        if (typeof _opts === 'function') {
          callback = _opts;
        }
        callback?.(new Error('PowerShell error'), '', 'Download failed');
        return {} as any;
      }) as any);

      vi.mocked(existsSync).mockReturnValue(false);

      await expect(downloadMsEdgeDriver('143.0.3650.139')).rejects.toThrow('Failed to download msedgedriver');
    });

    it('should use the exact version (no LATEST_RELEASE remap) when exactVersion is set', async () => {
      const { execFile } = await import('node:child_process');
      const { existsSync, writeFileSync } = await import('node:fs');

      vi.mocked(execFile as any).mockImplementation(((_cmd: string, _args: string[], _opts: any, callback: any) => {
        if (typeof _opts === 'function') callback = _opts;
        callback?.(null, 'SUCCESS', '');
        return {} as any;
      }) as any);
      vi.mocked(existsSync).mockReturnValue(true);

      await downloadMsEdgeDriver('149.0.4022.98', true);

      const scriptContent = vi
        .mocked(writeFileSync)
        .mock.calls.map((call) => String(call[1]))
        .join('\n');
      expect(scriptContent).toContain("$driverVersion = '149.0.4022.98'");
    });
  });

  describe('detectFixedRuntimeVersion', () => {
    it('should return undefined on non-Windows platforms', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true, configurable: true });
      expect(await detectFixedRuntimeVersion('C:\\FixedRuntime')).toBeUndefined();
    });

    it('should return undefined when no folder is given', async () => {
      expect(await detectFixedRuntimeVersion()).toBeUndefined();
    });

    it('should read the version from msedgewebview2.exe in the folder', async () => {
      const { existsSync } = await import('node:fs');
      vi.mocked(existsSync).mockImplementation((p: any) => String(p).endsWith('msedgewebview2.exe'));
      await mockVersionInfo('149.0.4022.98');

      expect(await detectFixedRuntimeVersion('C:\\FixedRuntime')).toBe('149.0.4022.98');
    });

    it('should fall back to a versioned subdirectory when the runtime is nested', async () => {
      const { existsSync, readdirSync } = await import('node:fs');
      // Direct exe missing; a `<version>/msedgewebview2.exe` subdir exists.
      vi.mocked(existsSync).mockImplementation((p: any) => String(p).includes('149.0.4022.98'));
      vi.mocked(readdirSync as any).mockReturnValue(['not-a-version', '149.0.4022.98']);
      await mockVersionInfo('149.0.4022.98');

      expect(await detectFixedRuntimeVersion('C:\\FixedRuntime')).toBe('149.0.4022.98');
    });

    it('should pick the highest version when multiple runtime subdirectories exist', async () => {
      const { existsSync, readdirSync } = await import('node:fs');
      const { execFile } = await import('node:child_process');
      // Direct exe missing; several `<version>/msedgewebview2.exe` subdirs exist, listed out of order.
      vi.mocked(existsSync).mockImplementation((p: any) =>
        /[\\/]\d+\.\d+\.\d+\.\d+[\\/]msedgewebview2\.exe$/.test(String(p)),
      );
      vi.mocked(readdirSync as any).mockReturnValue(['149.0.4022.98', '151.0.0.0', '150.0.1.0', 'not-a-version']);
      // Echo the version embedded in the queried exe path so we can tell which subdir was chosen.
      vi.mocked(execFile as any).mockImplementation(((_cmd: string, args: string[], _opts: any, callback: any) => {
        if (typeof _opts === 'function') callback = _opts;
        const match = (Array.isArray(args) ? args.join(' ') : '').match(/(\d+\.\d+\.\d+\.\d+)/);
        callback?.(null, `${match ? match[1] : '0.0.0.0'}\n`, '');
        return {} as any;
      }) as any);

      expect(await detectFixedRuntimeVersion('C:\\FixedRuntime')).toBe('151.0.0.0');
    });

    it('should return undefined when no runtime binary is found', async () => {
      const { existsSync, readdirSync } = await import('node:fs');
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(readdirSync as any).mockReturnValue([]);

      expect(await detectFixedRuntimeVersion('C:\\FixedRuntime')).toBeUndefined();
    });
  });

  describe('resolveTargetEdgeVersion', () => {
    it('should prefer an explicit edgeDriverVersion option, used verbatim', async () => {
      expect(await resolveTargetEdgeVersion({ edgeDriverVersion: '149.0.4022.98' })).toEqual({
        version: '149.0.4022.98',
        source: 'override',
      });
    });

    it('should honour EDGEDRIVER_VERSION from the environment', async () => {
      process.env.EDGEDRIVER_VERSION = '148.0.1.2';
      expect(await resolveTargetEdgeVersion()).toEqual({ version: '148.0.1.2', source: 'override' });
    });

    it('should resolve the fixed-version runtime folder from options.env', async () => {
      const { existsSync } = await import('node:fs');
      vi.mocked(existsSync).mockImplementation((p: any) => String(p).endsWith('msedgewebview2.exe'));
      await mockVersionInfo('149.0.4022.98');

      expect(
        await resolveTargetEdgeVersion({ env: { WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: 'C:\\FixedRuntime' } }),
      ).toEqual({ version: '149.0.4022.98', source: 'fixed-runtime' });
    });

    it('should read the folder from process.env when options.env is absent', async () => {
      process.env.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = 'C:\\FixedRuntime';
      const { existsSync } = await import('node:fs');
      vi.mocked(existsSync).mockImplementation((p: any) => String(p).endsWith('msedgewebview2.exe'));
      await mockVersionInfo('149.0.4022.98');

      expect(await resolveTargetEdgeVersion()).toEqual({ version: '149.0.4022.98', source: 'fixed-runtime' });
    });

    it('should prefer options.env folder over process.env folder', async () => {
      process.env.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = 'C:\\ProcessRuntime';
      const { execFile } = await import('node:child_process');
      const { existsSync } = await import('node:fs');
      vi.mocked(existsSync).mockImplementation((p: any) => String(p).endsWith('msedgewebview2.exe'));
      vi.mocked(execFile as any).mockImplementation(((_cmd: string, args: string[], _opts: any, callback: any) => {
        if (typeof _opts === 'function') callback = _opts;
        const command = Array.isArray(args) ? args.join(' ') : '';
        if (command.includes('OptionRuntime')) callback?.(null, '149.0.4022.98\n', '');
        else if (command.includes('ProcessRuntime')) callback?.(null, '130.0.0.0\n', '');
        else callback?.(new Error('unexpected'), '', '');
        return {} as any;
      }) as any);

      expect(
        await resolveTargetEdgeVersion({ env: { WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: 'C:\\OptionRuntime' } }),
      ).toEqual({ version: '149.0.4022.98', source: 'fixed-runtime' });
    });

    it('should fall back to the Evergreen registry version when the folder is unreadable', async () => {
      process.env.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = 'C:\\Missing';
      const { existsSync, readdirSync } = await import('node:fs');
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(readdirSync as any).mockReturnValue([]);
      await mockExecRegistry('150.0.4000.0');

      expect(await resolveTargetEdgeVersion()).toEqual({ version: '150.0.4000.0', source: 'evergreen' });
    });

    it('should use the Evergreen registry version by default', async () => {
      await mockExecRegistry('150.0.4000.0');
      expect(await resolveTargetEdgeVersion()).toEqual({ version: '150.0.4000.0', source: 'evergreen' });
    });

    it('should return undefined when nothing resolves', async () => {
      const { exec } = await import('node:child_process');
      vi.mocked(exec as any).mockImplementation(((_cmd: string, _opts: any, callback: any) => {
        if (typeof _opts === 'function') callback = _opts;
        callback?.(new Error('not found'), '', '');
        return {} as any;
      }) as any);

      expect(await resolveTargetEdgeVersion()).toBeUndefined();
    });
  });

  describe('ensureMsEdgeDriver with fixed-version runtime and overrides', () => {
    it('should match the driver to the fixed-version runtime, not the registry Evergreen', async () => {
      const { exec, execFile } = await import('node:child_process');
      const { existsSync } = await import('node:fs');

      // Registry Evergreen 150, but the app is pinned to a 149 fixed runtime and a 150 driver is on
      // PATH → mismatch → download for 149 (the runtime the app actually uses).
      vi.mocked(exec as any).mockImplementation(((cmd: string, _opts: any, callback: any) => {
        if (typeof _opts === 'function') callback = _opts;
        if (cmd.includes('reg query') && cmd.includes('F3017226'))
          callback?.(null, '    pv    REG_SZ    150.0.4000.0\n', '');
        else if (cmd.includes('where msedgedriver')) callback?.(null, 'C:\\driver\\msedgedriver.exe\n', '');
        else if (cmd.includes('--version')) callback?.(null, 'MSEdgeDriver 150.0.4000.0\n', '');
        else callback?.(new Error('Not found'), '', '');
        return {} as any;
      }) as any);
      vi.mocked(execFile as any).mockImplementation(((_cmd: string, args: string[], _opts: any, callback: any) => {
        if (typeof _opts === 'function') callback = _opts;
        if (Array.isArray(args) && args.some((a) => String(a).includes('VersionInfo.FileVersion')))
          callback?.(null, '149.0.4022.98\n', '');
        else callback?.(null, 'SUCCESS', '');
        return {} as any;
      }) as any);
      vi.mocked(existsSync).mockImplementation(
        (p: any) => String(p).endsWith('msedgewebview2.exe') || String(p).endsWith('msedgedriver.exe'),
      );

      const result = await ensureMsEdgeDriver(undefined, true, {
        env: { WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: 'C:\\FixedRuntime' },
      });
      assert(result.ok);
      expect(result.value.method).toBe('downloaded');
      expect(result.value.edgeVersion).toBe('149.0.4022.98');
    });

    it('should download the exact version for an explicit edgeDriverVersion override', async () => {
      const { exec, execFile } = await import('node:child_process');
      const { existsSync } = await import('node:fs');

      vi.mocked(exec as any).mockImplementation(((_cmd: string, _opts: any, callback: any) => {
        if (typeof _opts === 'function') callback = _opts;
        callback?.(new Error('not found'), '', '');
        return {} as any;
      }) as any);
      vi.mocked(execFile as any).mockImplementation(((_cmd: string, _args: string[], _opts: any, callback: any) => {
        if (typeof _opts === 'function') callback = _opts;
        callback?.(null, 'SUCCESS', '');
        return {} as any;
      }) as any);
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await ensureMsEdgeDriver(undefined, true, { edgeDriverVersion: '149.0.4022.98' });
      assert(result.ok);
      expect(result.value.method).toBe('downloaded');
      expect(result.value.driverVersion).toBe('149.0.4022.98');
    });

    it('should download the exact pin even when a different same-major driver is on PATH', async () => {
      const { exec, execFile } = await import('node:child_process');
      const { existsSync } = await import('node:fs');

      // PATH already has a 149 driver, but the pin asks for a *different* 149 build → must not reuse it.
      vi.mocked(exec as any).mockImplementation(((cmd: string, _opts: any, callback: any) => {
        if (typeof _opts === 'function') callback = _opts;
        if (cmd.includes('where msedgedriver')) callback?.(null, 'C:\\driver\\msedgedriver.exe\n', '');
        else if (cmd.includes('--version')) callback?.(null, 'MSEdgeDriver 149.0.4022.98\n', '');
        else callback?.(new Error('Not found'), '', '');
        return {} as any;
      }) as any);
      vi.mocked(execFile as any).mockImplementation(((_cmd: string, _args: string[], _opts: any, callback: any) => {
        if (typeof _opts === 'function') callback = _opts;
        callback?.(null, 'SUCCESS', '');
        return {} as any;
      }) as any);
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await ensureMsEdgeDriver(undefined, true, { edgeDriverVersion: '149.0.4022.150' });
      assert(result.ok);
      expect(result.value.method).toBe('downloaded');
      expect(result.value.driverVersion).toBe('149.0.4022.150');
    });

    it('should reuse an on-PATH driver that already matches the exact pin', async () => {
      const { exec, execFile } = await import('node:child_process');
      const { existsSync } = await import('node:fs');

      vi.mocked(exec as any).mockImplementation(((cmd: string, _opts: any, callback: any) => {
        if (typeof _opts === 'function') callback = _opts;
        if (cmd.includes('where msedgedriver')) callback?.(null, 'C:\\driver\\msedgedriver.exe\n', '');
        else if (cmd.includes('--version')) callback?.(null, 'MSEdgeDriver 149.0.4022.98\n', '');
        else callback?.(new Error('Not found'), '', '');
        return {} as any;
      }) as any);
      vi.mocked(execFile as any).mockImplementation(((_cmd: string, _args: string[], _opts: any, callback: any) => {
        if (typeof _opts === 'function') callback = _opts;
        callback?.(null, 'SUCCESS', '');
        return {} as any;
      }) as any);
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await ensureMsEdgeDriver(undefined, true, { edgeDriverVersion: '149.0.4022.98' });
      assert(result.ok);
      expect(result.value.method).toBe('found');
      expect(result.value.driverVersion).toBe('149.0.4022.98');
    });
  });

  async function mockExecRegistry(pv: string) {
    const { exec } = await import('node:child_process');
    vi.mocked(exec as any).mockImplementation(((cmd: string, _opts: any, callback: any) => {
      if (typeof _opts === 'function') callback = _opts;
      if (cmd.includes('reg query') && cmd.includes('F3017226')) {
        callback?.(null, `    pv    REG_SZ    ${pv}\n`, '');
      } else {
        callback?.(new Error('Not found'), '', '');
      }
      return {} as any;
    }) as any);
  }

  async function mockVersionInfo(version: string) {
    const { execFile } = await import('node:child_process');
    vi.mocked(execFile as any).mockImplementation(((_cmd: string, args: string[], _opts: any, callback: any) => {
      if (typeof _opts === 'function') callback = _opts;
      if (Array.isArray(args) && args.some((a) => String(a).includes('VersionInfo.FileVersion'))) {
        callback?.(null, `${version}\n`, '');
      } else {
        callback?.(new Error('unexpected'), '', '');
      }
      return {} as any;
    }) as any);
  }
});
