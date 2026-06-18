import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return { ...actual, createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) };
});

import { execFileSync } from 'node:child_process';
import { pickIosUdid, prebuildWda, resolveIosUdid, warmUpXcodeToolchain } from '../src/iosSetup.js';

const execMock = vi.mocked(execFileSync);
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
  it('should return undefined off macOS without shelling out', () => {
    setPlatform('linux');
    expect(resolveIosUdid('iPhone 16')).toBeUndefined();
    expect(execMock).not.toHaveBeenCalled();
  });

  it('should resolve via simctl on macOS', () => {
    setPlatform('darwin');
    execMock.mockReturnValueOnce(simctl);
    expect(resolveIosUdid('iPhone 16')).toBe('NEW');
  });

  it('should return undefined when simctl throws', () => {
    setPlatform('darwin');
    execMock.mockImplementationOnce(() => {
      throw new Error('xcrun missing');
    });
    expect(resolveIosUdid('iPhone 16')).toBeUndefined();
  });
});

describe('warmUpXcodeToolchain', () => {
  it('should be empty off macOS', () => {
    setPlatform('linux');
    expect(warmUpXcodeToolchain()).toEqual([]);
  });

  it('should report an error result when the SDK probe fails', () => {
    setPlatform('darwin');
    execMock
      .mockImplementationOnce(() => {
        throw new Error('no sdk');
      })
      .mockReturnValueOnce('' as never);
    const results = warmUpXcodeToolchain();
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
