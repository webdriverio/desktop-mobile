import { BrowserWindow } from 'electrobun/bun';

// Minimal Bun backend for the package-install smoke fixture: one CEF window.
const mainWindow = new BrowserWindow({
  title: 'WDIO Electrobun App',
  url: 'views://mainview/index.html',
  renderer: 'cef',
  frame: { x: 100, y: 100, width: 640, height: 480 },
});

console.log('[package-test] opened window', mainWindow.id);
