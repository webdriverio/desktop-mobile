#!/usr/bin/env node
/**
 * Build script that minifies the readable console-wrapper source into a compact
 * inline script for injection via browser.execute().
 *
 * Reads:  src/scripts/console-wrapper.source.js
 * Writes: src/scripts/console-wrapper.ts (generated, committed)
 *
 * Constants from src/constants/logging.ts are substituted before minification
 * so the final script has no external dependencies.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, '..');

// Import constants directly from the source of truth
import { CONSOLE_WRAPPED_KEY, LOG_FRONTEND_COMMAND, PREFIXES } from '../src/constants/logging.ts';

const SOURCE_PATH = resolve(PKG_ROOT, 'src/scripts/console-wrapper.source.js');
const OUTPUT_PATH = resolve(PKG_ROOT, 'src/scripts/console-wrapper.ts');

async function main() {
  // Read readable source
  let source = readFileSync(SOURCE_PATH, 'utf-8');

  // Substitute placeholder constants with actual values
  const replacements: Record<string, string> = {
    CONSOLE_WRAPPED_KEY: CONSOLE_WRAPPED_KEY,
    LOG_FRONTEND_COMMAND: LOG_FRONTEND_COMMAND,
    FRONTEND_PREFIX: PREFIXES.frontend,
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    // Replace the const declarations with the actual string values
    // e.g. `const CONSOLE_WRAPPED_KEY = '__WDIO_CONSOLE_WRAPPED__';` -> inlined value
    source = source.replace(new RegExp(`const ${placeholder} = '[^']*';`), `const ${placeholder} = '${value}';`);
  }

  // Minify with terser
  const result = await minify(source, {
    compress: {
      dead_code: true,
      drop_debugger: true,
      keep_fargs: false,
      keep_fnames: false,
      passes: 2,
    },
    mangle: {
      reserved: ['console', 'window', 'Promise', 'Error', 'JSON', 'Array', 'setTimeout', 'Symbol'],
    },
    format: {
      comments: false,
    },
  });

  if (!result.code) {
    console.error('Terser produced no output');
    process.exit(1);
  }

  // Escape backticks and dollar signs for template literal
  const escaped = result.code.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

  // Write generated TypeScript file
  const output = `// AUTO-GENERATED - Do not edit manually.
// Source: src/scripts/console-wrapper.source.js
// Regenerate: pnpm --filter @wdio/tauri-service build:console-wrapper
export const CONSOLE_WRAPPER_SCRIPT = \`${escaped}\`;
`;

  writeFileSync(OUTPUT_PATH, output, 'utf-8');

  console.log(`Minified console wrapper: ${source.length} -> ${result.code.length} bytes (${OUTPUT_PATH})`);
}

main().catch((err) => {
  console.error('Failed to minify console wrapper:', err);
  process.exit(1);
});
