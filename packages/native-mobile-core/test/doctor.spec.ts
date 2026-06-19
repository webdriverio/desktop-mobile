import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn() }));

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  checkAppiumServiceConfigured,
  checkBuildIsDebug,
  checkCommandOnPath,
  checkPathExists,
  resolveDoctor,
  runDoctor,
} from '../src/doctor.js';

const execMock = vi.mocked(execFileSync);
const existsMock = vi.mocked(existsSync);

describe('doctor builders', () => {
  it('should report ok when a command is found and error when missing', async () => {
    execMock.mockReturnValueOnce('/usr/bin/flutter\n');
    expect(await checkCommandOnPath('flutter')()).toMatchObject({ status: 'ok', category: 'flutter' });

    execMock.mockImplementationOnce(() => {
      throw new Error('not found');
    });
    expect(await checkCommandOnPath('flutter', { hint: 'install it' })()).toMatchObject({
      status: 'error',
      details: 'install it',
    });
  });

  it('should honour a warn severity when configured', async () => {
    execMock.mockImplementationOnce(() => {
      throw new Error('nope');
    });
    expect(await checkCommandOnPath('adb', { severity: 'warn' })()).toMatchObject({ status: 'warn' });
  });

  it('should report ok when the path exists and error when missing', async () => {
    existsMock.mockReturnValueOnce(true);
    expect(await checkPathExists('/app', 'App')()).toMatchObject({ status: 'ok' });
    existsMock.mockReturnValueOnce(false);
    expect(await checkPathExists('/app', 'App')()).toMatchObject({ status: 'error' });
  });

  it('should report ok for debug/profile and warn for release/unknown', async () => {
    expect(await checkBuildIsDebug('/a', () => 'debug')()).toMatchObject({ status: 'ok' });
    expect(await checkBuildIsDebug('/a', () => 'release')()).toMatchObject({ status: 'warn' });
    expect(await checkBuildIsDebug('/a', () => 'unknown')()).toMatchObject({ status: 'warn' });
  });

  it('should report ok when appium is in services and warn when absent', async () => {
    expect(await checkAppiumServiceConfigured(['appium', 'flutter'])()).toMatchObject({ status: 'ok' });
    expect(await checkAppiumServiceConfigured([['@wdio/appium-service', {}]])()).toMatchObject({ status: 'ok' });
    expect(await checkAppiumServiceConfigured(['flutter'])()).toMatchObject({ status: 'warn' });
    expect(await checkAppiumServiceConfigured(undefined)()).toMatchObject({ status: 'warn' });
  });
});

describe('runDoctor', () => {
  const ok = () => ({ category: 'A', status: 'ok' as const, message: 'fine' });
  const err = () => ({ category: 'B', status: 'error' as const, message: 'broken' });

  it('should not throw on error when failFast is false', async () => {
    const results = await runDoctor([ok, err], { serviceName: 'svc', failFast: false });
    expect(results).toHaveLength(2);
  });

  it('should throw SevereServiceError on error when failFast', async () => {
    await expect(runDoctor([ok, err], { serviceName: 'svc', failFast: true })).rejects.toThrow(/broken/);
  });

  it('should not throw under failFast when there are no errors', async () => {
    await expect(runDoctor([ok], { serviceName: 'svc', failFast: true })).resolves.toHaveLength(1);
  });

  it('should record a thrown check as an error result rather than crashing', async () => {
    const boom = () => {
      throw new Error('kaboom');
    };
    const results = await runDoctor([boom], { serviceName: 'svc', failFast: false });
    expect(results[0]).toMatchObject({ status: 'error', message: expect.stringContaining('kaboom') });
  });

  it('should resolve doctor config to run/failFast', () => {
    expect(resolveDoctor(undefined)).toEqual({ run: true, failFast: false });
    expect(resolveDoctor(true)).toEqual({ run: true, failFast: false });
    expect(resolveDoctor(false)).toEqual({ run: false, failFast: false });
    expect(resolveDoctor({})).toEqual({ run: true, failFast: false });
    expect(resolveDoctor({ strict: false })).toEqual({ run: true, failFast: false });
    expect(resolveDoctor({ strict: true })).toEqual({ run: true, failFast: true });
  });
});
