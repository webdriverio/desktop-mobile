import type { LogLevel } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';
import { FRONTEND_MARKER, PREFIXES } from './constants/logging.js';

const log = createLogger('tauri-service', 'service');

export interface ParsedLog {
  level: LogLevel;
  message: string;
  raw: string;
  source?: 'backend' | 'frontend';
  prefixedMessage?: string;
}

/**
 * Patterns to match log levels in Rust log output
 */
const LOG_LEVEL_PATTERNS: Array<{ level: LogLevel; pattern: RegExp }> = [
  { level: 'error', pattern: /\b(ERROR|Error|error)\b/i },
  { level: 'warn', pattern: /\b(WARN|Warn|warn|WARNING|Warning|warning)\b/i },
  { level: 'info', pattern: /\b(INFO|Info|info)\b/i },
  { level: 'debug', pattern: /\b(DEBUG|Debug|debug)\b/i },
  { level: 'trace', pattern: /\b(TRACE|Trace|trace)\b/i },
];

/**
 * Patterns that indicate tauri-driver logs (should be filtered out)
 */
const TAURI_DRIVER_PATTERNS = [
  /tauri-driver/i,
  /listening on/i,
  /started successfully/i,
  /WebKitWebDriver/i,
  /native driver/i,
];

/**
 * Extract prefix and source from a log line
 * Returns the prefix (e.g., [Tauri:Backend]) and source type
 */
function extractPrefixAndSource(line: string): { prefix: string | null; source: 'backend' | 'frontend' } {
  // Check for explicit Tauri prefixes (highest priority)
  if (line.includes(PREFIXES.backend)) {
    return { prefix: PREFIXES.backend, source: 'backend' };
  }
  if (line.includes(PREFIXES.frontend)) {
    return { prefix: PREFIXES.frontend, source: 'frontend' };
  }
  // Check for [frontend] target from Tauri log plugin
  if (/\[frontend\]/i.test(line)) {
    return { prefix: '[frontend]', source: 'frontend' };
  }

  // Check for WDIO frontend log marker from log_frontend Rust command
  // Format: [WDIO-FRONTEND][LEVEL] message
  if (line.includes(FRONTEND_MARKER)) {
    return { prefix: null, source: 'frontend' };
  }

  // backend logs get their prefix added in logForwarder.ts via formatLogMessage()
  return { prefix: null, source: 'backend' };
}

/**
 * Check if a log line is from tauri-driver (should be filtered out)
 */
function isTauriDriverLog(line: string): boolean {
  return TAURI_DRIVER_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Heuristic upper bound for where the level token sits in a Rust log line:
 * `2025-01-01T12:00:00.000000Z  ERROR my_crate ...` puts ERROR around column
 * 31. 40 covers reasonable variations (extra spaces, bracketed prefixes like
 * `[my-app]`) without giving message text room to false-match a level keyword.
 */
const LEVEL_SCAN_WINDOW = 40;

/**
 * Extract log level from a log line.
 *
 * Only scans the line's prefix (timestamp + first few tokens) so that a
 * line body like "cannot find file — check error.log" doesn't get classified
 * as ERROR. Rust `tracing` / `log` always emits the level token before the
 * message, so the prefix is where it lives.
 */
function extractLogLevel(line: string): LogLevel | undefined {
  const prefix = line.length > LEVEL_SCAN_WINDOW ? line.slice(0, LEVEL_SCAN_WINDOW) : line;
  for (const { level, pattern } of LOG_LEVEL_PATTERNS) {
    if (pattern.test(prefix)) {
      return level;
    }
  }
  return undefined;
}

/**
 * Pre-compiled regex patterns for log cleaning
 */
const TIMESTAMP_PATTERN = /\[\d{4}-\d{2}-\d{2}\]\[\d{2}:\d{2}:\d{2}\]/g;
const TAURI_PLUGIN_PATTERN = /\]\[tauri_[a-zA-Z0-9_]+\]/g;
const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s*/g;
const BRACKET_PATTERN = /\[[a-zA-Z0-9_-]+\]\s*/g;
const WDIO_FRONTEND_PATTERN = /\[WDIO-FRONTEND\]\[(INFO|WARN|ERROR|DEBUG|TRACE)\]\s*/i;
const QUOTED_STRING_PATTERN = /^".*"$/;
const TAURI_PREFIX_PATTERN = /^\[Tauri:(Backend|Frontend)\]\s*/i;

/**
 * Clean up log message by removing timestamps and app names
 * If line already has a prefix, we preserve it and just trim
 */
function cleanLogMessage(line: string, hasPrefix: boolean): string {
  if (hasPrefix) {
    return line.trim();
  }

  // Single-pass cleaning with pre-compiled patterns
  return line
    .replace(TIMESTAMP_PATTERN, '')
    .replace(TAURI_PLUGIN_PATTERN, ']')
    .replace(ISO_TIMESTAMP_PATTERN, '')
    .replace(BRACKET_PATTERN, '')
    .trim();
}

/**
 * Parse a log line from stdout/stderr
 * Returns undefined if the line should be ignored (e.g., tauri-driver logs)
 */
export function parseLogLine(line: string): ParsedLog | undefined {
  const trimmedLine = line.trim();

  if (!trimmedLine) {
    return undefined;
  }

  // Filter out tauri-driver logs
  if (isTauriDriverLog(trimmedLine)) {
    return undefined;
  }

  // Extract prefix and source before cleaning
  const { prefix, source } = extractPrefixAndSource(trimmedLine);

  // Try to extract log level
  const level = extractLogLevel(trimmedLine);

  // If no level found, default to 'info' for Tauri app logs
  const logLevel: LogLevel = level ?? 'info';

  // Clean up the message
  // If line has a prefix, strip it first - we'll add it back via prefixedMessage
  const hasPrefix = prefix !== null;
  let cleanedMessage = hasPrefix
    ? trimmedLine.replace(TAURI_PREFIX_PATTERN, '')
    : cleanLogMessage(trimmedLine, hasPrefix);

  // For frontend logs from log_frontend command, strip the [WDIO-FRONTEND][LEVEL] prefix
  // Format: [WDIO-FRONTEND][LEVEL] message
  if (source === 'frontend' && hasPrefix === false) {
    if (WDIO_FRONTEND_PATTERN.test(cleanedMessage)) {
      cleanedMessage = cleanedMessage.replace(WDIO_FRONTEND_PATTERN, '').trim();
    }
  }

  // For raw frontend logs (JSON-quoted strings from Rust listener),
  // strip the surrounding quotes
  // Format: [Tauri:Frontend] "message" or just "message" (raw from Rust)
  if (source === 'frontend') {
    const trimmed = cleanedMessage.trim();
    if (QUOTED_STRING_PATTERN.test(trimmed)) {
      cleanedMessage = trimmed.slice(1, -1);
    }
  }

  // If message is empty after cleaning, skip it
  if (!cleanedMessage) {
    return undefined;
  }

  // Build prefixed message if we have a prefix
  const prefixedMessage = prefix ? `${prefix} ${cleanedMessage}` : undefined;

  return {
    level: logLevel,
    message: cleanedMessage,
    raw: trimmedLine,
    source,
    prefixedMessage,
  };
}

/**
 * Parse multiple log lines (handles multi-line logs)
 */
let parseCallCount = 0;

export function parseLogLines(lines: string): ParsedLog[] {
  parseCallCount++;

  const parsed: ParsedLog[] = [];
  const logLines = lines.split('\n');

  for (const line of logLines) {
    const parsedLog = parseLogLine(line);
    if (parsedLog) {
      parsed.push(parsedLog);
    }
  }

  // Only log debug output every 10th call to reduce overhead
  if (parsed.length > 0 && parseCallCount % 10 === 0) {
    log.debug(
      `[LOG-PARSER] Parsed ${parsed.length} log entries from ${logLines.length} lines (sample #${parseCallCount})`,
    );
    log.debug(
      `[LOG-PARSER] Sample: ${parsed
        .slice(0, 3)
        .map((p) => `${p.source}:${p.level}:${p.message.substring(0, 30)}`)
        .join(', ')}`,
    );
  }

  return parsed;
}
