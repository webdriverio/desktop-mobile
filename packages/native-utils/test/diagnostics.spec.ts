import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagnoseBinary, diagnoseLinuxDependencies, type LinuxLibrary } from '../src/diagnostics.js';

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return { ...actual, statSync: vi.fn() };
});

vi.mock('node:child_process', async (importActual) => {
  const actual = await importActual<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn() };
});

vi.mock('../src/log.js', () => import('./__mock__/log.js'));

const setPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

const setArch = (arch: NodeJS.Architecture): void => {
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
};

const stubMode = (mode: number, size = 100 * 1024 * 1024): void => {
  vi.mocked(statSync).mockReturnValue({ mode, size } as unknown as ReturnType<typeof statSync>);
};

const binaryPermissions = (path: string) => diagnoseBinary(path).find((r) => r.category === 'Binary Permissions');

describe('diagnoseBinary', () => {
  const realPlatform = process.platform;

  afterEach(() => {
    setPlatform(realPlatform);
    vi.clearAllMocks();
  });

  it('should not flag a Windows binary as non-executable — the Unix execute bit is meaningless there', () => {
    setPlatform('win32');
    stubMode(0o666); // what Windows reports for an .exe — rw-rw-rw-, no execute bit
    const perms = binaryPermissions('C:/app/app.exe');
    expect(perms?.status).toBe('ok');
    expect(perms?.details).toMatch(/Windows/);
  });

  it('should flag a non-executable binary on Unix (mode 644)', () => {
    setPlatform('darwin');
    stubMode(0o644);
    expect(binaryPermissions('/app/app')?.status).toBe('error');
  });

  it('should accept an executable binary on Unix (mode 755)', () => {
    setPlatform('darwin');
    stubMode(0o755);
    expect(binaryPermissions('/app/app')?.status).toBe('ok');
  });
});

const LIBS: LinuxLibrary[] = [
  { soname: 'libgtk-3.so.0', aptPackage: 'libgtk-3-0' },
  { soname: 'libcups.so.2', aptPackage: 'libcups2' },
  { soname: 'libnss3.so', aptPackage: 'libnss3' },
];

// Mimic `ldconfig -p` output.
const ldconfigCache = (sonames: string[], archTag = 'x86-64'): string =>
  [
    `${sonames.length} libs found in the cache \`/etc/ld.so.cache'`,
    ...sonames.map((s) => `\t${s} (libc6,${archTag}) => /usr/lib/${archTag}-linux-gnu/${s}`),
  ].join('\n');

const linuxDeps = (libs: LinuxLibrary[]) =>
  diagnoseLinuxDependencies(libs).find((r) => r.category === 'Linux Dependencies');

describe('diagnoseLinuxDependencies', () => {
  const realPlatform = process.platform;
  const realArch = process.arch;

  beforeEach(() => {
    setPlatform('linux');
    setArch('x64');
  });

  afterEach(() => {
    setPlatform(realPlatform);
    setArch(realArch);
    vi.clearAllMocks();
  });

  it('should return nothing on non-Linux platforms', () => {
    setPlatform('darwin');
    expect(diagnoseLinuxDependencies(LIBS)).toEqual([]);
  });

  it('should report ok when every soname resolves in the ldconfig cache', () => {
    vi.mocked(execFileSync).mockReturnValue(ldconfigCache(LIBS.map((l) => l.soname)));
    expect(linuxDeps(LIBS)?.status).toBe('ok');
  });

  it('should not false-warn on the Debian/Ubuntu t64 package rename', () => {
    // Package is libcups2t64, but the soname libcups.so.2 is unchanged, so it's still cached.
    vi.mocked(execFileSync).mockReturnValue(ldconfigCache(LIBS.map((l) => l.soname)));
    expect(linuxDeps(LIBS)?.status).toBe('ok');
  });

  it('should warn and name the missing soname and its apt package', () => {
    vi.mocked(execFileSync).mockReturnValue(ldconfigCache(['libgtk-3.so.0', 'libnss3.so']));
    const result = linuxDeps(LIBS);
    expect(result?.status).toBe('warn');
    expect(result?.message).toBe('1 library may be missing');
    expect(result?.details).toContain('libcups.so.2');
    expect(result?.details).toContain('libcups2');
  });

  it('should skip instead of false-warning when ldconfig is unavailable (musl/minimal images)', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw Object.assign(new Error('spawn ldconfig ENOENT'), { code: 'ENOENT' });
    });
    const result = linuxDeps(LIBS);
    expect(result?.status).toBe('ok');
    expect(result?.message).toMatch(/skipped/i);
  });

  it('should fall back to an absolute ldconfig path when it is not on PATH', () => {
    vi.mocked(execFileSync).mockImplementation((bin) => {
      if (bin === 'ldconfig') {
        throw Object.assign(new Error('spawn ldconfig ENOENT'), { code: 'ENOENT' });
      }
      return ldconfigCache(LIBS.map((l) => l.soname));
    });
    expect(linuxDeps(LIBS)?.status).toBe('ok');
  });

  it('should not count a library present only for a foreign architecture as found', () => {
    // In the cache but tagged aarch64 only — an x64 binary can't load them.
    vi.mocked(execFileSync).mockReturnValue(
      ldconfigCache(
        LIBS.map((l) => l.soname),
        'aarch64',
      ),
    );
    const result = linuxDeps(LIBS);
    expect(result?.status).toBe('warn');
    expect(result?.details).toContain('libcups.so.2');
  });

  it('should warn (not ok) when ldconfig is present but fails to run', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw Object.assign(new Error('spawnSync /usr/sbin/ldconfig ETIMEDOUT'), { code: 'ETIMEDOUT' });
    });
    const result = linuxDeps(LIBS);
    expect(result?.status).toBe('warn');
    expect(result?.message).toMatch(/could not check/i);
  });
});
