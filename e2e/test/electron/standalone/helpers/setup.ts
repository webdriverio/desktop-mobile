import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';
import {
  cleanupWdioSession,
  createElectronCapabilities,
  getElectronBinaryPath,
  startWdioSession,
} from '@wdio/electron-service';
import type { ElectronStandaloneCapability } from '@wdio/native-types';
import { startDisplay } from '../../../../lib/display.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export interface StandaloneTestOptions {
  /**
   * Optional log capture configuration
   */
  logConfig?: {
    captureMainProcessLogs?: boolean;
    captureRendererLogs?: boolean;
    mainProcessLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    rendererLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    logDir?: string;
  };
}

export interface StandaloneTestSession {
  browser: WebdriverIO.Browser;
  appDir: string;
  cleanup: () => Promise<void>;
}

/**
 * Set up a standalone Electron test session with shared configuration
 */
export async function setupStandaloneTest(options: StandaloneTestOptions = {}): Promise<StandaloneTestSession> {
  process.env.TEST = 'true';

  // Electron app directory - use APP_DIR env var or default to electron-builder
  const defaultAppDir = path.join(__dirname, '..', '..', '..', '..', '..', 'fixtures', 'e2e-apps', 'electron-builder');
  const appDir = process.env.APP_DIR || defaultAppDir;

  if (!fs.existsSync(appDir)) {
    throw new Error(`Electron app directory not found: ${appDir}`);
  }

  // Determine if this is a script app (has dist/main/index.js instead of a built binary)
  const appDirName = path.basename(appDir);
  const isScript = appDirName.includes('script');
  const entryPoint = path.join(appDir, 'dist', 'main', 'index.js');

  let sessionOptions: ElectronStandaloneCapability;

  if (isScript && fs.existsSync(entryPoint)) {
    // Script mode: use entry point
    sessionOptions = createElectronCapabilities({
      appEntryPoint: entryPoint,
      appArgs: ['foo', 'bar=baz'],
      ...options.logConfig,
    });
  } else {
    // Binary mode: resolve binary path
    const appBinaryPath = await getElectronBinaryPath(appDir);
    sessionOptions = createElectronCapabilities({
      appBinaryPath,
      appArgs: ['foo', 'bar=baz'],
      ...options.logConfig,
    });
  }

  const display = await startDisplay();

  // Start the session
  const browser = await startWdioSession([sessionOptions]);

  // Wait for browser to be fully initialized
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Return session with cleanup function
  return {
    browser,
    appDir,
    cleanup: async () => {
      await browser.deleteSession();
      await cleanupWdioSession(browser);
      await display?.stop();
    },
  };
}
