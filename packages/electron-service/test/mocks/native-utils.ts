// Comprehensive mock for @wdio/native-utils
import { vi } from 'vitest';

// Simple mock logger that matches the real logger interface
const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
});

// Mock createLogger to return a mock logger instance
// We don't need to track loggers since we're not asserting on them
export const createLogger = vi.fn(() => createMockLogger());

// Export mocks for native-utils functions used in tests
export const waitUntilWindowAvailable = vi.fn();
export const readConfig = vi.fn();
export const readPackageUp = vi.fn();
export const readPackageUpSync = vi.fn();

// Diagnostics
export const diagnoseBinary = vi.fn();
export const diagnoseDiskSpace = vi.fn();
export const diagnoseDisplay = vi.fn();
export const diagnoseLinuxDependencies = vi.fn();
export const diagnosePlatform = vi.fn();
export const diagnoseSharedLibraries = vi.fn();
export const formatDiagnosticResults = vi.fn();

// Result types
export const Err = vi.fn();
export const Ok = vi.fn();
export const isErr = vi.fn();
export const isOk = vi.fn();
export const map = vi.fn();
export const mapErr = vi.fn();
export const unwrap = vi.fn();
export const unwrapOr = vi.fn();
export const wrapAsync = vi.fn();

// Select executable
export const selectExecutable = vi.fn();
export const validateBinaryPaths = vi.fn();

// Teardown helpers are pure utilities the service depends on for real behavior
// (bounded timeout, benign-error matching) — re-export the actual source rather
// than stub them, so afterSession() tests exercise the real logic.
export {
  BENIGN_TEARDOWN_ERROR_PATTERNS,
  DEFAULT_TEARDOWN_TIMEOUT_MS,
  isBenignTeardownError,
  runBounded,
} from '../../../native-utils/src/teardown.js';
