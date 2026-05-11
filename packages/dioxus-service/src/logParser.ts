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

/**
 * Detect the log level on a backend line by finding the **leftmost** level
 * token preceded by a word boundary (start-of-line or whitespace).
 *
 * Rust `tracing` / `log` emit the level as the first non-timestamp token
 * in each line. By anchoring to a leading word boundary and returning the
 * first regex match, level tokens that appear inside the message body
 * (e.g. `"check error.log"` or `"in ERROR.handler"`) cannot override the
 * canonical leading level — the line's actual header is always further
 * left.
 *
 * `WARNING` is normalised to `'warn'` for tracing's verbose form. We don't
 * split on the first colon (an earlier attempt did and broke on
 * timestamps like `12:00:00`): the leftmost-match property handles
 * timestamps with embedded colons natively.
 */
function detectLevel(line: string): LogLevel {
  const m = line.match(
    /(?:^|\s)(ERROR|Error|error|WARNING|Warning|warning|WARN|Warn|warn|INFO|Info|info|DEBUG|Debug|debug|TRACE|Trace|trace)\b/,
  );
  if (!m) {
    return 'info';
  }
  const token = m[1].toLowerCase();
  if (token === 'warning' || token === 'warn') {
    return 'warn';
  }
  return token as LogLevel;
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
