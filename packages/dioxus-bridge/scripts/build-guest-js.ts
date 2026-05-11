#!/usr/bin/env tsx

/**
 * Build script for the Dioxus bridge guest-js (browser-side code).
 *
 * Mirrors packages/tauri-plugin/scripts/build-guest-js.ts. Bundles the
 * TypeScript source into a single ES module so it can be loaded directly
 * in the browser without a bundler, then emits TypeScript declarations
 * for npm consumers.
 *
 * Outputs:
 * - dist-js/index.js    Bundled ES module
 * - dist-js/index.d.ts  Type declarations
 *
 * The Rust crate (wdio-dioxus-bridge) embeds dist-js/index.js via build.rs
 * and injects it into the Dioxus webview through Config::with_custom_head.
 */

import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..');

async function main(): Promise<void> {
  console.log('🔨 Building Dioxus bridge guest-js...');

  try {
    await build({
      entryPoints: [join(packageRoot, 'guest-js/index.ts')],
      bundle: true,
      format: 'esm',
      outfile: join(packageRoot, 'dist-js/index.js'),
      platform: 'browser',
      target: 'es2020',
    });

    console.log('✅ JavaScript bundle created');

    execSync('tsc --project tsconfig.json --emitDeclarationOnly', {
      cwd: packageRoot,
      stdio: 'inherit',
    });

    console.log('✅ Type declarations generated');
    console.log('🎉 Build complete!');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

main();
