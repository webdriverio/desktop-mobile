import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'node:child_process';

import { DriverProcess, quoteForCmd } from '../src/driverProcess.js';

const DRIVER = 'C:\\Users\\Jane Smith\\.cargo\\bin\\tauri-driver.exe';
const NATIVE_DRIVER = 'C:\\Program Files (x86)\\EdgeDriver\\msedgedriver.exe';
const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

// Already exited, so start() rejects on its first readiness check without touching the network
function exitedProcess() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 1,
    killed: false,
    exitCode: 1,
    signalCode: null,
  });
}

async function startWith(driverPath: string, nativeDriverPath: string) {
  vi.mocked(spawn).mockReturnValue(exitedProcess() as never);
  await expect(
    new DriverProcess().start({
      mode: 'single',
      identifier: 'driver',
      port: 4444,
      nativePort: 4445,
      driverPath,
      nativeDriverPath,
    }),
  ).rejects.toMatchObject({ message: 'driver [driver] process died during startup' });
  return vi.mocked(spawn).mock.calls[0];
}

describe('quoteForCmd', () => {
  it('should quote an argument with a space or a cmd.exe special character', () => {
    expect(quoteForCmd(DRIVER)).toBe(`"${DRIVER}"`);
    expect(quoteForCmd('C:\\a&b\\driver.exe')).toBe('"C:\\a&b\\driver.exe"');
  });

  it('should leave a plain argument alone', () => {
    expect(quoteForCmd('C:\\drivers\\msedgedriver.exe')).toBe('C:\\drivers\\msedgedriver.exe');
    expect(quoteForCmd('--port')).toBe('--port');
  });
});

describe('DriverProcess.start', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
    vi.clearAllMocks();
  });

  it('should quote the driver and native driver paths for cmd.exe on Windows', async () => {
    setPlatform('win32');

    const [command, args, options] = await startWith(DRIVER, NATIVE_DRIVER);

    expect(command).toBe(`"${DRIVER}"`);
    expect(args).toEqual(['--port', '4444', '--native-port', '4445', '--native-driver', `"${NATIVE_DRIVER}"`]);
    expect(options).toMatchObject({ shell: true });
  });

  it('should pass the paths as they are, without a shell, elsewhere', async () => {
    setPlatform('linux');

    const [command, args, options] = await startWith('/opt/my drivers/tauri-driver', '/usr/bin/WebKitWebDriver');

    expect(command).toBe('/opt/my drivers/tauri-driver');
    expect(args).toEqual(['--port', '4444', '--native-port', '4445', '--native-driver', '/usr/bin/WebKitWebDriver']);
    expect(options).toMatchObject({ shell: false });
  });
});
