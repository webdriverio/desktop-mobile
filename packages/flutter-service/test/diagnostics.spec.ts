import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));
vi.mock('node:module', () => ({ createRequire: () => ({ resolve: () => '/fake/appium-flutter-driver/package.json' }) }));

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkAppiumFlutterDriverFork, checkFlutterOnPath, flutterDoctorChecks } from '../src/diagnostics.js';

const execMock = vi.mocked(execFileSync);
const readMock = vi.mocked(readFileSync);

afterEach(() => vi.clearAllMocks());

describe('checkFlutterOnPath', () => {
  it('should report ok when flutter is on PATH', async () => {
    execMock.mockReturnValueOnce('/usr/bin/flutter\n');
    expect(await checkFlutterOnPath()()).toMatchObject({ status: 'ok' });
  });

  it('should warn (not error) when flutter is missing', async () => {
    execMock.mockImplementationOnce(() => {
      throw new Error('not found');
    });
    expect(await checkFlutterOnPath()()).toMatchObject({ status: 'warn', category: 'flutter' });
  });
});

describe('checkAppiumFlutterDriverFork', () => {
  it('should report ok when getVMServiceUrl is present in the installed driver', async () => {
    readMock.mockReturnValueOnce('exports.getVMServiceUrl = ...');
    expect(await checkAppiumFlutterDriverFork()()).toMatchObject({ status: 'ok' });
  });

  it('should warn with the fork hint when getVMServiceUrl is absent', async () => {
    readMock.mockReturnValueOnce('exports.execute = ...');
    const r = await checkAppiumFlutterDriverFork()();
    expect(r.status).toBe('warn');
    expect(r.details).toMatch(/goosewobbler/);
  });

  it('should warn when the driver cannot be inspected', async () => {
    readMock.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    expect(await checkAppiumFlutterDriverFork()()).toMatchObject({ status: 'warn' });
  });
});

describe('flutterDoctorChecks', () => {
  it('should bundle the flutter + fork checks', () => {
    expect(flutterDoctorChecks()).toHaveLength(2);
  });
});
