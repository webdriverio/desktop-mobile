import { app, BrowserWindow } from 'electrobun/bun';

// Bun (main-process) backend for the Electrobun E2E fixture.
//
// The main window is always opened. The SECOND window is opened only when
// WDIO_ELECTROBUN_SECOND_WINDOW=1 (set by the window-suite conf). Opening two CEF
// BrowserWindows forces both onto the `persist:default` partition the CEF
// chrome-runtime can't create as a non-global profile, so both fall back to the
// shared global context and hit electrobun's documented multi-browser race
// ("Timeout of new browser info response"). That race can break EITHER window, so
// opening the second window unconditionally made every suite flaky (api/application
// would intermittently fail because mainview lost the race). Scoping it to the
// window suite — which is gated allow-failure upstream — keeps the single-window
// suites (standard, deeplink) stable.

const mainWindow = new BrowserWindow({
  title: 'WDIO Electrobun E2E — Main',
  url: 'views://mainview/index.html',
  renderer: 'cef',
  frame: { x: 100, y: 100, width: 760, height: 640 },
});
console.log('[e2e] opened main window', { main: mainWindow.id });

if (process.env.WDIO_ELECTROBUN_SECOND_WINDOW === '1') {
  const secondWindow = new BrowserWindow({
    title: 'WDIO Electrobun E2E — Second',
    url: 'views://secondview/index.html',
    renderer: 'cef',
    frame: { x: 900, y: 150, width: 520, height: 440 },
  });
  console.log('[e2e] opened second window', { second: secondWindow.id });
}

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
