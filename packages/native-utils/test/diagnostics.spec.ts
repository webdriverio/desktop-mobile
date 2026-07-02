import { statSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { diagnoseBinary } from '../src/diagnostics.js';

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return { ...actual, statSync: vi.fn() };
});

vi.mock('../src/log.js', () => import('./__mock__/log.js'));

const setPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
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
