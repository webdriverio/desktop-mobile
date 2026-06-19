import type { Options } from '@wdio/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Stub BaseLauncher (native-core's port/driver infra) with a minimal allocating PortManager.
const releaseSpy = vi.hoisted(() => vi.fn());
vi.mock('@wdio/native-core', () => ({
  BaseLauncher: class {
    private _next = 9000;
    portManager = {
      allocatePort: async () => this._next++,
      releasePort: releaseSpy,
    };
  },
}));

// Keep onPrepare from shelling out to `appium` / `xcrun`.
const ensureSpy = vi.hoisted(() => vi.fn(async () => ({ ok: true, value: { name: 'x', method: 'skipped' as const } })));
vi.mock('../src/appiumDriverManager.js', () => ({ ensureAppiumDriver: ensureSpy }));
vi.mock('../src/iosSetup.js', () => ({
  resolveIosUdid: vi.fn(async () => undefined),
  warmUpXcodeToolchain: vi.fn(async () => []),
}));
vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return { ...actual, createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) };
});

import type { DoctorCheck } from '../src/doctor.js';
import { flattenCaps, MobileBaseLauncher } from '../src/launcher.js';

interface TestOptions {
  platform?: string;
  devices?: Array<{ udid?: string }>;
  autoInstallDriver?: boolean;
  doctor?: boolean | { strict?: boolean };
}
interface TestCap {
  platformName?: string;
  'appium:automationName'?: string;
  'appium:udid'?: string;
  'appium:dartVmServicePort'?: number;
}

class TestLauncher extends MobileBaseLauncher<TestOptions, TestCap> {
  constructor(options: TestOptions = {}) {
    super(options, 'wdio:testServiceOptions', 'test-service');
  }
  protected mutateCapability(cap: TestCap): 'android' | 'ios' {
    const p = (cap.platformName ?? '').toLowerCase();
    if (p !== 'android' && p !== 'ios') {
      throw new Error(`unsupported: ${cap.platformName}`);
    }
    cap['appium:automationName'] = p === 'android' ? 'UiAutomator2' : 'XCUITest';
    return p;
  }
  protected requiredDrivers(platform: 'android' | 'ios'): string[] {
    return platform === 'android' ? ['uiautomator2'] : ['xcuitest'];
  }
  protected portCapKey(): string | undefined {
    return undefined;
  }
}

// A launcher that stamps a per-cap realm port (the Flutter shape).
class PortLauncher extends TestLauncher {
  protected portCapKey(): string | undefined {
    return 'appium:dartVmServicePort';
  }
}

const config = {} as Options.Testrunner;
const cap = (over: Record<string, unknown> = {}): TestCap => ({ platformName: 'Android', ...over });

afterEach(() => vi.clearAllMocks());

describe('flattenCaps', () => {
  it('should pass an array of caps through', () => {
    expect(flattenCaps([cap(), cap()])).toHaveLength(2);
  });
  it('should unwrap a multiremote { instance: { capabilities } } object', () => {
    expect(flattenCaps({ phone: { capabilities: cap() } })).toEqual([cap()]);
  });
  it('should wrap a single bare capability', () => {
    const c = cap();
    expect(flattenCaps(c as unknown as Record<string, unknown>)).toEqual([c]);
  });
});

describe('MobileBaseLauncher.onPrepare', () => {
  it('should mutate every capability in an array', async () => {
    const caps = [cap({ platformName: 'Android' }), cap({ platformName: 'iOS' })];
    await new TestLauncher().onPrepare(config, caps);
    expect(caps.map((c) => c['appium:automationName'])).toEqual(['UiAutomator2', 'XCUITest']);
  });

  it('should reject when the subclass rejects an unsupported platform', async () => {
    await expect(new TestLauncher().onPrepare(config, [cap({ platformName: 'Windows' })])).rejects.toThrow();
  });

  it('should not auto-install drivers by default', async () => {
    await new TestLauncher().onPrepare(config, [cap()]);
    expect(ensureSpy).not.toHaveBeenCalled();
  });

  it('should ensure the union of required drivers once when autoInstallDriver is on', async () => {
    await new TestLauncher({ autoInstallDriver: true }).onPrepare(config, [
      cap({ platformName: 'Android' }),
      cap({ platformName: 'iOS' }),
    ]);
    const names = ensureSpy.mock.calls.map((c) => c[0]).sort();
    expect(names).toEqual(['uiautomator2', 'xcuitest']);
  });

  it('should mutate a multiremote object and build platforms from it (driver-ensure not skipped)', async () => {
    // Integrated multiremote path: a `{ instance: { capabilities } }` shape must unwrap to the
    // inner caps, so both get mutated AND `platforms` is non-empty (else driver-ensure + doctor
    // would silently no-op on a multiremote config).
    const caps = {
      phone: { capabilities: cap({ platformName: 'Android' }) },
      tablet: { capabilities: cap({ platformName: 'iOS' }) },
    };
    await new TestLauncher({ autoInstallDriver: true }).onPrepare(config, caps);
    expect(caps.phone.capabilities['appium:automationName']).toBe('UiAutomator2');
    expect(caps.tablet.capabilities['appium:automationName']).toBe('XCUITest');
    expect(ensureSpy.mock.calls.map((c) => c[0]).sort()).toEqual(['uiautomator2', 'xcuitest']);
  });

  it('should not throw under the default warn doctor mode', async () => {
    await expect(new TestLauncher().onPrepare(config, [cap()])).resolves.toBeUndefined();
  });
});

describe('MobileBaseLauncher doctor fail-fast', () => {
  class StrictLauncher extends TestLauncher {
    protected doctorChecks(): DoctorCheck[] {
      return [() => ({ category: 'X', status: 'error', message: 'bad' })];
    }
  }

  it('should throw under { strict: true } when a check errors', async () => {
    await expect(new StrictLauncher({ doctor: { strict: true } }).onPrepare(config, [cap()])).rejects.toThrow(/bad/);
  });

  it('should only log when run without strict (doctor: true)', async () => {
    await expect(new StrictLauncher({ doctor: true }).onPrepare(config, [cap()])).resolves.toBeUndefined();
  });

  it('should skip checks entirely when doctor: false', async () => {
    await expect(new StrictLauncher({ doctor: false }).onPrepare(config, [cap()])).resolves.toBeUndefined();
  });
});

describe('MobileBaseLauncher device stamping', () => {
  const withDevices = () => new TestLauncher({ devices: [{ udid: 'a' }, { udid: 'b' }] });

  it('should stamp the claimed device udid onto a bare capability', async () => {
    const c = cap();
    await withDevices().onWorkerStart('0-0', c);
    expect(c['appium:udid']).toBe('a');
  });

  it('should stamp the device udid onto a multiremote capability object', async () => {
    // A multiremote run hands onWorkerStart { instance: { capabilities } }, not an array,
    // so the device must land on the nested capability — not silently dropped.
    const caps = { phone: { capabilities: cap() } };
    await withDevices().onWorkerStart('0-0', caps as unknown as Record<string, unknown>);
    expect(caps.phone.capabilities['appium:udid']).toBe('a');
  });

  it('should release a claimed device without throwing on worker end', async () => {
    const l = withDevices();
    await l.onWorkerStart('0-0', cap());
    await expect(l.onWorkerEnd('0-0')).resolves.toBeUndefined();
  });

  it('should advance the device cursor per worker', async () => {
    const l = withDevices();
    const a = cap();
    const b = cap();
    await l.onWorkerStart('0-0', a);
    await l.onWorkerStart('0-1', b);
    expect([a['appium:udid'], b['appium:udid']]).toEqual(['a', 'b']);
  });

  it('should be a no-op when no device pool is configured', async () => {
    const c = cap();
    await new TestLauncher().onWorkerStart('0-0', c);
    expect(c['appium:udid']).toBeUndefined();
  });

  it('should not throw on undefined capabilities', async () => {
    await expect(withDevices().onWorkerStart('0-0', undefined)).resolves.toBeUndefined();
  });

  it('should apply Android boot-cap defaults', async () => {
    const c = cap();
    await new TestLauncher().onWorkerStart('0-0', c);
    expect((c as Record<string, unknown>)['appium:autoGrantPermissions']).toBe(true);
  });
});

describe('MobileBaseLauncher port seam', () => {
  it('should stamp a free realm port per cap and release it on worker end', async () => {
    const l = new PortLauncher();
    const c = cap();
    await l.onWorkerStart('0-0', c);
    const port = c['appium:dartVmServicePort'];
    expect(typeof port).toBe('number');
    await l.onWorkerEnd('0-0');
    expect(releaseSpy).toHaveBeenCalledWith(port);
  });

  it('should not overwrite a user-pinned port', async () => {
    const c = cap({ 'appium:dartVmServicePort': 5555 });
    await new PortLauncher().onWorkerStart('0-0', c);
    expect(c['appium:dartVmServicePort']).toBe(5555);
  });

  it('should release every port when onWorkerStart fires twice for one cid (no leak)', async () => {
    const l = new PortLauncher();
    const a = cap();
    const b = cap();
    await l.onWorkerStart('0-0', a);
    await l.onWorkerStart('0-0', b);
    await l.onWorkerEnd('0-0');
    expect(releaseSpy).toHaveBeenCalledWith(a['appium:dartVmServicePort']);
    expect(releaseSpy).toHaveBeenCalledWith(b['appium:dartVmServicePort']);
  });

  it('should allocate distinct ports per multiremote instance', async () => {
    const caps = { a: { capabilities: cap() }, b: { capabilities: cap() } };
    await new PortLauncher().onWorkerStart('0-0', caps as unknown as Record<string, unknown>);
    const pa = caps.a.capabilities['appium:dartVmServicePort'];
    const pb = caps.b.capabilities['appium:dartVmServicePort'];
    expect(pa).not.toBe(pb);
  });

  it('should do nothing for a launcher without a port cap key', async () => {
    const c = cap();
    const l = new TestLauncher();
    await l.onWorkerStart('0-0', c);
    await l.onWorkerEnd('0-0');
    expect(releaseSpy).not.toHaveBeenCalled();
  });
});
