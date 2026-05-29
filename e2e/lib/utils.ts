import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Execute a command with environment variables and capture output
 */
export async function execWithEnv(
  command: string,
  env: Record<string, string> = {},
  options: { cwd?: string; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const { cwd = process.cwd(), timeout = 120000 } = options;
    // Split command into parts for spawn
    const parts = command.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    // Merge environment variables
    const mergedEnv = { ...process.env, ...env };

    const childProcess = spawn(cmd, args, {
      env: mergedEnv,
      cwd,
      shell: true,
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout | null = null;

    // Set up timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        childProcess.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeout}ms: ${command}`));
      }, timeout);
    }

    // Capture stdout and stream to console
    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      process.stdout.write(output);
    });

    // Capture stderr and stream to console
    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      process.stderr.write(output);
    });

    // Handle process completion
    childProcess.on('close', (code) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve({ stdout, stderr, code: code || 0 });
    });

    // Handle process errors
    childProcess.on('error', (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(error);
    });
  });
}

/**
 * Execute WDIO command with retry logic for xvfb failures on Linux
 */
export async function execWdio(
  command: string,
  env: Record<string, string> = {},
  options: { cwd?: string; timeout?: number } = {},
  maxRetries: number = 3,
): Promise<{ stdout: string; stderr: string; code: number }> {
  let lastError: { stdout: string; stderr: string; code: number } | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt === 1) {
        console.log(`🚀 Running WDIO command: ${command}`);
      } else {
        console.log(`🔄 Retry attempt ${attempt}/${maxRetries}: ${command}`);
      }

      const result = await execWithEnv(command, env, options);

      // Check for xvfb failure on Linux
      if (
        result.code !== 0 &&
        process.platform === 'linux' &&
        (result.stderr.includes('Xvfb failed to start') ||
          result.stderr.includes('Cannot establish any listening sockets'))
      ) {
        console.log(`❌ Attempt ${attempt}/${maxRetries} failed with xvfb error`);
        console.log(`🔍 Error: ${result.stderr}`);

        if (attempt < maxRetries) {
          const delay = attempt * 1000; // Progressive delay: 1s, 2s, 3s
          console.log(`⏳ Waiting ${delay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          lastError = result;
          continue;
        }
      }

      // Success or non-xvfb error
      if (result.code === 0) {
        if (attempt > 1) {
          console.log(`✅ Success on attempt ${attempt}/${maxRetries}`);
        }
        return result;
      } else {
        // Non-xvfb error, don't retry
        return result;
      }
    } catch (error) {
      console.log(`❌ Attempt ${attempt}/${maxRetries} failed with error: ${error}`);

      if (attempt < maxRetries) {
        const delay = attempt * 1000;
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  // All retries exhausted
  console.log(`❌ All ${maxRetries} attempts failed`);
  return lastError || { stdout: '', stderr: 'All retries exhausted', code: 1 };
}

/**
 * Check if a file exists and is readable
 */
export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a directory exists
 */
export function dirExists(dirPath: string): boolean {
  try {
    const stat = fs.statSync(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

/**
 * Create a delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    delay?: number;
    backoff?: number;
  } = {},
): Promise<T> {
  const { retries = 3, delay: initialDelay = 1000, backoff = 2 } = options;

  let lastError: Error | undefined;

  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (i === retries) {
        break; // Don't delay on the last attempt
      }

      const delayMs = initialDelay * backoff ** i;
      await delay(delayMs);
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error('No error occurred');
}

/**
 * Safe JSON parsing with fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/**
 * Resolve the built Tauri fixture binary for the given app directory.
 *
 * @wdio/tauri-service no longer auto-detects the binary — it takes an explicit
 * path — so the e2e suite owns the fixture layout knowledge. This mirrors the
 * debug build the fixtures produce: `<appPath>/src-tauri/target/debug/<productName>`
 * (`.exe` on Windows, lowercased on Linux). Shared by wdio.tauri.conf.ts and the
 * standalone specs so the layout is defined in exactly one place.
 */
export function resolveTauriFixtureBinary(appPath: string): string {
  const targetDir = path.join(appPath, 'src-tauri', 'target', 'debug');
  const tauriConfigPath = path.join(appPath, 'src-tauri', 'tauri.conf.json');

  if (!fileExists(tauriConfigPath)) {
    throw new Error(`Tauri config not found: ${tauriConfigPath}`);
  }

  const tauriConfig = safeJsonParse<{ productName?: string }>(fs.readFileSync(tauriConfigPath, 'utf-8'), {});
  const productName = tauriConfig.productName || 'tauri-app';

  let appBinaryPath: string;
  if (process.platform === 'win32') {
    appBinaryPath = path.join(targetDir, `${productName}.exe`);
  } else if (process.platform === 'linux') {
    appBinaryPath = path.join(targetDir, productName.toLowerCase());
  } else if (process.platform === 'darwin') {
    appBinaryPath = path.join(targetDir, productName);
  } else {
    throw new Error(`Unsupported platform for Tauri: ${process.platform}`);
  }

  if (!fileExists(appBinaryPath)) {
    throw new Error(`Tauri binary not found: ${appBinaryPath}. Make sure the app is built.`);
  }

  return appBinaryPath;
}

/**
 * Get the log directory name for a test configuration
 * Centralizes the naming convention across all config files and scripts
 *
 * Pattern:
 * - official: ${testType}-${appDirName}
 * - embedded: embedded-${testType}-${appDirName}
 * - crabnebula: crabnebula-${testType}-${appDirName}
 */
export function getLogDirName(
  testType: string,
  appDirName: string,
  driverProvider?: 'official' | 'crabnebula' | 'embedded',
): string {
  if (driverProvider && driverProvider !== 'official') {
    return `${driverProvider}-${testType}-${appDirName}`;
  }
  return `${testType}-${appDirName}`;
}

/**
 * Read WDIO log files from output directory
 * Uses async file reading to prevent blocking the event loop
 */
export async function readWdioLogs(logBaseDir: string): Promise<string> {
  if (!fs.existsSync(logBaseDir)) {
    console.log(`[DEBUG] Log base directory does not exist: ${logBaseDir}`);
    return '';
  }

  // Check if there are .log files directly in the base directory (standalone mode)
  const directLogFiles = fs
    .readdirSync(logBaseDir, { withFileTypes: true })
    .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.log'))
    .map((dirent) => dirent.name)
    .sort();

  if (directLogFiles.length > 0) {
    // Standalone mode: read log files directly from base directory
    console.log(`[DEBUG] Reading logs directly from: ${logBaseDir}`);
    console.log(`[DEBUG] Found log files: ${directLogFiles.join(', ')}`);

    let allLogs = '';
    for (const logFile of directLogFiles) {
      const logPath = path.join(logBaseDir, logFile);
      try {
        const content = await readLogFileWithRetry(logPath);
        allLogs += `${content}\n`;
        console.log(`[DEBUG] Read ${logFile}: ${content.length} chars`);
      } catch (error) {
        console.log(`[DEBUG] Failed to read ${logFile}: ${error}`);
      }
    }
    return allLogs;
  }

  // WDIO test runner mode: find the most recent log directory
  const logDirs = fs
    .readdirSync(logBaseDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort()
    .reverse();

  if (logDirs.length === 0) {
    console.log(`[DEBUG] No log directories or files found in: ${logBaseDir}`);
    return '';
  }

  console.log(`[DEBUG] Found log directories: ${logDirs.join(', ')}`);

  // Read all log files from the most recent directory
  const logDir = path.join(logBaseDir, logDirs[0]);
  const logFiles = fs
    .readdirSync(logDir)
    .filter((file) => file.endsWith('.log'))
    .sort();

  console.log(`[DEBUG] Reading logs from: ${logDir}`);
  console.log(`[DEBUG] Found log files: ${logFiles.join(', ')}`);

  let allLogs = '';
  for (const logFile of logFiles) {
    const logPath = path.join(logDir, logFile);
    try {
      const content = await readLogFileWithRetry(logPath);
      allLogs += `${content}\n`;
      console.log(`[DEBUG] Read ${logFile}: ${content.length} chars`);
    } catch (error) {
      console.log(`[DEBUG] Failed to read ${logFile}: ${error}`);
    }
  }

  return allLogs;
}

/**
 * Read a log file with retry logic to handle concurrent writes
 * Uses async/await with the existing delay() helper to avoid blocking the event loop
 */
async function readLogFileWithRetry(filePath: string, maxRetries = 5, baseDelay = 100): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Try to read the file asynchronously
      const content = await fs.promises.readFile(filePath, 'utf8');
      return content;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If it's not a lock/EBUSY error, throw immediately
      if (!isRetryableError(lastError)) {
        throw lastError;
      }

      // Wait with exponential backoff before retrying
      if (attempt < maxRetries - 1) {
        const delayMs = baseDelay * 2 ** attempt;
        console.log(
          `[DEBUG] File ${path.basename(filePath)} locked, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`,
        );
        await delay(delayMs);
      }
    }
  }

  throw lastError || new Error(`Failed to read ${filePath} after ${maxRetries} attempts`);
}

/**
 * Check if an error is retryable (transient file locks only)
 * Only retries on EBUSY/EAGAIN which indicate temporary file locks.
 * EACCES/EPERM indicate permission problems that won't resolve with retries.
 */
function isRetryableError(error: Error): boolean {
  const retryableCodes = ['EBUSY', 'EAGAIN'];
  const code = (error as { code?: string }).code;
  return code !== undefined && retryableCodes.includes(code);
}

/**
 * Find log entries matching a pattern
 */
export function findLogEntries(logs: string, pattern: string | RegExp): string[] {
  const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
  return logs.split('\n').filter((line) => regex.test(line));
}

/**
 * Assert log contains expected message
 */
export function assertLogContains(logs: string, expected: string | RegExp): void {
  const found = typeof expected === 'string' ? logs.includes(expected) : expected.test(logs);

  if (!found) {
    throw new Error(`Expected log message not found: ${expected}\n\nLogs:\n${logs.slice(0, 1000)}`);
  }
}

/**
 * Assert log does NOT contain a pattern (for testing filtering)
 */
export function assertLogDoesNotContain(logs: string, pattern: string | RegExp): void {
  const found = typeof pattern === 'string' ? logs.includes(pattern) : pattern.test(logs);

  if (found) {
    const matches = findLogEntries(logs, pattern);
    throw new Error(
      `Expected log pattern to be filtered out: ${pattern}\n\nFound ${matches.length} matches:\n${matches.slice(0, 5).join('\n')}`,
    );
  }
}

/**
 * Wait for a log message to appear in the log directory
 * Uses polling with file stability detection to ensure logs are fully written
 */
export async function waitForLog(
  logDir: string,
  pattern: string | RegExp,
  timeout: number = 10000,
  interval: number = 500,
  settleDelay: number = 2000,
): Promise<boolean> {
  const startTime = Date.now();
  // Strip the global flag to avoid stateful lastIndex behavior across polls
  const source = typeof pattern === 'string' ? pattern : pattern.source;
  const flags = typeof pattern === 'string' ? 'i' : pattern.flags.replace('g', '');
  const regex = new RegExp(source, flags);
  let lastLogSize = 0;
  let stableCount = 0;
  const requiredStableChecks = 2;

  while (Date.now() - startTime < timeout) {
    const logs = await readWdioLogs(logDir);
    const currentLogSize = logs.length;

    if (regex.test(logs)) {
      // Check if log size has stabilized (no new writes)
      if (currentLogSize === lastLogSize) {
        stableCount++;
        if (stableCount >= requiredStableChecks) {
          // Pattern matched and logs are stable - wait for final settle delay,
          // clamped to remaining timeout so we don't overshoot
          const remaining = timeout - (Date.now() - startTime);
          await delay(Math.max(0, Math.min(settleDelay, remaining)));
          return true;
        }
      } else {
        stableCount = 0;
      }
    } else {
      stableCount = 0;
    }

    lastLogSize = currentLogSize;
    await delay(interval);
  }

  return false;
}

/**
 * Compute the E2E app directory name based on framework, app type, and binary mode.
 * This is used consistently across envSchema, build scripts, and test runners.
 *
 * @param framework - 'electron', 'tauri', or 'dioxus'
 * @param app - App type: 'builder', 'forge', 'script', or 'basic' (for Tauri/Dioxus)
 * @param isScript - Whether this is a script mode (only used for Electron)
 * @returns The computed directory name
 */
export function getE2EAppDirName(
  framework: 'electron' | 'tauri' | 'dioxus',
  app: 'builder' | 'forge' | 'script' | 'basic',
  isScript: boolean,
): string {
  if (framework === 'tauri' || framework === 'dioxus') {
    return framework; // 'tauri' or 'dioxus'
  }

  if (isScript) {
    return 'electron-script';
  }

  return `electron-${app}`;
}
