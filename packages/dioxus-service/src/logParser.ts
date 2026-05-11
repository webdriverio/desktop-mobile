// Parse a single stdout/stderr line from the Dioxus app subprocess into a
// structured log record.
//
// Two kinds of lines flow through here:
// 1. Frontend lines emitted by the bridge's log_bridge.rs, prefixed
//    `[WDIO-FRONTEND][LEVEL] message`. We classify these as `source: 'frontend'`
//    and strip the marker.
// 2. Backend lines from the Rust app via tracing/println, no special prefix.
//    We attempt to extract a level by scanning for `INFO|WARN|ERROR|DEBUG|TRACE`
//    tokens; default to `info` when no level marker is present.

import type { LogLevel } from '@wdio/native-types';

import { FRONTEND_MARKER, WDIO_FRONTEND_PATTERN } from './constants/logging.js';

export interface ParsedLog {
  level: LogLevel;
  message: string;
  raw: string;
  source: 'backend' | 'frontend';
}

const LEVEL_PATTERNS: Array<{ level: LogLevel; pattern: RegExp }> = [
  { level: 'error', pattern: /\b(ERROR|Error|error)\b/i },
  { level: 'warn', pattern: /\b(WARN|Warn|warn|WARNING|Warning|warning)\b/i },
  { level: 'info', pattern: /\b(INFO|Info|info)\b/i },
  { level: 'debug', pattern: /\b(DEBUG|Debug|debug)\b/i },
  { level: 'trace', pattern: /\b(TRACE|Trace|trace)\b/i },
];

function detectLevel(line: string): LogLevel {
  for (const { level, pattern } of LEVEL_PATTERNS) {
    if (pattern.test(line)) {
      return level;
    }
  }
  return 'info';
}

/**
 * Parse one stdout/stderr line. Returns `undefined` for empty input;
 * everything non-empty yields a structured record.
 */
export function parseLogLine(line: string): ParsedLog | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith(FRONTEND_MARKER)) {
    const match = trimmed.match(WDIO_FRONTEND_PATTERN);
    const level = (match?.[1]?.toLowerCase() as LogLevel | undefined) ?? 'info';
    // Strip the full `[WDIO-FRONTEND][LEVEL]` prefix when present; fall back
    // to stripping the bare `[WDIO-FRONTEND]` marker otherwise.
    const message = match
      ? trimmed.replace(WDIO_FRONTEND_PATTERN, '').trim()
      : trimmed.slice(FRONTEND_MARKER.length).trim();
    return {
      level,
      message,
      raw: trimmed,
      source: 'frontend',
    };
  }

  return {
    level: detectLevel(trimmed),
    message: trimmed,
    raw: trimmed,
    source: 'backend',
  };
}
