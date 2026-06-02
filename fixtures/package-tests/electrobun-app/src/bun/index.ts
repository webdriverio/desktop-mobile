import { BrowserWindow } from 'electrobun/bun';

// Package-install smoke fixture. Opens TWO CEF windows, STAGGERED — the same workaround
// the e2e fixture uses: a single CEF window exposes no `/json` page target once CEF's
// forced `persist:default` partition falls back to the shared global context (an upstream
// gap; see @wdio/electrobun-service "Framework gaps"), so the bridge/Chromedriver would
// have nothing to attach to. Opening a second window makes a content target appear; doing
// it only after the first view's DOM is ready avoids the global-context creation race that
// otherwise leaves the main view unpainted. Both load the same mainview — the smoke only
// reads the main target.
const mainWindow = new BrowserWindow({
  title: 'WDIO Electrobun App',
  url: 'views://mainview/index.html',
  renderer: 'cef',
  frame: { x: 100, y: 100, width: 640, height: 480 },
});
console.log('[package-test] opened main window', mainWindow.id);

let secondOpened = false;
mainWindow.webview.on('dom-ready', () => {
  if (secondOpened) {
    return;
  }
  secondOpened = true;
  const secondWindow = new BrowserWindow({
    title: 'WDIO Electrobun App — 2',
    url: 'views://mainview/index.html',
    renderer: 'cef',
    frame: { x: 780, y: 150, width: 480, height: 360 },
  });
  console.log('[package-test] opened second window', secondWindow.id);
});
