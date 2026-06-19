import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFile: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return { ...actual, createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) };
});

import { execFile } from 'node:child_process';
import { pickIosUdid, prebuildWda, resolveIosUdid, warmUpXcodeToolchain } from '../src/iosSetup.js';

const execMock = vi.mocked(execFile);

// The code wraps execFile in a promise; the helper resolves/rejects the (file, args, opts, cb)
// callback so a test can stand in for one `xcrun` invocation.
type ExecCb = (error: Error | null, stdout: string, stderr: string) => void;
const xcrunOnce = (impl: (cb: ExecCb) => void) =>
  execMock.mockImplementationOnce(((_file: string, _args: string[], _opts: unknown, cb: ExecCb) => impl(cb)) as never);
const xcrunResolves = (stdout: string) => xcrunOnce((cb) => cb(null, stdout, ''));
const xcrunRejects = (message: string) => xcrunOnce((cb) => cb(new Error(message), '', ''));
const origPlatform = process.platform;
const setPlatform = (p: NodeJS.Platform) =>
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
afterEach(() => {
  setPlatform(origPlatform);
  vi.clearAllMocks();
});

const simctl = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-16-4': [{ udid: 'OLD', name: 'iPhone 16', isAvailable: true }],
    'com.apple.CoreSimulator.SimRuntime.iOS-17-5': [{ udid: 'NEW', name: 'iPhone 16', isAvailable: true }],
  },
});

describe('pickIosUdid', () => {
  it('should prefer the newest runtime for a duplicate device name', () => {
    expect(pickIosUdid(simctl, 'iPhone 16')).toBe('NEW');
  });

  it('should honour an explicit platformVersion', () => {
    expect(pickIosUdid(simctl, 'iPhone 16', '16.4')).toBe('OLD');
  });

  it('should skip unavailable devices and unmatched names', () => {
    const json = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-5': [{ udid: 'X', name: 'iPhone 16', isAvailable: false }],
      },
    });
    expect(pickIosUdid(json, 'iPhone 16')).toBeUndefined();
    expect(pickIosUdid(simctl, 'iPad')).toBeUndefined();
  });

  it('should return undefined on invalid JSON', () => {
    expect(pickIosUdid('not json', 'iPhone 16')).toBeUndefined();
  });
});

describe('resolveIosUdid', () => {
  it('should return undefined off macOS without shelling out', async () => {
    setPlatform('linux');
    expect(await resolveIosUdid('iPhone 16')).toBeUndefined();
    expect(execMock).not.toHaveBeenCalled();
  });

  it('should resolve via simctl on macOS', async () => {
    setPlatform('darwin');
    xcrunResolves(simctl);
    expect(await resolveIosUdid('iPhone 16')).toBe('NEW');
  });

  it('should return undefined when simctl throws', async () => {
    setPlatform('darwin');
    xcrunRejects('xcrun missing');
    expect(await resolveIosUdid('iPhone 16')).toBeUndefined();
  });
});

describe('warmUpXcodeToolchain', () => {
  it('should be empty off macOS', async () => {
    setPlatform('linux');
    expect(await warmUpXcodeToolchain()).toEqual([]);
  });

  it('should report an error result when the SDK probe fails', async () => {
    setPlatform('darwin');
    xcrunRejects('no sdk'); // --show-sdk-version
    xcrunResolves(''); // simctl list devices
    const results = await warmUpXcodeToolchain();
    expect(results.find((r) => r.category === 'iOS SDK')).toMatchObject({ status: 'error' });
  });
});

describe('prebuildWda', () => {
  it('should return Err off macOS', async () => {
    setPlatform('linux');
    const r = await prebuildWda({ derivedDataPath: '/tmp/dd' });
    expect(r.ok).toBe(false);
  });
});
