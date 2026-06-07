#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = join(__dirname, '..');
const WEBDRIVERIO_DIR = join(ROOT_DIR, '..', 'webdriverio');
const TMP_DIR = '/tmp';

console.log('🚀 Starting package update process...\n');

/**
 * Execute a command and log it
 */
function runCommand(command: string, cwd?: string) {
  console.log(`📝 Running: ${command}`);
  try {
    execSync(command, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
    });
  } catch (error) {
    console.error(`❌ Command failed: ${command}`);
    throw error;
  }
}

/**
 * Update wdio-utils package
 */
function updateWdioUtils() {
  console.log('🔧 Updating @wdio/utils...');

  // Build dependencies first
  console.log('  🔨 Compiling @wdio/types (dependency)...');
  runCommand('pnpm exec tsx ./infra/compiler/src/index.ts -p @wdio/types', WEBDRIVERIO_DIR);

  console.log('  🔨 Compiling @wdio/logger (dependency)...');
  runCommand('pnpm exec tsx ./infra/compiler/src/index.ts -p @wdio/logger', WEBDRIVERIO_DIR);

  // Build wdio-utils
  console.log('  🔨 Compiling wdio-utils...');
  runCommand('pnpm exec tsx ./infra/compiler/src/index.ts -p @wdio/utils', WEBDRIVERIO_DIR);

  // Package it
  const wdioUtilsDir = join(WEBDRIVERIO_DIR, 'packages', 'wdio-utils');
  runCommand(`npm pack --pack-destination ${TMP_DIR}`, wdioUtilsDir);

  // Get the actual packed filename
  const wdioPackOutput = execSync('npm pack --dry-run', { cwd: wdioUtilsDir, encoding: 'utf8' });
  const wdioPackMatch = wdioPackOutput.match(/wdio-utils-[\d.]+\.tgz/);
  if (!wdioPackMatch) {
    throw new Error('Could not determine packed filename from npm pack output');
  }
  const packedFile = wdioPackMatch[0];

  // Extract and fix dependencies
  const extractDir = join(TMP_DIR, 'wdio-utils-fix');

  // Clean up any existing extract dir
  if (existsSync(extractDir)) {
    runCommand(`rm -rf ${extractDir}`);
  }

  // Extract
  mkdirSync(extractDir);
  runCommand(`tar -xf ${TMP_DIR}/${packedFile}`, extractDir);

  // Fix dependencies in package.json
  const packageJsonPath = join(extractDir, 'package', 'package.json');
  runCommand(
    `jq '
    .dependencies["@wdio/logger"] = "^9.18.0" |
    .dependencies["@wdio/types"] = "9.20.0" |
    del(.dependencies["@wdio/chromedriver-downloader"])
  ' "${packageJsonPath}" > "${packageJsonPath}.tmp"`,
    extractDir,
  );

  runCommand(`mv ${packageJsonPath}.tmp ${packageJsonPath}`, extractDir);

  // Repackage
  runCommand(`tar -czf ${ROOT_DIR}/${packedFile} -C ${extractDir} package`);

  // Clean up
  runCommand(`rm -rf ${extractDir}`);

  console.log('✅ @wdio/utils updated\n');
}

/**
 * Update workspace dependencies
 */
function updateWorkspace() {
  console.log('🔧 Updating workspace dependencies...');

  // Clear cache and reinstall
  // Note: Regenerating pnpm-lock.yaml ensures CI cache is busted when tarballs change
  runCommand('pnpm store prune', ROOT_DIR);
  runCommand('rm -f pnpm-lock.yaml', ROOT_DIR);
  runCommand('pnpm install', ROOT_DIR);

  console.log('  ✓ pnpm-lock.yaml regenerated (this will bust CI cache)');
  console.log('✅ Workspace updated\n');
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('📦 Updating all packages...\n');

    updateWdioUtils();
    updateWorkspace();

    console.log('🎉 All packages updated successfully!');
    console.log('\n📋 Summary:');
    console.log('- @wdio/utils: Updated to detect electron usage and use fallback sources');
    console.log('- Workspace: Updated with new package versions');
    console.log('\n🚀 Ready for ARM64 CI testing!');
  } catch (error) {
    console.error('\n❌ Package update failed:', error);
    process.exit(1);
  }
}

// Run the script
main();
