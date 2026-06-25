import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));
vi.mock('node:module', () => ({
  createRequire: () => ({ resolve: () => '/fake/appium-flutter-driver/package.json' }),
}));

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkAppiumFlutterDriverVersion, checkFlutterOnPath, flutterDoctorChecks } from '../src/diagnostics.js';

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

describe('checkAppiumFlutterDriverVersion', () => {
  it('should report ok when the installed driver meets the minimum', async () => {
    readMock.mockReturnValueOnce(JSON.stringify({ version: '3.8.0' }));
    expect(await checkAppiumFlutterDriverVersion()()).toMatchObject({ status: 'ok', message: 'v3.8.0' });
  });

  it('should report ok for a higher minor/major (numeric, not lexical, compare)', async () => {
    readMock.mockReturnValueOnce(JSON.stringify({ version: '3.10.0' }));
    expect(await checkAppiumFlutterDriverVersion()()).toMatchObject({ status: 'ok' });
  });

  it('should warn with the upgrade hint when the driver is below the minimum', async () => {
    readMock.mockReturnValueOnce(JSON.stringify({ version: '3.7.1' }));
    const r = await checkAppiumFlutterDriverVersion()();
    expect(r.status).toBe('warn');
    expect(r.details).toMatch(/3\.8\.0/);
  });

  it('should warn (with the upgrade hint) when the driver cannot be inspected', async () => {
    readMock.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    const r = await checkAppiumFlutterDriverVersion()();
    expect(r.status).toBe('warn');
    expect(r.details).toMatch(/3\.8\.0/);
  });
});

describe('flutterDoctorChecks', () => {
  it('should bundle the flutter + driver-version checks for an Android run', () => {
    expect(flutterDoctorChecks(new Set(['android']))).toHaveLength(2);
  });

  it('should omit the Android-only driver-version check for an iOS-only run', () => {
    expect(flutterDoctorChecks(new Set(['ios']))).toHaveLength(1);
  });
});
