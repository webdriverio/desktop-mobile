import { createEnvironmentContext } from './config/envSchema.js';

/**
 * Main WDIO configuration that delegates to framework-specific configs
 * Based on the FRAMEWORK environment variable, this will load either:
 * - wdio.electron.conf.ts for Electron tests
 * - wdio.tauri.conf.ts for Tauri tests (external/crabnebula provider)
 * - wdio.tauri-embedded.conf.ts for Tauri tests (embedded provider)
 */

// Parse environment to determine framework
const envContext = createEnvironmentContext();

// Dynamically import the appropriate configuration
let config: Record<string, unknown>;

if (envContext.framework === 'tauri') {
  // Use embedded config when driverProvider is 'embedded'
  if (envContext.driverProvider === 'embedded') {
    const { config: tauriEmbeddedConfig } = await import('./wdio.tauri-embedded.conf.js');
    config = tauriEmbeddedConfig;
  } else {
    const { config: tauriConfig } = await import('./wdio.tauri.conf.js');
    config = tauriConfig;
  }
} else {
  const { config: electronConfig } = await import('./wdio.electron.conf.js');
  config = electronConfig;
}

export { config };
