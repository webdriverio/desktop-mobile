import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { createLogger } from './log.js';

const log = createLogger('diagnostics');

export interface DiagnosticResult {
  category: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  details?: string;
}

export function diagnosePlatform(): DiagnosticResult[] {
  return [
    {
      category: 'Platform',
      status: 'ok',
      message: `${process.platform} ${process.arch}`,
    },
    {
      category: 'Node Version',
      status: 'ok',
      message: process.version,
    },
  ];
}

export function diagnoseDisplay(): DiagnosticResult[] {
  if (process.platform !== 'linux') {
    return [];
  }

  return [
    {
      category: 'Display',
      status: process.env.DISPLAY ? 'ok' : 'warn',
      message: process.env.DISPLAY || 'not set',
      details: process.env.DISPLAY
        ? undefined
        : 'DISPLAY not set. GUI tests may fail. Consider using Xvfb for headless testing.',
    },
  ];
}

export function diagnoseBinary(binaryPath: string): DiagnosticResult[] {
  const results: DiagnosticResult[] = [];

  try {
    const stats = statSync(binaryPath);
    const mode = (stats.mode & 0o777).toString(8);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    // The Unix execute bit (0o111) is meaningless on Windows — `fs.stat` reports `0o666`
    // there whether or not the binary is runnable, so the check would false-error.
    if (process.platform === 'win32') {
      results.push({
        category: 'Binary Permissions',
        status: 'ok',
        message: mode,
        details: 'Executability is not gated by file mode on Windows.',
      });
    } else {
      const isExecutable = (stats.mode & 0o111) !== 0;
      results.push({
        category: 'Binary Permissions',
        status: isExecutable ? 'ok' : 'error',
        message: mode,
        details: isExecutable ? 'Binary is executable' : 'Binary is not executable. Run chmod +x on Unix systems.',
      });
    }

    results.push({
      category: 'Binary Size',
      status: 'ok',
      message: `${sizeMB} MB`,
    });

    if (process.platform === 'linux') {
      results.push(...diagnoseSharedLibraries(binaryPath));
    }
  } catch (error) {
    results.push({
      category: 'Binary',
      status: 'error',
      message: `Failed to stat binary: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return results;
}

export function diagnoseSharedLibraries(binaryPath: string): DiagnosticResult[] {
  const results: DiagnosticResult[] = [];

  try {
    const lddOutput = execFileSync('ldd', [binaryPath], { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
    const missing = lddOutput.split('\n').filter((line) => line.includes('not found'));

    if (missing.length > 0) {
      results.push({
        category: 'Shared Libraries',
        status: 'error',
        message: `${missing.length} missing libraries`,
        details: missing.map((l) => l.trim()).join('\n'),
      });
    } else {
      results.push({
        category: 'Shared Libraries',
        status: 'ok',
        message: 'All shared libraries found',
      });
    }

    const webkitLibs = lddOutput.split('\n').filter((line) => line.includes('webkit'));
    if (webkitLibs.length > 0) {
      results.push({
        category: 'WebKit Libraries',
        status: 'ok',
        message: `${webkitLibs.length} WebKit libraries found`,
        details: webkitLibs.map((l) => l.trim()).join('\n'),
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
      results.push({
        category: 'Shared Libraries',
        status: 'warn',
        message: 'ldd command not available - skipping check',
      });
    } else {
      results.push({
        category: 'Shared Libraries',
        status: 'warn',
        message: `Could not check: ${errorMessage}`,
      });
    }
  }

  return results;
}

/**
 * A shared library the app needs. We check sonames, not package names, because
 * sonames work across distros and don't drift the way package names do (see
 * https://github.com/webdriverio/desktop-mobile/issues/617). `aptPackage` is
 * only for the Debian/Ubuntu install hint.
 */
export interface LinuxLibrary {
  soname: string;
  aptPackage: string;
}

// `ldconfig` lives in /sbin or /usr/sbin (often off a non-root PATH) on
// Debian/Ubuntu/Fedora and in /usr/bin on usr-merged Arch/Void.
const LDCONFIG_CANDIDATES = ['ldconfig', '/usr/sbin/ldconfig', '/sbin/ldconfig'];

// A cache entry: `<soname> (<abi tags>) => <path>`, e.g.
// `libcups.so.2 (libc6,x86-64) => /usr/lib/x86_64-linux-gnu/libcups.so.2`.
const LDCONFIG_ENTRY = /^(\S+\.so\S*)\s+\(([^)]*)\)/;

/**
 * The `ldconfig` ABI tag for the running architecture, or `undefined` when we
 * don't map it. Used to ignore libraries present only for a *foreign*
 * architecture on a multiarch host — those can't be loaded by the app's native
 * binary. Only the architectures we ship on are mapped; on anything else we
 * don't filter, so an unrecognised tag can never turn an installed library into
 * a false "missing".
 */
function hostArchTag(): string | undefined {
  const tags: Partial<Record<NodeJS.Architecture, string>> = { x64: 'x86-64', arm64: 'aarch64' };
  return tags[process.arch];
}

type LibraryCache =
  | { status: 'ok'; sonames: Set<string> }
  | { status: 'unavailable' } // no `ldconfig` binary found
  | { status: 'error'; message: string }; // `ldconfig` present but failed to run

function readSharedLibraryCache(): LibraryCache {
  const archTag = hostArchTag();
  let operationalError: string | undefined;

  for (const bin of LDCONFIG_CANDIDATES) {
    try {
      const output = execFileSync(bin, ['-p'], {
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const sonames = new Set<string>();
      for (const line of output.split('\n')) {
        const match = line.trim().match(LDCONFIG_ENTRY);
        if (!match) {
          continue;
        }
        const [, soname, tags] = match;
        if (!archTag || tags.toLowerCase().includes(archTag)) {
          sonames.add(soname);
        }
      }
      return { status: 'ok', sonames };
    } catch (error) {
      // ENOENT just means this path isn't the binary — try the next candidate.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        operationalError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return operationalError ? { status: 'error', message: operationalError } : { status: 'unavailable' };
}

export function diagnoseLinuxDependencies(libraries: LinuxLibrary[]): DiagnosticResult[] {
  if (process.platform !== 'linux') {
    return [];
  }

  const cache = readSharedLibraryCache();

  if (cache.status === 'unavailable') {
    // No `ldconfig` at all (musl/Alpine, minimal images).
    return [
      {
        category: 'Linux Dependencies',
        status: 'ok',
        message: 'Skipped — ldconfig not available',
      },
    ];
  }

  if (cache.status === 'error') {
    // `ldconfig` exists but failed.
    return [
      {
        category: 'Linux Dependencies',
        status: 'warn',
        message: 'Could not check Linux dependencies',
        details: `ldconfig failed: ${cache.message}`,
      },
    ];
  }

  const missing = libraries.filter((lib) => !cache.sonames.has(lib.soname));

  if (missing.length > 0) {
    const sonames = missing.map((lib) => lib.soname).join(', ');
    const packages = missing.map((lib) => lib.aptPackage).join(' ');
    return [
      {
        category: 'Linux Dependencies',
        status: 'warn',
        message: `${missing.length} librar${missing.length === 1 ? 'y' : 'ies'} may be missing`,
        details: `Missing: ${sonames}\nOn Debian/Ubuntu, install with: sudo apt-get install ${packages}`,
      },
    ];
  }

  return [
    {
      category: 'Linux Dependencies',
      status: 'ok',
      message: 'All required libraries found',
    },
  ];
}

export function diagnoseDiskSpace(): DiagnosticResult[] {
  const results: DiagnosticResult[] = [];

  try {
    const df = execFileSync('df', ['-h', '.'], { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = df.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      if (parts.length >= 4) {
        results.push({
          category: 'Disk Space',
          status: 'ok',
          message: `${parts[2]} used, ${parts[3]} available`,
        });
      }
    }
  } catch {
    results.push({
      category: 'Disk Space',
      status: 'warn',
      message: 'Could not determine disk space',
    });
  }

  return results;
}

export function formatDiagnosticResults(results: DiagnosticResult[], serviceName?: string): void {
  const logger = serviceName ? createLogger(serviceName) : log;
  const okCount = results.filter((r) => r.status === 'ok').length;
  const warnings = results.filter((r) => r.status === 'warn');
  const errors = results.filter((r) => r.status !== 'ok' && r.status !== 'warn');

  // Successful checks are summarised at INFO; full details at DEBUG.
  if (results.length > 0) {
    logger.info(
      `Diagnostics: ${okCount} check${okCount === 1 ? '' : 's'} passed${warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}${errors.length ? `, ${errors.length} error${errors.length === 1 ? '' : 's'}` : ''}`,
    );
  }

  for (const result of results) {
    if (result.status === 'ok') {
      logger.debug(`✅ ${result.category}: ${result.message}`);
      if (result.details) {
        logger.debug(`   ${result.details}`);
      }
    } else {
      const icon = result.status === 'warn' ? '⚠️' : '❌';
      const level = result.status === 'warn' ? 'warn' : 'error';
      logger[level](`${icon} ${result.category}: ${result.message}`);
      if (result.details) {
        logger[level](`   ${result.details}`);
      }
    }
  }
}
