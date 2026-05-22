import { describe, expect, it, vi } from 'vitest';

vi.mock('@wdio/native-utils', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import type { ParsedLog } from '../src/logParser.js';
import { parseLogLine, parseLogLines } from '../src/logParser.js';

describe('logParser', () => {
  describe('parseLogLine', () => {
    describe('empty and whitespace lines', () => {
      it('should return undefined for an empty string', () => {
        expect(parseLogLine('')).toBeUndefined();
      });

      it('should return undefined for whitespace-only lines', () => {
        expect(parseLogLine('   ')).toBeUndefined();
        expect(parseLogLine('\t')).toBeUndefined();
        expect(parseLogLine('  \t  ')).toBeUndefined();
      });
    });

    describe('tauri-driver log filtering', () => {
      it('should filter out lines containing tauri-driver', () => {
        expect(parseLogLine('tauri-driver listening on port 4444')).toBeUndefined();
        expect(parseLogLine('Starting tauri-driver')).toBeUndefined();
        expect(parseLogLine('TAURI-DRIVER started')).toBeUndefined();
      });

      it('should filter out lines matching "listening on"', () => {
        expect(parseLogLine('Server listening on 127.0.0.1:4444')).toBeUndefined();
      });

      it('should filter out lines matching "started successfully"', () => {
        expect(parseLogLine('Driver started successfully')).toBeUndefined();
      });

      it('should filter out lines matching "WebKitWebDriver"', () => {
        expect(parseLogLine('WebKitWebDriver session created')).toBeUndefined();
        expect(parseLogLine('webkitwebdriver ready')).toBeUndefined();
      });

      it('should filter out lines matching "native driver"', () => {
        expect(parseLogLine('native driver connected')).toBeUndefined();
        expect(parseLogLine('Native Driver initialized')).toBeUndefined();
      });
    });

    describe('log level extraction', () => {
      it('should detect ERROR level (case insensitive)', () => {
        expect(parseLogLine('ERROR something failed')?.level).toBe('error');
        expect(parseLogLine('Error: something failed')?.level).toBe('error');
        expect(parseLogLine('[error] something failed')?.level).toBe('error');
      });

      it('should detect WARN level (case insensitive)', () => {
        expect(parseLogLine('WARN something concerning')?.level).toBe('warn');
        expect(parseLogLine('Warning: low memory')?.level).toBe('warn');
        expect(parseLogLine('[warning] low memory')?.level).toBe('warn');
        expect(parseLogLine('Warn: something')?.level).toBe('warn');
      });

      it('should detect INFO level (case insensitive)', () => {
        expect(parseLogLine('INFO app started')?.level).toBe('info');
        expect(parseLogLine('Info: app started')?.level).toBe('info');
        expect(parseLogLine('[info] app started')?.level).toBe('info');
      });

      it('should detect DEBUG level (case insensitive)', () => {
        expect(parseLogLine('DEBUG variable dump')?.level).toBe('debug');
        expect(parseLogLine('Debug: variable dump')?.level).toBe('debug');
        expect(parseLogLine('[debug] variable dump')?.level).toBe('debug');
      });

      it('should detect TRACE level (case insensitive)', () => {
        expect(parseLogLine('TRACE entering function')?.level).toBe('trace');
        expect(parseLogLine('Trace: entering function')?.level).toBe('trace');
        expect(parseLogLine('[trace] entering function')?.level).toBe('trace');
      });

      it('should use word boundaries for level detection', () => {
        const result = parseLogLine('information about something');
        expect(result?.level).toBe('info');
      });

      it('should prioritize ERROR over other levels when multiple present', () => {
        const result = parseLogLine('ERROR while processing INFO request');
        expect(result?.level).toBe('error');
      });

      it('should default to info when no level is found', () => {
        const result = parseLogLine('some random log message');
        expect(result?.level).toBe('info');
      });

      it('should not mistake a level keyword in the message body for the level', () => {
        // Regression: Rust `tracing` puts the level immediately after the
        // timestamp; if we scan the whole line, "error.log" in the message
        // shadows the real INFO level. The prefix-window heuristic prevents
        // this without anchoring to a brittle exact column.
        const result = parseLogLine('2025-01-01T12:00:00Z INFO my_module: cannot find file — check error.log');
        expect(result?.level).toBe('info');
      });
    });

    describe('source detection', () => {
      it('should detect [Tauri:Backend] as backend source with prefix', () => {
        const result = parseLogLine('[Tauri:Backend] some backend log');
        expect(result?.source).toBe('backend');
        expect(result?.prefixedMessage).toBe('[Tauri:Backend] some backend log');
      });

      it('should detect [Tauri:Frontend] as frontend source with prefix', () => {
        const result = parseLogLine('[Tauri:Frontend] some frontend log');
        expect(result?.source).toBe('frontend');
        expect(result?.prefixedMessage).toBe('[Tauri:Frontend] some frontend log');
      });

      it('should detect [frontend] (case insensitive) as frontend source', () => {
        const result = parseLogLine('[frontend] some log');
        expect(result?.source).toBe('frontend');
        // The [frontend] prefix doesn't match TAURI_PREFIX_PATTERN, so
        // cleanedMessage is the full trimmed line, and prefixedMessage adds prefix again
        expect(result?.prefixedMessage).toBe('[frontend] [frontend] some log');
      });

      it('should detect [FRONTEND] uppercase as frontend source', () => {
        const result = parseLogLine('[FRONTEND] some log');
        expect(result?.source).toBe('frontend');
        // Same behavior as [frontend] — prefix is '[frontend]' (from regex match)
        // but doesn't get stripped from message
        expect(result?.prefixedMessage).toBe('[frontend] [FRONTEND] some log');
      });

      it('should detect [WDIO-FRONTEND] as frontend source with no prefix', () => {
        const result = parseLogLine('[WDIO-FRONTEND][INFO] test message');
        expect(result?.source).toBe('frontend');
        expect(result?.prefixedMessage).toBeUndefined();
      });

      it('should default to backend source when no markers found', () => {
        const result = parseLogLine('some random log');
        expect(result?.source).toBe('backend');
        expect(result?.prefixedMessage).toBeUndefined();
      });

      it('should prioritize [Tauri:Backend] over [frontend]', () => {
        const result = parseLogLine('[Tauri:Backend] [frontend] message');
        expect(result?.source).toBe('backend');
      });

      it('should prioritize [Tauri:Frontend] over [WDIO-FRONTEND]', () => {
        const result = parseLogLine('[Tauri:Frontend] [WDIO-FRONTEND] message');
        expect(result?.source).toBe('frontend');
      });
    });

    describe('message cleaning without prefix', () => {
      it('should strip bracket-format timestamps', () => {
        const result = parseLogLine('[2024-01-01][12:00:00] Application started');
        expect(result?.message).not.toContain('[2024-01-01]');
        expect(result?.message).not.toContain('[12:00:00]');
      });

      it('should strip ISO timestamps', () => {
        const result = parseLogLine('2024-01-01T12:00:00.000Z Application started');
        expect(result?.message).not.toContain('2024-01-01T12:00:00.000Z');
        expect(result?.message).toContain('Application started');
      });

      it('should strip bracket patterns like [app-name]', () => {
        const result = parseLogLine('[my-app] Hello world');
        expect(result?.message).not.toContain('[my-app]');
        expect(result?.message).toContain('Hello world');
      });

      it('should strip tauri plugin patterns', () => {
        const result = parseLogLine('[INFO][tauri_plugin_shell] command ran');
        expect(result?.message).not.toContain('tauri_plugin_shell');
        expect(result?.message).toContain('command ran');
      });

      it('should strip multiple timestamps and brackets in one line', () => {
        const result = parseLogLine('[2024-01-15][08:30:00][my-app][INFO] Ready');
        expect(result?.message).toBe('Ready');
      });

      it('should trim the final cleaned message', () => {
        const result = parseLogLine('  plain log message  ');
        expect(result?.message).not.toMatch(/^\s/);
        expect(result?.message).not.toMatch(/\s$/);
      });
    });

    describe('message cleaning with prefix', () => {
      it('should strip [Tauri:Backend] prefix from message', () => {
        const result = parseLogLine('[Tauri:Backend] some backend message');
        expect(result?.message).toBe('some backend message');
      });

      it('should strip [Tauri:Frontend] prefix from message', () => {
        const result = parseLogLine('[Tauri:Frontend] some frontend message');
        expect(result?.message).toBe('some frontend message');
      });

      it('should trim whitespace on prefixed lines', () => {
        const result = parseLogLine('  [Tauri:Backend]   spaced out message  ');
        expect(result?.message).not.toMatch(/^\s/);
      });

      it('should preserve content after prefix stripping', () => {
        const result = parseLogLine('[Tauri:Backend] [2024-01-01][12:00:00] log with timestamp');
        expect(result?.message).toContain('[2024-01-01][12:00:00]');
        expect(result?.message).toContain('log with timestamp');
      });
    });

    describe('WDIO-FRONTEND stripping', () => {
      it('should strip [WDIO-FRONTEND][INFO] prefix from frontend messages', () => {
        const result = parseLogLine('[WDIO-FRONTEND][INFO] hello from frontend');
        expect(result?.message).toBe('hello from frontend');
        expect(result?.source).toBe('frontend');
      });

      it('should strip [WDIO-FRONTEND][ERROR] prefix', () => {
        const result = parseLogLine('[WDIO-FRONTEND][ERROR] something failed');
        expect(result?.message).toBe('something failed');
        expect(result?.level).toBe('error');
      });

      it('should strip [WDIO-FRONTEND][WARN] prefix', () => {
        const result = parseLogLine('[WDIO-FRONTEND][WARN] something concerning');
        expect(result?.message).toBe('something concerning');
        expect(result?.level).toBe('warn');
      });

      it('should strip [WDIO-FRONTEND][DEBUG] prefix', () => {
        const result = parseLogLine('[WDIO-FRONTEND][DEBUG] debug output');
        expect(result?.message).toBe('debug output');
        expect(result?.level).toBe('debug');
      });

      it('should strip [WDIO-FRONTEND][TRACE] prefix', () => {
        const result = parseLogLine('[WDIO-FRONTEND][TRACE] trace output');
        expect(result?.message).toBe('trace output');
        expect(result?.level).toBe('trace');
      });

      it('should handle case insensitive level in WDIO-FRONTEND pattern', () => {
        const result = parseLogLine('[WDIO-FRONTEND][info] lower case level');
        expect(result?.message).toBe('lower case level');
      });
    });

    describe('quoted string stripping for frontend', () => {
      it('should strip surrounding quotes from frontend messages', () => {
        const result = parseLogLine('[Tauri:Frontend] "hello from console.log"');
        expect(result?.message).toBe('hello from console.log');
      });

      it('should not strip quotes from backend messages', () => {
        const result = parseLogLine('[Tauri:Backend] "quoted backend message"');
        expect(result?.message).toBe('"quoted backend message"');
      });

      it('should only strip when fully wrapped in quotes', () => {
        const result = parseLogLine('[Tauri:Frontend] "partial" quote');
        expect(result?.message).toBe('"partial" quote');
      });

      it('should strip quotes from WDIO-FRONTEND messages', () => {
        const result = parseLogLine('[WDIO-FRONTEND][INFO] "hello"');
        expect(result?.message).toBe('hello');
      });

      it('should handle empty quoted string for frontend', () => {
        const result = parseLogLine('[Tauri:Frontend] ""');
        expect(result).toBeUndefined();
      });
    });

    describe('empty message after cleaning', () => {
      it('should return undefined when message is empty after stripping brackets', () => {
        const result = parseLogLine('[some-app]');
        expect(result).toBeUndefined();
      });

      it('should return undefined when message is just timestamps', () => {
        const result = parseLogLine('[2024-01-01][12:00:00]');
        expect(result).toBeUndefined();
      });

      it('should return undefined when [Tauri:Frontend] prefix with empty quoted string', () => {
        const result = parseLogLine('[Tauri:Frontend] ""');
        expect(result).toBeUndefined();
      });
    });

    describe('prefixedMessage', () => {
      it('should set prefixedMessage for [Tauri:Backend] lines', () => {
        const result = parseLogLine('[Tauri:Backend] backend log message');
        expect(result?.prefixedMessage).toBe('[Tauri:Backend] backend log message');
      });

      it('should set prefixedMessage for [Tauri:Frontend] lines', () => {
        const result = parseLogLine('[Tauri:Frontend] frontend log message');
        expect(result?.prefixedMessage).toBe('[Tauri:Frontend] frontend log message');
      });

      it('should set prefixedMessage for [frontend] lines', () => {
        const result = parseLogLine('[frontend] INFO some log');
        expect(result?.prefixedMessage).toMatch(/^\[frontend\] /);
      });

      it('should not set prefixedMessage for lines without a prefix', () => {
        const result = parseLogLine('plain log message');
        expect(result?.prefixedMessage).toBeUndefined();
      });

      it('should not set prefixedMessage for WDIO-FRONTEND lines', () => {
        const result = parseLogLine('[WDIO-FRONTEND][INFO] test message');
        expect(result?.prefixedMessage).toBeUndefined();
      });
    });

    describe('raw field', () => {
      it('should store the trimmed original line in raw', () => {
        const result = parseLogLine('  [Tauri:Backend] some message  ');
        expect(result?.raw).toBe('[Tauri:Backend] some message');
      });

      it('should preserve the original content in raw', () => {
        const result = parseLogLine('[2024-01-01][12:00:00][my-app][INFO] Ready');
        expect(result?.raw).toBe('[2024-01-01][12:00:00][my-app][INFO] Ready');
      });
    });

    describe('full integration examples', () => {
      it('should parse a Rust backend log line with timestamps', () => {
        const result = parseLogLine('[2024-01-15][08:30:00][my-app][INFO] Server started on port 3000');
        expect(result).toEqual({
          level: 'info',
          message: 'Server started on port 3000',
          raw: '[2024-01-15][08:30:00][my-app][INFO] Server started on port 3000',
          source: 'backend',
          prefixedMessage: undefined,
        } satisfies ParsedLog);
      });

      it('should parse a frontend console log via WDIO-FRONTEND', () => {
        const result = parseLogLine('[WDIO-FRONTEND][WARN] Deprecation notice');
        expect(result).toEqual({
          level: 'warn',
          message: 'Deprecation notice',
          raw: '[WDIO-FRONTEND][WARN] Deprecation notice',
          source: 'frontend',
          prefixedMessage: undefined,
        } satisfies ParsedLog);
      });

      it('should parse a prefixed backend log', () => {
        const result = parseLogLine('[Tauri:Backend] ERROR database connection failed');
        expect(result).toEqual({
          level: 'error',
          message: 'ERROR database connection failed',
          raw: '[Tauri:Backend] ERROR database connection failed',
          source: 'backend',
          prefixedMessage: '[Tauri:Backend] ERROR database connection failed',
        } satisfies ParsedLog);
      });

      it('should parse a prefixed frontend log with quoted message', () => {
        const result = parseLogLine('[Tauri:Frontend] "user clicked button"');
        expect(result).toEqual({
          level: 'info',
          message: 'user clicked button',
          raw: '[Tauri:Frontend] "user clicked button"',
          source: 'frontend',
          prefixedMessage: '[Tauri:Frontend] user clicked button',
        } satisfies ParsedLog);
      });

      it('should parse a line with ISO timestamp', () => {
        const result = parseLogLine('2024-06-15T14:23:01.456Z [my-app] DEBUG checking cache');
        expect(result).toEqual({
          level: 'debug',
          message: 'DEBUG checking cache',
          raw: '2024-06-15T14:23:01.456Z [my-app] DEBUG checking cache',
          source: 'backend',
          prefixedMessage: undefined,
        } satisfies ParsedLog);
      });

      it('should handle a plain message with no metadata', () => {
        const result = parseLogLine('Hello from the app');
        expect(result).toEqual({
          level: 'info',
          message: 'Hello from the app',
          raw: 'Hello from the app',
          source: 'backend',
          prefixedMessage: undefined,
        } satisfies ParsedLog);
      });

      it('should parse [frontend] target from Tauri log plugin', () => {
        const result = parseLogLine('[frontend] INFO user navigated to /home');
        expect(result).toBeDefined();
        expect(result?.source).toBe('frontend');
        expect(result?.level).toBe('info');
      });

      it('should handle tauri plugin pattern in log line', () => {
        const result = parseLogLine('[INFO][tauri_plugin_http] request completed');
        expect(result?.message).toContain('request completed');
        expect(result?.message).not.toContain('tauri_plugin_http');
      });
    });
  });

  describe('parseLogLines', () => {
    it('should return empty array for empty string', () => {
      expect(parseLogLines('')).toEqual([]);
    });

    it('should parse a single line', () => {
      const results = parseLogLines('INFO application started');
      expect(results).toHaveLength(1);
      expect(results[0].level).toBe('info');
      expect(results[0].message).toContain('application started');
    });

    it('should parse multiple newline-separated lines', () => {
      const input = [
        '[Tauri:Backend] starting up',
        '[Tauri:Frontend] "page loaded"',
        '[WDIO-FRONTEND][ERROR] something broke',
      ].join('\n');

      const results = parseLogLines(input);
      expect(results).toHaveLength(3);
      expect(results[0].source).toBe('backend');
      expect(results[1].source).toBe('frontend');
      expect(results[2].source).toBe('frontend');
      expect(results[2].level).toBe('error');
    });

    it('should filter out empty lines', () => {
      const input = ['INFO first line', '', '  ', 'WARN second line'].join('\n');
      const results = parseLogLines(input);
      expect(results).toHaveLength(2);
    });

    it('should filter out tauri-driver lines', () => {
      const input = ['INFO app log', 'tauri-driver listening on 4444', 'WARN another log'].join('\n');
      const results = parseLogLines(input);
      expect(results).toHaveLength(2);
      expect(results.every((r) => !r.raw.includes('tauri-driver'))).toBe(true);
    });

    it('should handle lines with only whitespace between valid lines', () => {
      const input = 'INFO first\n\n\nINFO second';
      const results = parseLogLines(input);
      expect(results).toHaveLength(2);
    });

    it('should handle trailing newline', () => {
      const input = 'INFO message\n';
      const results = parseLogLines(input);
      expect(results).toHaveLength(1);
    });

    it('should preserve order of parsed lines', () => {
      const input = ['ERROR first', 'WARN second', 'INFO third'].join('\n');
      const results = parseLogLines(input);
      expect(results[0].level).toBe('error');
      expect(results[1].level).toBe('warn');
      expect(results[2].level).toBe('info');
    });
  });
});
