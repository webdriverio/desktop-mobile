import { app, BrowserWindow } from 'electrobun/bun';

// Bun (main-process) backend for the Electrobun E2E fixture. The renderer follows the
// per-OS electrobun.config.ts default (CEF on macOS/Linux, native WebView2 on Windows),
// so no per-window `renderer` is set here.
//
// macOS/Linux (CEF): open TWO windows, STAGGERED — the second only after the main view's
// DOM is ready. Two are needed so the CDP bridge can enumerate a 'window-1' target: a lone
// CEF window doesn't reliably expose a `/json` page target after the forced `persist:default`
// partition falls back to the shared global context (an upstream gap, see the agent-os plan
// "Framework gaps"). Opening both concurrently races that fallback — a browser can spawn a
// separate top-level window instead of embedding via SetAsChild, leaving mainview's DOM
// unpainted ("#app-title never rendered" → flaky). Staggering lets mainview embed + paint
// cleanly first. The bridge labels content targets in registration order: first = 'main'
// (mainview), next = 'window-1' (secondview).
//
// Windows (WebView2): no persist:default race, so the second window opens immediately
// (concurrently) rather than staggered behind dom-ready.

const mainWindow = new BrowserWindow({
  title: 'WDIO Electrobun E2E — Main',
  url: 'views://mainview/index.html',
  frame: { x: 100, y: 100, width: 760, height: 640 },
});
console.log('[e2e] opened main window', { main: mainWindow.id });

const openSecondWindow = (): void => {
  const secondWindow = new BrowserWindow({
    title: 'WDIO Electrobun E2E — Second',
    url: 'views://secondview/index.html',
    frame: { x: 900, y: 150, width: 520, height: 440 },
  });
  console.log('[e2e] opened second window', { second: secondWindow.id });
};

// SPIKE (#320 CEF-on-Windows): every platform builds CEF here, so stagger the second window
// behind mainview's dom-ready on all platforms (the CEF workaround described above).
let secondOpened = false;
mainWindow.webview.on('dom-ready', () => {
  if (secondOpened) {
    return;
  }
  secondOpened = true;
  openSecondWindow();
});

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
