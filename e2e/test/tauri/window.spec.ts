import { expect } from '@wdio/globals';
import { browser, withExecuteOptions } from '@wdio/tauri-service';

interface NativeWindowMetrics {
  x: number;
  y: number;
  width: number;
  height: number;
  scale_factor: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

const WINDOW_RECT_TOLERANCE = 1;

async function getNativeWindowMetrics(): Promise<NativeWindowMetrics> {
  return browser.tauri.execute(({ core }) => core.invoke('get_window_bounds')) as Promise<NativeWindowMetrics>;
}

async function getViewportSize(): Promise<ViewportSize> {
  return browser.execute<ViewportSize>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
}

function expectWithinTolerance(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(WINDOW_RECT_TOLERANCE);
}

describe('Multi-Window Support', () => {
  beforeEach(async () => {
    // Ensure we're on the main window before each test
    try {
      await browser.tauri.switchWindow('main');
    } catch {
      // If main doesn't exist, continue anyway
    }
  });

  describe('listWindows()', () => {
    it('should list all available windows', async () => {
      const windows = await browser.tauri.listWindows();
      expect(Array.isArray(windows)).toBe(true);
      expect(windows.length).toBeGreaterThanOrEqual(1);
      expect(windows).toContain('main');
    });

    it('should include splash window when available', async () => {
      const windows = await browser.tauri.listWindows();
      // Splash may or may not be enabled depending on build config
      // Just verify it's either present or 'main' is the only window
      if (windows.length > 1) {
        expect(windows).toContain('splash');
      }
    });
  });

  describe('switchWindow()', () => {
    it('should switch to main window', async () => {
      await browser.tauri.switchWindow('main');
      const title = await browser.getTitle();
      expect(title).toMatch(/Tauri.*E2E Test App/);
    });

    it('should switch to splash window when available', async () => {
      const windows = await browser.tauri.listWindows();

      if (!windows.includes('splash')) {
        console.log('[SKIP] Splash window not available in this build');
        return;
      }

      await browser.tauri.switchWindow('splash');
      await expect(browser).toHaveTitle('Splash Screen');
    });

    it('should throw for non-existent window', async () => {
      await expect(browser.tauri.switchWindow('nonexistent-window-12345')).rejects.toThrow();
    });

    it('should be able to switch back to main after switching to splash', async () => {
      const windows = await browser.tauri.listWindows();

      if (!windows.includes('splash')) {
        console.log('[SKIP] Splash window not available');
        return;
      }

      await browser.tauri.switchWindow('splash');
      await expect(browser).toHaveTitle('Splash Screen');

      await browser.tauri.switchWindow('main');
      await expect(browser).toHaveTitle(/Tauri.*E2E Test App/);
    });
  });
});

describe('per-call windowLabel option', () => {
  it('should execute in main window without switching session default', async () => {
    // Execute with explicit windowLabel
    const result = (await browser.tauri.execute(
      ({ core }) => core.invoke('plugin:wdio|get_active_window_label'),
      withExecuteOptions({
        windowLabel: 'main',
      }),
    )) as string;

    expect(result).toBe('main');
  });

  it('should throw when executing in non-existent window', async () => {
    await expect(
      browser.tauri.execute(
        ({ core }) => core.invoke('plugin:wdio|get_active_window_label'),
        withExecuteOptions({
          windowLabel: 'nonexistent-window-999',
        }),
      ),
    ).rejects.toThrow();
  });

  it('should execute in splash window with per-call option', async () => {
    const windows = await browser.tauri.listWindows();

    if (!windows.includes('splash')) {
      console.log('[SKIP] Splash window not available');
      return;
    }

    const result = (await browser.tauri.execute(
      ({ core }) => core.invoke('plugin:wdio|get_active_window_label'),
      withExecuteOptions({
        windowLabel: 'splash',
      }),
    )) as string;

    expect(result).toBe('splash');
  });
});

describe('application window tests', () => {
  before(async () => {
    const windows = await browser.tauri.listWindows();
    if (windows.includes('splash')) {
      await browser.tauri.switchWindow('splash');
    }
  });

  it('should launch the application splash screen window', async () => {
    const switchButton = await browser.$('.switch-main-window');
    const hasSwitchButton = await switchButton.isDisplayed();

    if (!hasSwitchButton) {
      console.log('[DEBUG] Splash not enabled, checking main window title');
      await expect(browser).toHaveTitle(/Tauri.*E2E Test App/);
      return;
    }

    if (browser.isMultiremote) {
      const multi = browser as unknown as WebdriverIO.MultiRemoteBrowser;
      const browserA = multi.getInstance('browserA');
      const browserB = multi.getInstance('browserB');
      await expect(browserA).toHaveTitle('Splash Screen');
      await expect(browserB).toHaveTitle('Splash Screen');
    } else {
      await expect(browser).toHaveTitle('Splash Screen');
    }
  });

  it('should switch to the application main window', async () => {
    const switchButton = await browser.$('.switch-main-window');
    const hasSwitchButton = await switchButton.isDisplayed();

    if (!hasSwitchButton) {
      console.log('[DEBUG] Splash not enabled, verifying main window');
      const title = await browser.getTitle();
      expect(title).toMatch(/Tauri.*E2E Test App/);
      return;
    }

    if (browser.isMultiremote) {
      const multi = browser as unknown as WebdriverIO.MultiRemoteBrowser;
      const browserA = multi.getInstance('browserA');
      const browserB = multi.getInstance('browserB');
      await (await browserA.$('.switch-main-window')).click();
      await (await browserB.$('.switch-main-window')).click();
      await browserA.tauri.switchWindow('main');
      await browserB.tauri.switchWindow('main');
      const titleA = await browserA.getTitle();
      const titleB = await browserB.getTitle();
      expect(titleA).toMatch(/Tauri.*E2E Test App/);
      expect(titleB).toMatch(/Tauri.*E2E Test App/);
    } else {
      const elem = await browser.$('.switch-main-window');
      await elem.click();
      await browser.tauri.switchWindow('main');
      const title = await browser.getTitle();
      expect(title).toMatch(/Tauri.*E2E Test App/);
    }
  });
});

describe('Embedded WebDriver WindowRect CSS pixel semantics', () => {
  before(async function () {
    if (process.env.DRIVER_PROVIDER !== 'embedded') {
      this.skip();
    }

    // Window rects are meaningful only after the splash fixture makes main visible.
    await browser.tauri.execute(({ core }) => core.invoke('switch_to_main'));
    await browser.tauri.switchWindow('main');
  });

  it('should return the native outer rect in logical pixels', async () => {
    const metrics = await getNativeWindowMetrics();
    const rect = await browser.getWindowRect();

    expectWithinTolerance(rect.x, Math.round(metrics.x / metrics.scale_factor));
    expectWithinTolerance(rect.y, Math.round(metrics.y / metrics.scale_factor));
    expectWithinTolerance(rect.width, Math.round(metrics.width / metrics.scale_factor));
    expectWithinTolerance(rect.height, Math.round(metrics.height / metrics.scale_factor));
  });

  it('should set the outer rect in logical pixels', async () => {
    const originalRect = await browser.getWindowRect();
    const targetRect = {
      x: originalRect.x + 20,
      y: originalRect.y + 20,
      width: 720,
      height: 540,
    };

    try {
      const rect = await browser.setWindowRect(targetRect.x, targetRect.y, targetRect.width, targetRect.height);
      const metrics = await getNativeWindowMetrics();

      expectWithinTolerance(rect.x, targetRect.x);
      expectWithinTolerance(rect.y, targetRect.y);
      expectWithinTolerance(rect.width, targetRect.width);
      expectWithinTolerance(rect.height, targetRect.height);
      expectWithinTolerance(rect.x, Math.round(metrics.x / metrics.scale_factor));
      expectWithinTolerance(rect.y, Math.round(metrics.y / metrics.scale_factor));
      expectWithinTolerance(rect.width, Math.round(metrics.width / metrics.scale_factor));
      expectWithinTolerance(rect.height, Math.round(metrics.height / metrics.scale_factor));
    } finally {
      await browser.setWindowRect(originalRect.x, originalRect.y, originalRect.width, originalRect.height);
    }
  });

  it('should set the outer size in logical pixels without shrinking the viewport', async () => {
    const originalRect = await browser.getWindowRect();
    const originalViewport = await getViewportSize();
    const targetRect = { width: 720, height: 540 };

    try {
      const rect = await browser.setWindowRect(null, null, targetRect.width, targetRect.height);
      const metrics = await getNativeWindowMetrics();
      const viewport = await getViewportSize();

      expectWithinTolerance(rect.x, originalRect.x);
      expectWithinTolerance(rect.y, originalRect.y);
      expectWithinTolerance(rect.width, targetRect.width);
      expectWithinTolerance(rect.height, targetRect.height);
      expectWithinTolerance(rect.width, Math.round(metrics.width / metrics.scale_factor));
      expectWithinTolerance(rect.height, Math.round(metrics.height / metrics.scale_factor));
      expectWithinTolerance(viewport.width - originalViewport.width, rect.width - originalRect.width);
      expectWithinTolerance(viewport.height - originalViewport.height, rect.height - originalRect.height);
    } finally {
      await browser.setWindowRect(originalRect.x, originalRect.y, originalRect.width, originalRect.height);
    }
  });
});
