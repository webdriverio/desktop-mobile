import type { Options } from '@wdio/types';
import { describe, expect, it, vi } from 'vitest';

// BaseLauncher carries @wdio/native-core's port/driver infra mobile services don't use — stub it.
vi.mock('@wdio/native-core', () => ({ BaseLauncher: class {} }));

import { flattenCaps, MobileBaseLauncher } from '../src/launcher.js';

interface TestOptions {
  platform?: string;
  devices?: Array<{ udid?: string }>;
}
interface TestCap {
  platformName?: string;
  'appium:automationName'?: string;
  'appium:udid'?: string;
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
}

const config = {} as Options.Testrunner;
const cap = (over: Record<string, unknown> = {}): TestCap => ({ platformName: 'Android', ...over });

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

  it('should mutate a multiremote capability object', async () => {
    const caps = { phone: { capabilities: cap({ platformName: 'Android' }) } };
    await new TestLauncher().onPrepare(config, caps);
    expect(caps.phone.capabilities['appium:automationName']).toBe('UiAutomator2');
  });

  it('should reject when the subclass rejects an unsupported platform', async () => {
    await expect(new TestLauncher().onPrepare(config, [cap({ platformName: 'Windows' })])).rejects.toThrow();
  });
});

describe('MobileBaseLauncher.onWorkerStart / onWorkerEnd', () => {
  const withDevices = () => new TestLauncher({ devices: [{ udid: 'a' }, { udid: 'b' }] });

  it('should stamp the claimed device udid onto a bare capability', async () => {
    const c = cap();
    await withDevices().onWorkerStart('0-0', c);
    expect(c['appium:udid']).toBe('a');
  });

  it('should stamp onto a multiremote capability object', async () => {
    const caps = { phone: { capabilities: cap() } };
    await withDevices().onWorkerStart('0-0', caps as unknown as Record<string, unknown>);
    expect(caps.phone.capabilities['appium:udid']).toBe('a');
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

  it('should release a claimed device without throwing', async () => {
    const l = withDevices();
    await l.onWorkerStart('0-0', cap());
    expect(() => l.onWorkerEnd('0-0')).not.toThrow();
  });
});
