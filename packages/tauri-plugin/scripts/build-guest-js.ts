#!/usr/bin/env tsx

/**
 * Build script for the Tauri plugin guest-js (browser-side code)
 *
 * This script bundles the guest-js TypeScript code into a single ES module
 * that can be loaded directly in the browser without a bundler.
 *
 * Why we bundle:
 * - The guest-js imports @wdio/native-spy for mocking functionality
 * - Browsers can't resolve bare module specifiers like '@wdio/native-spy'
 * - Package test apps load the plugin without a bundler (no Vite)
 * - E2E apps use Vite which can resolve imports, but bundling works there too
 *
 * Build outputs:
 * - dist-js/index.js    - Bundled ES module with all dependencies inlined
 * - dist-js/index.d.ts  - TypeScript type declarations
 *
 * External dependencies:
 * - @tauri-apps/api - Provided by the Tauri app (not bundled)
 *
 * NOTE: If we add more browser-side bundles in the future (e.g., more plugins
 * with guest-js), consider adding a 'browser' mode to @wdio/bundler instead
 * of using esbuild directly.
 */

import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..');

async function main() {
  console.log('🔨 Building Tauri plugin guest-js...');

  try {
    // Bundle JavaScript with esbuild
    await build({
      entryPoints: [join(packageRoot, 'guest-js/index.ts')],
      bundle: true,
      format: 'esm',
      outfile: join(packageRoot, 'dist-js/index.js'),
      platform: 'browser',
      target: 'es2020',
      // External dependencies provided by the Tauri app
      external: ['@tauri-apps/api'],
    });

    console.log('✅ JavaScript bundle created');

    // Generate TypeScript declarations with tsc, using tsconfig.json for moduleResolution
    execSync('tsc --project tsconfig.json --emitDeclarationOnly', { cwd: packageRoot, stdio: 'inherit' });

    console.log('✅ Type declarations generated');
    console.log('🎉 Build complete!');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

main();
