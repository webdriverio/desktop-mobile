import { app, BrowserWindow } from 'electrobun/bun';

// Bun (main-process) backend for the Electrobun E2E fixture. Opens TWO CEF windows.
//
// Two windows are required even for the single-window `standard` suite: with only
// ONE CEF window, the chrome-runtime (after the forced `persist:default` partition
// fails to create and falls back to the shared global context — an upstream gap,
// see the agent-os plan "Framework gaps") does NOT reliably expose a `/json` page
// target, so the CDP bridge fails with "No CDP page targets were detected". With two
// windows the main view's target is enumerable (empirically: single-window ≈1/6
// specs pass, two-window 4–6/6). The second view also backs the CI-skipped window
// suite. The bridge labels content targets in registration order: first = 'main'
// (mainview), next = 'window-1' (secondview).

const mainWindow = new BrowserWindow({
  title: 'WDIO Electrobun E2E — Main',
  url: 'views://mainview/index.html',
  renderer: 'cef',
  frame: { x: 100, y: 100, width: 760, height: 640 },
});

const secondWindow = new BrowserWindow({
  title: 'WDIO Electrobun E2E — Second',
  url: 'views://secondview/index.html',
  renderer: 'cef',
  frame: { x: 900, y: 150, width: 520, height: 440 },
});

console.log('[e2e] opened windows', { main: mainWindow.id, second: secondWindow.id });

// Deeplink handler — `open wdio-electrobun://<path>` (macOS), routed via the
// urlSchemes entry in electrobun.config.ts. Surface the URL into the main view
// so a WebDriver test can read window.__wdioDeeplinks without a CDP side-channel.
app.on('open-url', (payload: unknown) => {
  const url = (payload as { url?: string })?.url ?? '';
  console.log('[e2e][open-url] received:', url);
  const js = `(() => {
    window.__wdioDeeplinks = window.__wdioDeeplinks || [];
    window.__wdioDeeplinks.push(${JSON.stringify(url)});
    var statusEl = document.getElementById('status');
    if (statusEl) { statusEl.textContent = 'Deeplink: ' + ${JSON.stringify(url)}; }
  })();`;
  mainWindow.webview.executeJavascript(js);
});

console.log('[e2e] bun backend ready');
