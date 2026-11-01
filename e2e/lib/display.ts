import { startDisplayDaemonFromConfig } from '@wdio/display-server';
import type { Options } from '@wdio/types';

// The Tauri fixture's clipboard crate needs X11, and the WebKitGTK services are tested on X11, so
// these runs ask for Xvfb rather than Weston.
export const webkitDisplayServer = { displayServer: 'xvfb' } as const;

// Standalone specs bypass the testrunner, which is what starts the display, so they start their own.
export function startDisplay(config: Partial<Options.Testrunner> = {}) {
  return startDisplayDaemonFromConfig(config as Options.Testrunner);
}
