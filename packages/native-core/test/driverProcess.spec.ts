import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'node:child_process';

import { DriverProcess, quoteForCmd } from '../src/driverProcess.js';

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

async function startWith(driverPath: string, env?: NodeJS.ProcessEnv) {
  vi.mocked(spawn).mockReturnValue(exitedProcess() as never);
  await expect(
    new DriverProcess().start({
      mode: 'single',
      identifier: 'driver',
      port: 4444,
      nativePort: 4445,
      driverPath,
      nativeDriverPath: NATIVE_DRIVER,
      env,
    }),
  ).rejects.toMatchObject({ message: 'driver [driver] process died during startup' });
  return vi.mocked(spawn).mock.calls[0] as unknown[];
}

describe('quoteForCmd', () => {
  it('should quote an argument with a space or a cmd.exe special character', () => {
    expect(quoteForCmd('C:\\Users\\Jane Smith\\driver.cmd')).toBe('"C:\\Users\\Jane Smith\\driver.cmd"');
    expect(quoteForCmd('C:\\a&b\\driver.cmd')).toBe('"C:\\a&b\\driver.cmd"');
  });

  it('should leave a plain or already quoted argument alone', () => {
    expect(quoteForCmd('--port')).toBe('--port');
    expect(quoteForCmd('"C:\\Program Files\\driver.exe"')).toBe('"C:\\Program Files\\driver.exe"');
  });

  it("should double a trailing backslash so it doesn't escape the closing quote", () => {
    expect(quoteForCmd('C:\\My Drivers\\')).toBe('"C:\\My Drivers\\\\"');
  });
});

describe('DriverProcess.start', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
    vi.clearAllMocks();
  });

  it('should start a Windows .exe driver directly, with its arguments as they are', async () => {
    setPlatform('win32');

    const [command, args, options] = await startWith('C:\\Users\\Jane Smith\\.cargo\\bin\\tauri-driver.exe');

    expect(command).toBe('C:\\Users\\Jane Smith\\.cargo\\bin\\tauri-driver.exe');
    expect(args).toEqual(['--port', '4444', '--native-port', '4445', '--native-driver', NATIVE_DRIVER]);
    expect(options).not.toHaveProperty('shell', true);
  });

  it('should run a Windows .cmd driver through cmd.exe as one quoted command line', async () => {
    setPlatform('win32');

    const [command, options] = await startWith('C:\\Users\\Jane Smith\\app\\node_modules\\.bin\\tauri-driver.cmd');

    expect(command).toBe(
      `"C:\\Users\\Jane Smith\\app\\node_modules\\.bin\\tauri-driver.cmd" --port 4444 --native-port 4445 --native-driver "${NATIVE_DRIVER}"`,
    );
    expect(options).toMatchObject({ shell: true });
  });

  it('should start the driver directly elsewhere', async () => {
    setPlatform('linux');

    const [command, args, options] = await startWith('/opt/my drivers/tauri-driver');

    expect(command).toBe('/opt/my drivers/tauri-driver');
    expect(args).toContain(NATIVE_DRIVER);
    expect(options).not.toHaveProperty('shell', true);
  });

  it("should set the driver's env over process.env, replacing a variable whatever its case on Windows", async () => {
    setPlatform('win32');
    const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
    const userKey = pathKey === 'PATH' ? 'Path' : 'PATH';

    const [, , options] = await startWith('C:\\drivers\\tauri-driver.exe', { [userKey]: 'C:\\tools', APP_FLAG: 'on' });

    const { env } = options as { env: NodeJS.ProcessEnv };
    expect(env).toMatchObject({ [userKey]: 'C:\\tools', APP_FLAG: 'on' });
    expect(env).not.toHaveProperty(pathKey);
  });
});
