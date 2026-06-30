import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeBrowser } from './helpers.js';

// Launcher native-mode dependencies — should NOT be invoked when mode is 'browser'.
vi.mock('@wdio/native-utils', async () => {
  const actual = await vi.importActual<typeof import('@wdio/native-utils')>('@wdio/native-utils');
  return {
    ...actual,
    readPackageUp: vi.fn(),
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    })),
    formatDiagnosticResults: vi.fn(),
    waitUntilWindowAvailable: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../../src/appBuildInfo.js', () => ({ getAppBuildInfo: vi.fn() }));
vi.mock('../../src/binaryPath.js', () => ({ getBinaryPath: vi.fn() }));
vi.mock('../../src/electronVersion.js', () => ({ getElectronVersion: vi.fn() }));
vi.mock('../../src/versions.js', () => ({ getChromiumVersion: vi.fn() }));
vi.mock('../../src/pathResolver.js', () => ({ resolveAppPaths: vi.fn() }));
vi.mock('../../src/apparmor.js', () => ({ applyApparmorWorkaround: vi.fn() }));
vi.mock('../../src/diagnostics.js', () => ({ diagnoseElectronEnvironment: vi.fn().mockResolvedValue([]) }));
vi.mock('../../src/fuses.js', () => ({ checkInspectFuse: vi.fn().mockResolvedValue({ canUseCdpBridge: true }) }));
vi.mock('get-port', () => ({ default: vi.fn().mockResolvedValue(9229) }));

// CDP bridge & Puppeteer — should NOT be constructed when mode is 'browser'.
vi.mock('../../src/bridge.js', () => {
  const ElectronCdpBridge = vi.fn();
  ElectronCdpBridge.prototype.connect = vi.fn();
  ElectronCdpBridge.prototype.send = vi.fn();
  ElectronCdpBridge.prototype.on = vi.fn();
  return {
    getDebuggerEndpoint: vi.fn(),
    ElectronCdpBridge,
  };
});
vi.mock('../../src/window.js', () => ({
  getActiveWindowHandle: vi.fn(),
  ensureActiveWindowFocus: vi.fn(),
  getPuppeteer: vi.fn(),
  clearPuppeteerSessions: vi.fn(),
}));

import getPort from 'get-port';
import { applyApparmorWorkaround } from '../../src/apparmor.js';
import { getAppBuildInfo } from '../../src/appBuildInfo.js';
import { getBinaryPath } from '../../src/binaryPath.js';
import { ElectronCdpBridge } from '../../src/bridge.js';
import { getElectronVersion } from '../../src/electronVersion.js';
import ElectronLaunchService from '../../src/launcher.js';
import { resolveAppPaths } from '../../src/pathResolver.js';
import ElectronWorkerService from '../../src/service.js';
import { getChromiumVersion } from '../../src/versions.js';

const DEV_SERVER = 'http://localhost:5173';

describe('launcher → worker handshake (browser mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Launcher onPrepare now preflights the dev server; stub it as reachable.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should transform the Electron capability into a Chrome capability', async () => {
    const launcher = new ElectronLaunchService({} as never, {} as never, {} as never);
    const caps: Array<Record<string, unknown>> = [
      {
        browserName: 'electron',
        'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER },
      },
    ];

    await launcher.onPrepare({} as never, caps as never);

    expect(caps[0].browserName).toBe('chrome');
    expect(caps[0]['goog:chromeOptions']).toBeUndefined();
    expect(caps[0]['wdio:enforceWebDriverClassic']).toBeUndefined();
  });

  it('should skip every native-mode setup step in onPrepare', async () => {
    const launcher = new ElectronLaunchService({} as never, {} as never, {} as never);
    const caps: Array<Record<string, unknown>> = [
      {
        browserName: 'electron',
        'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: DEV_SERVER },
      },
    ];

    await launcher.onPrepare({} as never, caps as never);

    expect(getElectronVersion).not.toHaveBeenCalled();
    expect(getChromiumVersion).not.toHaveBeenCalled();
    expect(resolveAppPaths).not.toHaveBeenCalled();
    expect(getBinaryPath).not.toHaveBeenCalled();
    expect(getAppBuildInfo).not.toHaveBeenCalled();
    expect(applyApparmorWorkaround).not.toHaveBeenCalled();
    expect(getPort).not.toHaveBeenCalled();
  });

  it('should not construct ElectronCdpBridge in the worker after the launcher transformed the capability', async () => {
    const launcher = new ElectronLaunchService(
      { mode: 'browser', devServerUrl: DEV_SERVER } as never,
      {} as never,
      {} as never,
    );
    const caps: Array<Record<string, unknown>> = [{ browserName: 'electron', 'wdio:electronServiceOptions': {} }];
    await launcher.onPrepare({} as never, caps as never);

    const worker = new ElectronWorkerService({ mode: 'browser', devServerUrl: DEV_SERVER }, caps[0] as never);
    const browser = createFakeBrowser();
    await worker.before({} as never, [], browser as unknown as WebdriverIO.Browser);

    expect(ElectronCdpBridge).not.toHaveBeenCalled();
  });

  it('should propagate the launcher devServerUrl into the worker initial navigation', async () => {
    const launcher = new ElectronLaunchService({} as never, {} as never, {} as never);
    const perInstanceUrl = 'http://localhost:5174';
    const caps: Array<Record<string, unknown>> = [
      {
        browserName: 'electron',
        'wdio:electronServiceOptions': { mode: 'browser', devServerUrl: perInstanceUrl },
      },
    ];
    await launcher.onPrepare({} as never, caps as never);

    const worker = new ElectronWorkerService({ mode: 'browser', devServerUrl: perInstanceUrl }, caps[0] as never);
    const browser = createFakeBrowser();
    // initBrowserMode calls browser.url(devServerUrl) and then patches
    // browser.url. Capture the spy before the patch so we can assert on it.
    const urlSpy = browser.url;
    await worker.before({} as never, [], browser as unknown as WebdriverIO.Browser);

    expect(urlSpy).toHaveBeenCalledWith(perInstanceUrl);
  });
});
