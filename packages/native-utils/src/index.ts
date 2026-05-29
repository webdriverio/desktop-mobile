import { createLogger } from './log.js';

export { readConfig } from './config/read.js';
export {
  type DiagnosticResult,
  diagnoseBinary,
  diagnoseDiskSpace,
  diagnoseDisplay,
  diagnoseLinuxDependencies,
  diagnosePlatform,
  diagnoseSharedLibraries,
  formatDiagnosticResults,
} from './diagnostics.js';
export type { LogArea } from './log.js';
export { type NormalizedReadResult, readPackageUp, readPackageUpSync } from './package.js';
export {
  Err,
  isErr,
  isOk,
  map,
  mapErr,
  Ok,
  type Result,
  unwrap,
  unwrapOr,
  wrapAsync,
} from './result.js';
export { hasSemicolonOutsideQuotes, hasTopLevelArrow } from './script-detect.js';
export { selectExecutable, validateBinaryPaths } from './selectExecutable.js';
export {
  BENIGN_TEARDOWN_ERROR_PATTERNS,
  DEFAULT_TEARDOWN_TIMEOUT_MS,
  isBenignTeardownError,
  runBounded,
} from './teardown.js';
export { waitUntilWindowAvailable } from './window.js';
export { createLogger };
