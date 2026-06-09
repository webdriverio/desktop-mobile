import { BrowserWindow } from 'electrobun/bun';

// Package-install smoke fixture. The renderer follows the per-OS electrobun.config.ts
// default (CEF on macOS/Linux, native WebView2 on Windows).
//
// macOS/Linux (CEF): open a STAGGERED second window — a single CEF window doesn't reliably
// expose a `/json` page target once the forced `persist:default` partition falls back to the
// shared global context (an upstream gap; see @wdio/electrobun-service "Framework gaps"), so
// the bridge would have nothing to attach to. Staggering behind the first view's dom-ready
// avoids the global-context creation race that otherwise leaves the main view unpainted.
// Windows (WebView2): a single window exposes `/json` cleanly, so the second window is
// unnecessary. The smoke only reads the main target either way.
const isWindows = process.platform === 'win32';

const mainWindow = new BrowserWindow({
  title: 'WDIO Electrobun App',
  url: 'views://mainview/index.html',
  frame: { x: 100, y: 100, width: 640, height: 480 },
});
console.log('[package-test] opened main window', mainWindow.id);

if (!isWindows) {
  let secondOpened = false;
  mainWindow.webview.on('dom-ready', () => {
    if (secondOpened) {
      return;
    }
    secondOpened = true;
    const secondWindow = new BrowserWindow({
      title: 'WDIO Electrobun App — 2',
      url: 'views://mainview/index.html',
      frame: { x: 780, y: 150, width: 480, height: 360 },
    });
    console.log('[package-test] opened second window', secondWindow.id);
  });
}
