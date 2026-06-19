import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn(() => false) }));
vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return { ...actual, createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) };
});

import { execFileSync, spawn } from 'node:child_process';
import {
  ensureAppiumDriver,
  getAppiumVersion,
  parseInstalledDrivers,
  resetInstalledCache,
} from '../src/appiumDriverManager.js';

const execMock = vi.mocked(execFileSync);
const spawnMock = vi.mocked(spawn);

/** A fake child process that emits `close` with `code` on the next tick. */
function fakeProc(code = 0, stderr = '') {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (stderr) {
      proc.stderr.emit('data', Buffer.from(stderr));
    }
    proc.emit('close', code);
  });
  return proc as unknown as ReturnType<typeof spawn>;
}

/** Wire execFileSync: `appium --version` → version, `driver list` → installed JSON. */
function mockAppium(version: string | null, installed: string[]) {
  execMock.mockImplementation((_bin, args) => {
    const a = args as string[];
    if (a.includes('--version')) {
      if (version === null) {
        throw new Error('appium not found');
      }
      return version;
    }
    if (a.includes('list')) {
      return JSON.stringify(Object.fromEntries(installed.map((n) => [n, {}])));
    }
    return '';
  });
}

afterEach(() => {
  resetInstalledCache();
  vi.clearAllMocks();
});

describe('parseInstalledDrivers', () => {
  it('should extract driver names and tolerate leading log noise', () => {
    expect(parseInstalledDrivers('log line\n{"uiautomator2":{},"xcuitest":{}}')).toEqual(['uiautomator2', 'xcuitest']);
    expect(parseInstalledDrivers('garbage')).toEqual([]);
  });
});

describe('getAppiumVersion', () => {
  it('should parse the major from a bare semver line', () => {
    mockAppium('3.5.0\n', []);
    expect(getAppiumVersion()).toEqual({ raw: '3.5.0', major: 3 });
  });

  it('should return undefined when appium is missing', () => {
    mockAppium(null, []);
    expect(getAppiumVersion()).toBeUndefined();
  });
});

describe('ensureAppiumDriver', () => {
  it('should be a no-op when autoInstallDriver is off', async () => {
    const r = await ensureAppiumDriver('uiautomator2', { autoInstallDriver: false });
    expect(r).toEqual({ ok: true, value: { name: 'uiautomator2', method: 'skipped' } });
    expect(execMock).not.toHaveBeenCalled();
  });

  it('should error clearly when appium is not resolvable', async () => {
    mockAppium(null, []);
    const r = await ensureAppiumDriver('uiautomator2', { autoInstallDriver: true });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error.message).toMatch(/appium' CLI is not resolvable/);
  });

  it('should be idempotent — found when already installed (no install)', async () => {
    mockAppium('3.5.0', ['uiautomator2']);
    const r = await ensureAppiumDriver('uiautomator2', { autoInstallDriver: true });
    expect(r).toMatchObject({ ok: true, value: { method: 'found' } });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('should error when the matrix has no entry for the Appium major', async () => {
    mockAppium('99.0.0', []);
    const r = await ensureAppiumDriver('uiautomator2', { autoInstallDriver: true });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error.message).toMatch(/No known-good version/);
  });

  it('should install the matrix-pinned driver on success', async () => {
    mockAppium('3.5.0', []);
    spawnMock.mockReturnValueOnce(fakeProc(0));
    const r = await ensureAppiumDriver('flutter', { autoInstallDriver: true });
    expect(r).toMatchObject({ ok: true, value: { method: 'installed' } });
    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['driver', 'install', '--source=npm', 'appium-flutter-driver@^3.7.0'],
      // a timeout caps the install so a slow registry can't hang onPrepare
      expect.objectContaining({ timeout: 300000 }),
    );
  });

  it('should return Err when the install process exits non-zero', async () => {
    mockAppium('3.5.0', []);
    spawnMock.mockReturnValueOnce(fakeProc(1, 'boom'));
    const r = await ensureAppiumDriver('xcuitest', { autoInstallDriver: true });
    expect(r.ok).toBe(false);
  });

  it('should honour a source override for the install spec', async () => {
    mockAppium('3.5.0', []);
    spawnMock.mockReturnValueOnce(fakeProc(0));
    await ensureAppiumDriver('flutter', { autoInstallDriver: true, source: '@goosewobbler/appium-flutter-driver' });
    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['driver', 'install', '--source=npm', '@goosewobbler/appium-flutter-driver@^3.7.0'],
      expect.any(Object),
    );
  });
});
