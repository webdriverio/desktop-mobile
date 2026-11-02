import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'node:child_process';

import { quoteForCmd } from '../src/cmdLine.js';
import { DriverProcess } from '../src/driverProcess.js';

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

async function startWith(driverPath: string, options: { env?: NodeJS.ProcessEnv; nativeDriverPath?: string } = {}) {
  vi.mocked(spawn).mockReturnValue(exitedProcess() as never);
  await expect(
    new DriverProcess().start({
      mode: 'single',
      identifier: 'driver',
      port: 4444,
      nativePort: 4445,
      driverPath,
      nativeDriverPath: options.nativeDriverPath ?? NATIVE_DRIVER,
      env: options.env,
    }),
  ).rejects.toMatchObject({ message: 'driver [driver] process died during startup' });
  return vi.mocked(spawn).mock.calls[0] as unknown[];
}

// Starts on its startup marker, and exits when it's killed or taskkill runs
async function startRunning(driverPath: string) {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 4321,
    killed: false,
    exitCode: null as number | null,
    signalCode: null,
    kill: vi.fn(() => {
      exit();
      return true;
    }),
  });
  const exit = () =>
    setImmediate(() => {
      proc.exitCode = 0;
      proc.emit('exit', 0, null);
    });
  vi.mocked(spawn).mockImplementation(((command: string) => {
    if (command === 'taskkill') {
      exit();
      return new EventEmitter();
    }
    return proc;
  }) as never);

  const driver = new DriverProcess();
  const started = driver.start({
    mode: 'single',
    identifier: 'driver',
    port: 1,
    nativePort: 2,
    driverPath,
    startupMarkers: ['ready'],
  });
  proc.stdout.write('ready\n');
  await started;
  return { driver, proc };
}

describe('quoteForCmd', () => {
  it('should quote an argument with a space or a cmd.exe special character', () => {
    expect(quoteForCmd('C:\\Users\\Jane Smith\\driver.cmd')).toBe('"C:\\Users\\Jane Smith\\driver.cmd"');
    expect(quoteForCmd('C:\\a&b\\driver.cmd')).toBe('"C:\\a&b\\driver.cmd"');
  });

  it('should leave a plain argument alone, and keep an empty one as ""', () => {
    expect(quoteForCmd('--port')).toBe('--port');
    expect(quoteForCmd('')).toBe('""');
  });

  it('should re-quote an argument the caller already quoted, rather than trust it', () => {
    expect(quoteForCmd('"C:\\Program Files\\driver.exe"')).toBe('"C:\\Program Files\\driver.exe"');
    expect(quoteForCmd('"C:\\My Drivers\\"')).toBe('"C:\\My Drivers\\\\"');
    expect(quoteForCmd('"a" & calc & "b"')).toBe('"a"" & calc & ""b"');
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

  it.each(['C:\\Users\\Jane Smith\\.cargo\\bin\\tauri-driver.exe', 'C:\\Tools\\TAURI-DRIVER.EXE'])(
    'should start the Windows .exe driver %s directly, with its arguments as they are',
    async (driverPath) => {
      setPlatform('win32');

      const [command, args, options] = await startWith(driverPath);

      expect(command).toBe(driverPath);
      expect(args).toEqual(['--port', '4444', '--native-port', '4445', '--native-driver', NATIVE_DRIVER]);
      expect(options).not.toHaveProperty('shell');
    },
  );

  it("should drop a caller's quotes around a path when no cmd.exe is there to strip them", async () => {
    setPlatform('win32');

    const [command, args] = await startWith('"C:\\Program Files\\tauri-driver.exe"', {
      nativeDriverPath: `"${NATIVE_DRIVER}"`,
    });

    expect(command).toBe('C:\\Program Files\\tauri-driver.exe');
    expect(args).toContain(NATIVE_DRIVER);
  });

  it.each([
    ['a .cmd shim', 'C:\\Users\\Jane Smith\\app\\node_modules\\.bin\\tauri-driver.cmd'],
    ['a .bat file', 'C:\\drivers\\tauri-driver.bat'],
    ['a bare name', 'tauri-driver'],
  ])('should run %s through cmd.exe as one quoted command line', async (_, driverPath) => {
    setPlatform('win32');

    const [command, options] = await startWith(driverPath);

    expect(command).toBe(
      `${quoteForCmd(driverPath)} --port 4444 --native-port 4445 --native-driver "${NATIVE_DRIVER}"`,
    );
    expect(options).toMatchObject({ shell: true });
  });

  it('should start the driver directly elsewhere', async () => {
    setPlatform('linux');

    const [command, args, options] = await startWith('/opt/my drivers/tauri-driver');

    expect(command).toBe('/opt/my drivers/tauri-driver');
    expect(args).toContain(NATIVE_DRIVER);
    expect(options).not.toHaveProperty('shell');
  });

  it("should set the driver's env over process.env, replacing a variable whatever its case on Windows", async () => {
    setPlatform('win32');
    const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
    const userKey = pathKey === 'PATH' ? 'Path' : 'PATH';

    const [, , options] = await startWith('C:\\drivers\\tauri-driver.exe', {
      env: { [userKey]: 'C:\\tools', APP_FLAG: 'on' },
    });

    const { env } = options as { env: NodeJS.ProcessEnv };
    expect(env).toMatchObject({ [userKey]: 'C:\\tools', APP_FLAG: 'on' });
    expect(env).not.toHaveProperty(pathKey);
  });
});

describe('DriverProcess.stop', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
    vi.clearAllMocks();
  });

  it("should end a Windows driver's whole process tree when cmd.exe started it", async () => {
    setPlatform('win32');
    const { driver, proc } = await startRunning('C:\\app\\node_modules\\.bin\\tauri-driver.cmd');

    await driver.stop();

    expect(spawn).toHaveBeenCalledWith('taskkill', ['/pid', '4321', '/T', '/F'], { stdio: 'ignore' });
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it('should send SIGTERM to a driver it started directly', async () => {
    setPlatform('win32');
    const { driver, proc } = await startRunning('C:\\drivers\\tauri-driver.exe');

    await driver.stop();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawn).not.toHaveBeenCalledWith('taskkill', expect.anything(), expect.anything());
  });
});
