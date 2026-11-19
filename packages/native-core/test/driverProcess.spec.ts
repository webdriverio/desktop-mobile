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

// Exits when it is signaled or taskkill ends it.
function spawnDriver(driverPath: string) {
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
      const taskkill = new EventEmitter();
      setImmediate(() => {
        taskkill.emit('exit', 0);
        exit();
      });
      return taskkill;
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
    errorMarkers: ['bind failed'],
  });
  return { driver, proc, started };
}

async function startRunning(driverPath: string) {
  const { driver, proc, started } = spawnDriver(driverPath);
  proc.stdout.write('ready\n');
  await started;
  return { driver, proc };
}

describe('quoteForCmd', () => {
  it('should quote an argument with a space or a cmd.exe special character', () => {
    expect(quoteForCmd('C:\\Users\\Jane Smith\\driver.cmd')).toBe('"C:\\Users\\Jane Smith\\driver.cmd"');
    expect(quoteForCmd('C:\\a&b\\driver.cmd')).toBe('"C:\\a&b\\driver.cmd"');
  });

  it('should leave a plain argument alone', () => {
    expect(quoteForCmd('--port')).toBe('--port');
  });

  it('should re-quote an argument the caller already quoted, rather than trust it', () => {
    expect(quoteForCmd('"C:\\Program Files\\driver.exe"')).toBe('"C:\\Program Files\\driver.exe"');
  });
});

describe('DriverProcess.start', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
    vi.clearAllMocks();
  });

  it.each(['linux', 'win32'] as const)('should stop a live driver before rejecting startup on %s', async (platform) => {
    setPlatform(platform);
    const { driver, proc, started } = spawnDriver('driver.exe');
    proc.stderr.write('bind failed\n');

    await expect(started).rejects.toThrow(/bind failed/);
    expect(proc.exitCode).toBe(0);
    expect(driver.isRunning()).toBe(false);
  });

  it('should start a Windows .exe driver directly, with its arguments as they are', async () => {
    setPlatform('win32');
    const driverPath = 'C:\\Users\\Jane Smith\\.cargo\\bin\\tauri-driver.exe';

    const [command, args, options] = await startWith(driverPath);

    expect(command).toBe(driverPath);
    expect(args).toEqual(['--port', '4444', '--native-port', '4445', '--native-driver', NATIVE_DRIVER]);
    expect(options).not.toHaveProperty('shell');
  });

  it("should drop a caller's quotes around a path when no cmd.exe is there to strip them", async () => {
    setPlatform('win32');

    const [command, args] = await startWith('"C:\\Program Files\\tauri-driver.exe"', {
      nativeDriverPath: `"${NATIVE_DRIVER}"`,
    });

    expect(command).toBe('C:\\Program Files\\tauri-driver.exe');
    expect(args).toContain(NATIVE_DRIVER);
  });

  it('should run a .cmd shim through cmd.exe as one quoted command line', async () => {
    setPlatform('win32');
    const driverPath = 'C:\\Users\\Jane Smith\\app\\node_modules\\.bin\\tauri-driver.cmd';

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

  it.each(['C:\\app\\node_modules\\.bin\\tauri-driver.cmd', 'C:\\drivers\\tauri-driver.exe'])(
    'should stop the Windows process tree for %s',
    async (driverPath) => {
      setPlatform('win32');
      const { driver, proc } = await startRunning(driverPath);

      await driver.stop();

      expect(spawn).toHaveBeenCalledWith('taskkill', ['/pid', '4321', '/T', '/F'], { stdio: 'ignore' });
      expect(proc.kill).not.toHaveBeenCalled();
    },
  );

  it('should send SIGTERM to the driver on POSIX', async () => {
    setPlatform('linux');
    const { driver, proc } = await startRunning('/usr/bin/tauri-driver');

    await driver.stop();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawn).not.toHaveBeenCalledWith('taskkill', expect.anything(), expect.anything());
  });
});
