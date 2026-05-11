import { describe, expect, it } from 'vitest';

import { LOG_LEVEL_PRIORITY, shouldLog } from '../src/logLevel.js';

describe('logLevel', () => {
  describe('LOG_LEVEL_PRIORITY', () => {
    it('orders trace lowest, error highest', () => {
      expect(LOG_LEVEL_PRIORITY.trace).toBeLessThan(LOG_LEVEL_PRIORITY.debug);
      expect(LOG_LEVEL_PRIORITY.debug).toBeLessThan(LOG_LEVEL_PRIORITY.info);
      expect(LOG_LEVEL_PRIORITY.info).toBeLessThan(LOG_LEVEL_PRIORITY.warn);
      expect(LOG_LEVEL_PRIORITY.warn).toBeLessThan(LOG_LEVEL_PRIORITY.error);
    });
  });

  describe('shouldLog', () => {
    it('emits when level matches minLevel exactly', () => {
      expect(shouldLog('info', 'info')).toBe(true);
      expect(shouldLog('error', 'error')).toBe(true);
    });

    it('emits when level is above minLevel', () => {
      expect(shouldLog('error', 'info')).toBe(true);
      expect(shouldLog('warn', 'debug')).toBe(true);
      expect(shouldLog('info', 'trace')).toBe(true);
    });

    it('suppresses when level is below minLevel', () => {
      expect(shouldLog('trace', 'info')).toBe(false);
      expect(shouldLog('debug', 'warn')).toBe(false);
      expect(shouldLog('info', 'error')).toBe(false);
    });

    it('treats trace as lowest priority', () => {
      expect(shouldLog('trace', 'trace')).toBe(true);
      expect(shouldLog('trace', 'debug')).toBe(false);
    });
  });
});
