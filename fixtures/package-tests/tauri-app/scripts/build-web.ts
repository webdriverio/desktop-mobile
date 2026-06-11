#!/usr/bin/env node
/**
 * Build script for the Tauri test app web frontend
 *
 * This script prepares the web assets for the Tauri application:
 * 1. Creates the dist directory
 * 2. Copies index.html to dist/
 * 3. Copies the WebDriverIO Tauri plugin JavaScript to dist/plugins/
 *
 * The plugin JS location differs between environments:
 * - Monorepo:    fixtures/package-tests/tauri-app -> ../../../packages/tauri-plugin
 * - Isolated:    /tmp/.../tauri-app              -> ../packages/tauri-plugin
 * - Tarball CI:  node_modules/@wdio/tauri-plugin (installed from packed tarball)
 * - The script tries all paths to support every environment
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

function main() {
  console.log('Building web frontend...');

  // Create dist directory
  const distDir = join(projectRoot, 'dist');
  mkdirSync(distDir, { recursive: true });
  console.log('Created dist directory');

  // Copy index.html
  const indexHtml = join(projectRoot, 'index.html');
  const distIndexHtml = join(distDir, 'index.html');
  cpSync(indexHtml, distIndexHtml);
  console.log('Copied index.html');

  // Copy plugin JavaScript - try multiple paths for different environments
  const pluginPaths = [
    join(projectRoot, '../../../packages/tauri-plugin/dist-js/index.js'), // Monorepo
    join(projectRoot, '../packages/tauri-plugin/dist-js/index.js'), // Isolated test environment
    join(projectRoot, 'node_modules/@wdio/tauri-plugin/dist-js/index.js'), // Tarball install (Docker CI)
  ];

  let pluginCopied = false;
  for (const pluginPath of pluginPaths) {
    if (existsSync(pluginPath)) {
      const pluginsDir = join(distDir, 'plugins');
      mkdirSync(pluginsDir, { recursive: true });
      cpSync(pluginPath, join(pluginsDir, 'wdio-plugin.js'));
      console.log(`Copied plugin JS from ${pluginPath}`);
      pluginCopied = true;
      break;
    }
  }

  if (!pluginCopied) {
    console.error('Plugin JS not found at any of these locations:');
    for (const path of pluginPaths) {
      console.error(`   - ${path}`);
    }
    process.exit(1);
  }

  console.log('Web frontend build complete!');
}

main();
