import type { execFile as execFileType } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecFile, mockCheckRunAsNodeFuse } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockCheckRunAsNodeFuse: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  default: { execFile: mockExecFile },
}));

vi.mock('../src/fuses.js', () => ({
  checkRunAsNodeFuse: mockCheckRunAsNodeFuse,
}));

vi.mock('@wdio/native-utils', () => import('./mocks/native-utils.js'));

import { probeChromiumVersion, resetProbeCache } from '../src/binaryProbe.js';

// Drive the mocked execFile callback: `execFile(bin, args, opts, cb)`.
const stubExecFile = (impl: (cb: (err: Error | null, stdout: string) => void) => void): void => {
  mockExecFile.mockImplementation(((_bin, _args, _opts, cb) => impl(cb)) as typeof execFileType);
};

describe('probeChromiumVersion', () => {
  beforeEach(() => {
    resetProbeCache();
    mockCheckRunAsNodeFuse.mockResolvedValue({ canRunAsNode: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should resolve the Chromium version from the binary output', async () => {
    stubExecFile((cb) => cb(null, '150.0.7871.129\n'));

    await expect(probeChromiumVersion('/app/electron')).resolves.toBe('150.0.7871.129');

    const [binary, args, opts] = mockExecFile.mock.calls[0];
    expect(binary).toBe('/app/electron');
    expect(args).toEqual(['-p', 'process.versions.chrome']);
    expect((opts as { env: NodeJS.ProcessEnv }).env.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('should not run the binary when the RunAsNode fuse is disabled', async () => {
    mockCheckRunAsNodeFuse.mockResolvedValue({ canRunAsNode: false });

    await expect(probeChromiumVersion('/app/electron')).resolves.toBeUndefined();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('should resolve undefined when the probe process errors (e.g. timeout)', async () => {
    stubExecFile((cb) => cb(new Error('spawn ETIMEDOUT'), ''));

    await expect(probeChromiumVersion('/app/electron')).resolves.toBeUndefined();
  });

  it('should resolve undefined when the output is not a version', async () => {
    stubExecFile((cb) => cb(null, 'not-a-version\n'));

    await expect(probeChromiumVersion('/app/electron')).resolves.toBeUndefined();
  });

  it('should probe a given binary only once (cache per path)', async () => {
    stubExecFile((cb) => cb(null, '150.0.7871.129\n'));

    const [a, b] = await Promise.all([probeChromiumVersion('/app/electron'), probeChromiumVersion('/app/electron')]);

    expect(a).toBe('150.0.7871.129');
    expect(b).toBe('150.0.7871.129');
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });
});
