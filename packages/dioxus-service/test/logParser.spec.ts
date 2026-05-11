import { describe, expect, it } from 'vitest';

import { parseLogLine } from '../src/logParser.js';

describe('parseLogLine', () => {
  it('should return undefined for empty input', () => {
    expect(parseLogLine('')).toBeUndefined();
    expect(parseLogLine('   ')).toBeUndefined();
  });

  it('should classify [WDIO-FRONTEND] lines as frontend', () => {
    const result = parseLogLine('[WDIO-FRONTEND][INFO] hello from app');
    expect(result?.source).toBe('frontend');
    expect(result?.level).toBe('info');
    expect(result?.message).toBe('hello from app');
  });

  it('should propagate the frontend log level from the marker', () => {
    expect(parseLogLine('[WDIO-FRONTEND][ERROR] boom')?.level).toBe('error');
    expect(parseLogLine('[WDIO-FRONTEND][WARN] caution')?.level).toBe('warn');
    expect(parseLogLine('[WDIO-FRONTEND][DEBUG] verbose')?.level).toBe('debug');
    expect(parseLogLine('[WDIO-FRONTEND][TRACE] very verbose')?.level).toBe('trace');
  });

  it('should default frontend level to info when the bracket is missing', () => {
    const result = parseLogLine('[WDIO-FRONTEND] no-level-bracket');
    expect(result?.source).toBe('frontend');
    expect(result?.level).toBe('info');
    expect(result?.message).toBe('no-level-bracket');
  });

  it('should classify non-frontend lines as backend', () => {
    const result = parseLogLine('INFO some::module: app started');
    expect(result?.source).toBe('backend');
    expect(result?.level).toBe('info');
  });

  it('should detect error level in backend lines', () => {
    expect(parseLogLine('ERROR connection refused')?.level).toBe('error');
    expect(parseLogLine('thread main panicked at error: explode')?.level).toBe('error');
  });

  it('should detect warn level in backend lines', () => {
    expect(parseLogLine('WARN deprecation notice')?.level).toBe('warn');
  });

  it('should default backend level to info when no marker is present', () => {
    expect(parseLogLine('plain log without a level')?.level).toBe('info');
  });

  it('should not match a level token that appears in the message body', () => {
    // The token "error" is inside the message ("error.log"), not the level
    // header. detectLevel restricts its search to the prefix before the
    // first colon.
    const result = parseLogLine('2025-01-01T12:00:00Z INFO my_module: cannot find file — check error.log');
    expect(result?.level).toBe('info');
  });

  it('should detect the level from the prefix when the message body would also match', () => {
    const result = parseLogLine('2025-01-01T12:00:00Z WARN my_module: deprecated path used in error.handler');
    expect(result?.level).toBe('warn');
  });

  it('should preserve the raw line', () => {
    const raw = '  [WDIO-FRONTEND][INFO] padded  ';
    expect(parseLogLine(raw)?.raw).toBe(raw.trim());
  });
});
