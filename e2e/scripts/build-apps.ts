#!/usr/bin/env tsx

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createEnvironmentContext } from '../config/envSchema.js';
import { dirExists, execWithEnv, fileExists, formatDuration, getE2EAppDirName } from '../lib/utils.js';

/**
 * Manager for E2E app building
 */
export class BuildManager {
  private builtApps = new Set<string>();

  /**
   * Ensure an app is built (builds only if needed)
   */
  async ensureAppBuilt(appPath: string): Promise<boolean> {
    console.log(`🔍 Debug: Checking if app needs building: ${appPath}`);
    console.log(`  Platform: ${process.platform}`);
    console.log(`  Already built apps: ${Array.from(this.builtApps).join(', ') || 'none'}`);

    // Check for force rebuild environment variable
    const forceRebuild = process.env.FORCE_REBUILD === 'true' || process.env.FORCE_BUILD === 'true';
    if (forceRebuild) {
      console.log(`🔄 FORCE_REBUILD=true detected, will rebuild regardless of existing artifacts`);
    }

    if (this.builtApps.has(appPath) && !forceRebuild) {
      console.log(`✅ App already built in this session: ${appPath}`);
      return true;
    }

    // Check if valid build artifacts already exist (unless forcing rebuild)
    if (!forceRebuild && this.hasValidBuildArtifacts(appPath)) {
      console.log(`✅ Valid build artifacts found, skipping build: ${appPath}`);
      this.builtApps.add(appPath);
      return true;
    }

    if (forceRebuild && this.hasValidBuildArtifacts(appPath)) {
      console.log(`🔄 Valid build artifacts found, but forcing rebuild due to FORCE_REBUILD=true`);
    }

    console.log(`🔍 Debug: Checking app directory existence: ${appPath}`);
    if (!dirExists(appPath)) {
      console.error(`❌ App directory does not exist: ${appPath}`);
      console.log(`🔍 Debug: Current working directory: ${process.cwd()}`);
      console.log(`🔍 Debug: Listing parent directory contents...`);
      try {
        const parentDir = dirname(appPath);
        const fs = await import('node:fs');
        const contents = fs.readdirSync(parentDir);
        console.log(`  Parent directory (${parentDir}) contents: ${contents.join(', ')}`);
      } catch (error) {
        console.log(`  Failed to list parent directory: ${error}`);
      }
      throw new Error(`App directory does not exist: ${appPath}`);
    }

    const packageJsonPath = join(appPath, 'package.json');
    console.log(`🔍 Debug: Checking package.json: ${packageJsonPath}`);
    if (!fileExists(packageJsonPath)) {
      console.error(`❌ package.json not found in: ${appPath}`);
      console.log(`🔍 Debug: Listing app directory contents...`);
      try {
        const fs = await import('node:fs');
        const contents = fs.readdirSync(appPath);
        console.log(`  App directory contents: ${contents.join(', ')}`);
      } catch (error) {
        console.log(`  Failed to list app directory: ${error}`);
      }
      throw new Error(`package.json not found in: ${appPath}`);
    }

    console.log(`🔨 Building app: ${appPath}`);
    const startTime = Date.now();

    try {
      // Only clean if we don't have valid artifacts (this is a forced rebuild)
      const distPath = join(appPath, 'dist');
      const outPath = join(appPath, 'out');
      const distElectronPath = join(appPath, 'dist-electron');

      if (dirExists(distPath) || dirExists(outPath) || dirExists(distElectronPath)) {
        console.log(`  Cleaning existing build directories...`);
        await this.runCommand('pnpm run clean:dist', appPath);
      }

      // Install dependencies
      await this.runCommand('pnpm install', appPath);

      // Build the app (all apps use the same build command)
      await this.runCommand('pnpm run build', appPath);

      const duration = Date.now() - startTime;
      console.log(`✅ App built successfully in ${formatDuration(duration)}: ${appPath}`);

      this.builtApps.add(appPath);
      return true;
    } catch (error) {
      console.error(`❌ Failed to build app: ${appPath}`, error);
      return false;
    }
  }

  /**
   * Build all apps for the current environment
   */
  async buildAppsForEnvironment(): Promise<void> {
    const envContext = createEnvironmentContext();

    console.log(`🏗️ Building apps for environment: ${envContext.toString()}`);

    // Determine which apps to build based on framework
    const appsToBuild: string[] = [];

    const e2eAppsDir = join(process.cwd(), '..', 'fixtures', 'e2e-apps');
    const appDirName = getE2EAppDirName(envContext.framework, envContext.app, envContext.isScript);
    appsToBuild.push(join(e2eAppsDir, appDirName));

    console.log(`📦 Apps to build: ${appsToBuild.map((p) => p.split('/').pop()).join(', ')}`);

    // Build each app
    for (const appPath of appsToBuild) {
      await this.ensureAppBuilt(appPath);
    }
  }

  /**
   * Build all apps (for comprehensive testing)
   */
  async buildAllApps(): Promise<void> {
    console.log('🏗️ Building all apps...');

    // Build Electron apps
    const e2eAppsDir = join(process.cwd(), '..', 'fixtures', 'e2e-apps');
    const electronAppDirs = ['electron-builder', 'electron-forge', 'electron-script'];

    console.log('📦 Building Electron apps...');
    for (const appDir of electronAppDirs) {
      const appPath = join(e2eAppsDir, appDir);
      if (dirExists(appPath)) {
        await this.ensureAppBuilt(appPath);
      } else {
        console.warn(`⚠️ Electron app directory not found: ${appPath}`);
      }
    }

    // Build Tauri apps
    const tauriAppDirs = ['tauri'];

    console.log('📦 Building Tauri apps...');
    for (const appDir of tauriAppDirs) {
      const appPath = join(e2eAppsDir, appDir);
      if (dirExists(appPath)) {
        await this.ensureAppBuilt(appPath);
      } else {
        console.warn(`⚠️ Tauri app directory not found: ${appPath}`);
      }
    }
  }

  /**
   * Check if an app needs building
   */
  needsBuild(appPath: string): boolean {
    if (this.builtApps.has(appPath)) {
      return false;
    }

    return !this.hasValidBuildArtifacts(appPath);
  }

  /**
   * Check if app has valid build artifacts
   */
  private hasValidBuildArtifacts(appPath: string): boolean {
    // Check if this is a Tauri app
    const tauriConfigPath = join(appPath, 'src-tauri', 'tauri.conf.json');
    const isTauriApp = fileExists(tauriConfigPath);

    if (isTauriApp) {
      return this.hasValidTauriBuildArtifacts(appPath);
    } else {
      return this.hasValidElectronBuildArtifacts(appPath);
    }
  }

  /**
   * Check if Tauri app has valid build artifacts
   */
  private hasValidTauriBuildArtifacts(appPath: string): boolean {
    const tauriTargetDir = join(appPath, 'target', 'debug');

    if (!dirExists(tauriTargetDir)) {
      console.log(`🔍 Debug: No Tauri target directory found at ${tauriTargetDir}`);
      return false;
    }

    try {
      // Check for Tauri binary based on platform
      let binaryPath: string;
      if (process.platform === 'win32') {
        binaryPath = join(tauriTargetDir, 'tauri-e2e-app.exe');
      } else if (process.platform === 'darwin') {
        // macOS: check for raw binary (tauri build without bundling)
        binaryPath = join(tauriTargetDir, 'tauri-e2e-app');
      } else if (process.platform === 'linux') {
        binaryPath = join(tauriTargetDir, 'tauri-e2e-app');
      } else {
        console.log(`🔍 Debug: Unsupported platform for Tauri: ${process.platform}`);
        return false;
      }

      if (!fileExists(binaryPath)) {
        console.log(`🔍 Debug: Tauri binary not found at ${binaryPath}`);
        return false;
      }

      console.log(`✅ Valid Tauri build artifacts found at ${appPath}`);
      return true;
    } catch (error) {
      console.log(`🔍 Debug: Error checking Tauri build artifacts at ${appPath}:`, error);
      return false;
    }
  }

  /**
   * Check if Electron app has valid build artifacts
   */
  private hasValidElectronBuildArtifacts(appPath: string): boolean {
    // Check if dist directory exists and has content
    const distPath = join(appPath, 'dist');
    if (!dirExists(distPath)) {
      console.log(`🔍 Debug: No dist directory found at ${distPath}`);
      return false;
    }

    try {
      const distContents = readdirSync(distPath);
      if (distContents.length === 0) {
        console.log(`🔍 Debug: Dist directory is empty at ${distPath}`);
        return false;
      }

      // Check for essential build artifacts (electron-vite structure)
      const mainPath = join(distPath, 'main', 'index.js');
      const hasMainJs = fileExists(mainPath);

      if (!hasMainJs) {
        console.log(`🔍 Debug: Missing main/index.js in ${distPath}`);
        return false;
      }

      // For forge apps, also check for out directory with packaged app
      const packageJsonPath = join(appPath, 'package.json');
      if (fileExists(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        if (packageJson.name?.includes('forge')) {
          const outPath = join(appPath, 'out');
          if (!dirExists(outPath)) {
            console.log(`🔍 Debug: Forge app missing out directory at ${outPath}`);
            return false;
          }

          const outContents = readdirSync(outPath);
          if (outContents.length === 0) {
            console.log(`🔍 Debug: Forge app out directory is empty at ${outPath}`);
            return false;
          }
        }
      }

      console.log(`✅ Valid Electron build artifacts found at ${appPath}`);
      return true;
    } catch (error) {
      console.log(`🔍 Debug: Error checking Electron build artifacts at ${appPath}:`, error);
      return false;
    }
  }

  /**
   * Run a command in a specific directory
   */
  private async runCommand(command: string, cwd: string): Promise<void> {
    const cwdName = process.platform === 'win32' ? cwd.split('\\').pop() : cwd.split('/').pop();
    console.log(`  Running: ${command} (in ${cwdName})`);

    // Add CI environment debugging
    console.log(`🔍 Debug: CI Environment Info:`);
    console.log(`    CI: ${process.env.CI || 'false'}`);
    console.log(`    GITHUB_ACTIONS: ${process.env.GITHUB_ACTIONS || 'false'}`);
    console.log(`    RUNNER_OS: ${process.env.RUNNER_OS || 'unknown'}`);
    console.log(`    Memory usage: ${JSON.stringify(process.memoryUsage())}`);
    console.log(`    Platform: ${process.platform} ${process.arch}`);
    console.log(`    Node version: ${process.version}`);
    console.log(`    Working directory: ${cwd}`);
    console.log(`    Free disk space check...`);

    try {
      // Check disk space on Unix systems
      if (process.platform !== 'win32') {
        const { execSync } = await import('node:child_process');
        try {
          const dfOutput = execSync('df -h .', { cwd, encoding: 'utf8' });
          console.log(`    Disk space: ${dfOutput.split('\n')[1]}`);
        } catch (e) {
          console.log(`    Could not check disk space: ${e}`);
        }
      }
    } catch (e) {
      console.log(`    Disk space check failed: ${e}`);
    }

    const startTime = Date.now();
    console.log(`🔍 Debug: Starting command at ${new Date().toISOString()}`);

    try {
      const result = await execWithEnv(command, {}, { cwd, timeout: 180000 }); // 3 minutes
      const duration = Date.now() - startTime;

      console.log(`🔍 Debug: Command completed in ${duration}ms with exit code: ${result.code}`);

      if (result.stdout) {
        console.log(
          `🔍 Debug: Command stdout (${result.stdout.length} chars): ${result.stdout.slice(0, 500)}${result.stdout.length > 500 ? '...' : ''}`,
        );
      }
      if (result.stderr) {
        console.log(
          `🔍 Debug: Command stderr (${result.stderr.length} chars): ${result.stderr.slice(0, 500)}${result.stderr.length > 500 ? '...' : ''}`,
        );
      }

      if (result.code !== 0) {
        console.error(`❌ Command failed with code ${result.code} after ${duration}ms`);
        console.error(`❌ Full stderr: ${result.stderr}`);
        console.error(`❌ Full stdout: ${result.stdout}`);
        throw new Error(`Command failed with code ${result.code}: ${result.stderr}`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Command failed after ${duration}ms: ${command}`);
      console.error(`❌ Working directory: ${cwd}`);
      console.error(`❌ Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
      console.error(`❌ Error message: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`❌ Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
      throw error;
    }
  }

  /**
   * Clean built apps (remove dist directories)
   */
  async cleanApps(): Promise<void> {
    console.log('🧹 Cleaning app build artifacts...');

    // Clean Electron apps
    const e2eAppsDir = join(process.cwd(), '..', 'fixtures', 'e2e-apps');
    const electronAppDirs = ['electron-builder', 'electron-forge', 'electron-script'];

    console.log('🧹 Cleaning Electron apps...');
    for (const appDir of electronAppDirs) {
      const appPath = join(e2eAppsDir, appDir);
      const distPath = join(appPath, 'dist');
      const outPath = join(appPath, 'out');

      try {
        if (dirExists(distPath)) {
          execSync(`rm -rf "${distPath}"`, { stdio: 'inherit' });
          console.log(`  Cleaned: ${appDir}/dist`);
        }
        if (dirExists(outPath)) {
          execSync(`rm -rf "${outPath}"`, { stdio: 'inherit' });
          console.log(`  Cleaned: ${appDir}/out`);
        }
      } catch (error) {
        console.warn(`Warning: Failed to clean Electron ${appDir}:`, error);
      }
    }

    // Clean Tauri apps
    const tauriAppDirs = ['tauri'];

    console.log('🧹 Cleaning Tauri apps...');
    for (const appDir of tauriAppDirs) {
      const appPath = join(e2eAppsDir, appDir);
      const targetPath = join(appPath, 'target');

      try {
        if (dirExists(targetPath)) {
          execSync(`rm -rf "${targetPath}"`, { stdio: 'inherit' });
          console.log(`  Cleaned: ${appDir}/target`);
        }
      } catch (error) {
        console.warn(`Warning: Failed to clean Tauri ${appDir}:`, error);
      }
    }

    // Clear the built apps cache
    this.builtApps.clear();
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const buildManager = new BuildManager();

  try {
    if (args.includes('--help') || args.includes('-h')) {
      console.log(`
🔨 E2E Build Manager

USAGE:
  tsx scripts/build-apps.ts [options]

OPTIONS:
  --clean              Clean all app build artifacts (dist, out directories)
  --all                Build all E2E test apps
  --force, --rebuild   Force rebuild even if valid artifacts exist
  --help, -h          Show this help message

ENVIRONMENT VARIABLES:
  FORCE_REBUILD=true   Force rebuild (same as --force)
  FORCE_BUILD=true     Force rebuild (alias for FORCE_REBUILD)
  FRAMEWORK=<framework> Target framework (electron, tauri)
  APP=<app>            Target app (builder, forge, script, basic, advanced)
  MODULE_TYPE=<type>   Module type (cjs, esm)

EXAMPLES:
  # Build apps for current environment (respects existing artifacts)
  tsx scripts/build-apps.ts

  # Force rebuild regardless of existing artifacts
  tsx scripts/build-apps.ts --force
  FORCE_REBUILD=true tsx scripts/build-apps.ts

  # Clean all build artifacts
  tsx scripts/build-apps.ts --clean

  # Build all apps
  tsx scripts/build-apps.ts --all
`);
      return;
    }

    if (args.includes('--clean')) {
      await buildManager.cleanApps();
      return;
    }

    // Handle force rebuild flag
    if (args.includes('--force') || args.includes('--rebuild')) {
      process.env.FORCE_REBUILD = 'true';
      console.log('🔄 Force rebuild enabled via command line argument');
    }

    if (args.includes('--all')) {
      await buildManager.buildAllApps();
    } else {
      await buildManager.buildAppsForEnvironment();
    }

    console.log('🎉 Build process completed successfully!');
  } catch (error) {
    console.error('❌ Build process failed:', error);
    process.exit(1);
  }
}

// Run the build process
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

export default BuildManager;
