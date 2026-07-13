import { expect } from '@wdio/globals';
import { browser } from '@wdio/tauri-service';

const describeChildWebviews =
  process.platform === 'darwin' && process.env.DRIVER_PROVIDER === 'embedded' ? describe : describe.skip;

const CHILD_LEFT = 'child-left';
const CHILD_RIGHT = 'child-right';
const GENERIC_CHILD = 'generic-child';
const DISPOSABLE_WINDOW = 'disposable-window';
const MAIN_WINDOW = 'main';

declare global {
  interface Window {
    __childWebviewLabel: string;
  }
}

type FixtureCommandResult<T> = T | { __webdriverError: string };

interface FixtureWindow {
  __TAURI__: {
    core: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    };
  };
  __childWebviewLabel: string;
}

interface WebDriverResponse<T> {
  value: T | WebDriverError;
}

interface WebDriverError {
  error: string;
  message: string;
}

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function invokeFixture<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.executeAsync<FixtureCommandResult<unknown>, [string, Record<string, unknown>]>(
    (commandName, commandArgs, done) => {
      (globalThis as unknown as FixtureWindow).__TAURI__.core
        .invoke<unknown>(commandName, commandArgs)
        .then(done)
        .catch((error: unknown) => done({ __webdriverError: String(error) }));
    },
    command,
    args,
  );

  if (typeof result === 'object' && result !== null && '__webdriverError' in result) {
    throw new Error(String(result.__webdriverError));
  }

  return result as T;
}

async function switchToMain(): Promise<void> {
  await browser.switchToWindow(MAIN_WINDOW);
}

async function createChildren(): Promise<void> {
  await switchToMain();
  await invokeFixture<void>('create_disposable_webview_window', { label: DISPOSABLE_WINDOW });
  await waitForHandles([DISPOSABLE_WINDOW]);
  await browser.switchToWindow(DISPOSABLE_WINDOW);
  await invokeFixture<void>('create_child_webview', { label: CHILD_LEFT, slot: 0 });
  await invokeFixture<void>('create_child_webview', { label: CHILD_RIGHT, slot: 1 });
}

async function removeChild(label: string): Promise<void> {
  const handles = await browser.getWindowHandles();
  await browser.switchToWindow(handles.includes(MAIN_WINDOW) ? MAIN_WINDOW : DISPOSABLE_WINDOW);
  await invokeFixture<void>('remove_child_webview', { label });
}

async function waitForHandles(expected: string[]): Promise<string[]> {
  let handles: string[] = [];
  await browser.waitUntil(
    async () => {
      handles = await browser.getWindowHandles();
      return expected.every((handle) => handles.includes(handle));
    },
    { timeoutMsg: `Expected window handles: ${expected.join(', ')}` },
  );
  return handles;
}

async function requestWebDriver<T>(path: string, init?: RequestInit): Promise<T> {
  const origin = `${browser.options.protocol ?? 'http'}://${browser.options.hostname ?? '127.0.0.1'}:${browser.options.port ?? 4445}`;
  const response = await fetch(`${origin}${path}`, init);
  const body = (await response.json()) as WebDriverResponse<T>;

  if (typeof body.value === 'object' && body.value !== null && 'error' in body.value) {
    throw new Error(`${body.value.error}: ${body.value.message}`);
  }
  if (!response.ok) {
    throw new Error(`WebDriver request failed with HTTP ${response.status} ${response.statusText}`);
  }

  return body.value;
}

async function deleteWebDriverSession(sessionId: string): Promise<void> {
  const result = await requestWebDriver<null>(`/session/${sessionId}`, { method: 'DELETE' });
  if (result !== null) {
    throw new Error(`Expected session deletion to return null, received ${JSON.stringify(result)}`);
  }
}

describeChildWebviews('child webview handles', () => {
  afterEach(async () => {
    const handles = await browser.getWindowHandles().catch(() => [] as string[]);
    const controlWindow = handles.includes(MAIN_WINDOW)
      ? MAIN_WINDOW
      : handles.includes(DISPOSABLE_WINDOW)
        ? DISPOSABLE_WINDOW
        : undefined;

    if (!controlWindow) {
      return;
    }

    await browser.switchToWindow(controlWindow).catch(() => undefined);
    for (const label of [CHILD_LEFT, CHILD_RIGHT, GENERIC_CHILD]) {
      await invokeFixture<void>('remove_child_webview', { label }).catch(() => undefined);
    }

    const remainingHandles = await browser.getWindowHandles().catch(() => [] as string[]);
    if (remainingHandles.includes(DISPOSABLE_WINDOW)) {
      await browser.switchToWindow(DISPOSABLE_WINDOW).catch(() => undefined);
      if ((await browser.getWindowHandle().catch(() => MAIN_WINDOW)) === DISPOSABLE_WINDOW) {
        await browser.closeWindow().catch(() => undefined);
      }
      await switchToMain().catch(() => undefined);
    }
  });

  it('refuses to remove main or an independent WebviewWindow through the child fixture command', async () => {
    await createChildren();

    await expect(invokeFixture<void>('remove_child_webview', { label: MAIN_WINDOW })).rejects.toThrow(
      /refusing to remove main/i,
    );
    await expect(invokeFixture<void>('remove_child_webview', { label: DISPOSABLE_WINDOW })).rejects.toThrow(
      /refusing to remove an independent webviewwindow/i,
    );
    await removeChild(CHILD_LEFT);
    await removeChild(CHILD_RIGHT);
    await waitForHandles([MAIN_WINDOW]);
    await switchToMain();
    await expect(browser).toHaveTitle('Tauri E2E Test App');
  });

  it('surfaces raw session cleanup errors', async () => {
    await expect(deleteWebDriverSession('missing-session')).rejects.toThrow(/invalid session id/i);
    await switchToMain();
    await expect(browser).toHaveTitle('Tauri E2E Test App');
  });

  it('enumerates, switches, and executes in sibling child webviews', async () => {
    await createChildren();
    await waitForHandles([MAIN_WINDOW, DISPOSABLE_WINDOW, CHILD_LEFT, CHILD_RIGHT]);

    await browser.switchToWindow(CHILD_LEFT);
    await expect(browser.$('#child-output')).toHaveText('idle');
    expect(await browser.getWindowHandle()).toBe(CHILD_LEFT);
    await expect(browser).toHaveTitle(`Child WebView ${CHILD_LEFT}`);
    expect(await browser.execute(() => (globalThis as unknown as FixtureWindow).__childWebviewLabel)).toBe(CHILD_LEFT);
    await (await browser.$('#child-button')).click();
    await expect(browser.$('#child-output')).toHaveText(`activated:${CHILD_LEFT}`);

    await browser.switchToWindow(CHILD_RIGHT);
    await expect(browser).toHaveTitle(`Child WebView ${CHILD_RIGHT}`);
    expect(await browser.execute(() => (globalThis as unknown as FixtureWindow).__childWebviewLabel)).toBe(CHILD_RIGHT);
    await expect(browser.$('#child-output')).toHaveText('idle');
  });

  it('creates a session with an initial child-webview label', async () => {
    await createChildren();

    const created = await requestWebDriver<{ sessionId: string }>('/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capabilities: {
          alwaysMatch: {
            'wdio:tauriServiceOptions': { windowLabel: CHILD_LEFT },
          },
        },
      }),
    });
    expect(created.sessionId).toBeTruthy();

    try {
      expect(await requestWebDriver<string>(`/session/${created.sessionId}/window`)).toBe(CHILD_LEFT);
    } finally {
      await deleteWebDriverSession(created.sessionId);
    }
  });

  it('reports and updates child bounds without resizing the host', async () => {
    await createChildren();
    await waitForHandles([CHILD_LEFT]);
    await switchToMain();
    const nativeHostBefore = await invokeFixture<WindowBounds>('get_window_bounds');
    expect(await browser.getWindowRect()).toEqual(nativeHostBefore);

    await browser.switchToWindow(CHILD_LEFT);
    expect(await browser.setWindowRect(20, 20, 240, 160)).toEqual({ x: 20, y: 20, width: 240, height: 160 });
    expect(await browser.getWindowRect()).toEqual({ x: 20, y: 20, width: 240, height: 160 });

    await switchToMain();
    expect(await browser.getWindowRect()).toEqual(nativeHostBefore);
    expect(await invokeFixture<WindowBounds>('get_window_bounds')).toEqual(nativeHostBefore);
  });

  it('rejects closeWindow for a child without closing its host', async () => {
    await createChildren();
    await waitForHandles([CHILD_LEFT]);
    await browser.switchToWindow(CHILD_LEFT);

    await expect(browser.closeWindow()).rejects.toThrow(/unsupported operation/i);
    await switchToMain();
    await expect(browser).toHaveTitle('Tauri E2E Test App');
  });

  it('drops removed child handles and returns no such window', async () => {
    await createChildren();
    await waitForHandles([CHILD_RIGHT]);
    await removeChild(CHILD_RIGHT);

    await browser.waitUntil(async () => !(await browser.getWindowHandles()).includes(CHILD_RIGHT), {
      timeoutMsg: `Expected ${CHILD_RIGHT} handle to be removed`,
    });
    await expect(
      requestWebDriver<null>(`/session/${browser.sessionId}/window`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: CHILD_RIGHT }),
      }),
    ).rejects.toThrow(/no such window/i);
  });

  it('preserves closeWindow for an independent WebviewWindow', async () => {
    await switchToMain();
    await invokeFixture<void>('create_disposable_webview_window', { label: DISPOSABLE_WINDOW });
    await waitForHandles([DISPOSABLE_WINDOW]);
    await browser.switchToWindow(DISPOSABLE_WINDOW);

    const remaining = await browser.closeWindow();
    expect(remaining).toContain(MAIN_WINDOW);
    await browser.waitUntil(async () => !(await browser.getWindowHandles()).includes(DISPOSABLE_WINDOW), {
      timeoutMsg: `Expected ${DISPOSABLE_WINDOW} handle to be removed`,
    });
    await switchToMain();
    await expect(browser).toHaveTitle('Tauri E2E Test App');
  });

  it('removes a managed child with an arbitrary label', async () => {
    await switchToMain();
    await invokeFixture<void>('create_disposable_webview_window', { label: DISPOSABLE_WINDOW });
    await waitForHandles([DISPOSABLE_WINDOW]);
    await browser.switchToWindow(DISPOSABLE_WINDOW);
    await invokeFixture<void>('create_child_webview', { label: GENERIC_CHILD, slot: 0 });

    await invokeFixture<void>('remove_child_webview', { label: GENERIC_CHILD });
    await waitForHandles([MAIN_WINDOW, DISPOSABLE_WINDOW]);
    await switchToMain();
    await expect(browser).toHaveTitle('Tauri E2E Test App');
  });
});
