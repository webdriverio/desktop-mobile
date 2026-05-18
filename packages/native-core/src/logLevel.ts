// Log-level priority comparison utility.
//
// Extracted from packages/tauri-service/src/logForwarder.ts and
// packages/electron-service/src/logForwarder.ts. The priority ordering and
// the `shouldLog` predicate are bit-for-bit identical in both services, so
// they live here. The full `forwardLog` implementations remain in each
// service because their prefix schemes ([Tauri:Backend], [Electron:Renderer],
// [Dioxus:Backend]) and multiremote conventions diverge.

import type { LogLevel } from '@wdio/native-types';

/**
 * Priority ordering used by {@link shouldLog}. Higher number = higher
 * priority (more severe). A log at level X is emitted iff its priority is
 * ≥ the configured minimum level's priority.
 */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

/**
 * True when a log at `level` meets the `minLevel` threshold.
 */
export function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
}
