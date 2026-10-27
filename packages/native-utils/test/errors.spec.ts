import { describe, expect, it } from 'vitest';
import { SevereServiceError } from 'webdriverio';
import { errorMessage, severeServiceError } from '../src/errors.js';

describe('errorMessage', () => {
  it('should use an Error message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('should read the message of a plain error-like object', () => {
    expect(errorMessage({ message: 'session not found', code: 'X' })).toBe('session not found');
  });

  it('should stringify anything else', () => {
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage('boom')).toBe('boom');
    expect(errorMessage({ code: 1 })).toBe('[object Object]');
  });
});

describe('severeServiceError', () => {
  it('should return a SevereServiceError preserving the Error cause and prefixed message', () => {
    const cause = new Error('port 4444 in use');
    const error = severeServiceError('Failed to start driver', cause);

    expect(error).toBeInstanceOf(SevereServiceError);
    expect(error.name).toBe('SevereServiceError');
    expect(error.message).toBe('Failed to start driver: port 4444 in use');
    expect(error.cause).toBe(cause);
  });

  it('should use the cause message alone when given no message', () => {
    const cause = new Error('Dev server not reachable at http://localhost:5173');
    const error = severeServiceError(cause);

    expect(error).toBeInstanceOf(SevereServiceError);
    expect(error.message).toBe('Dev server not reachable at http://localhost:5173');
    expect(error.cause).toBe(cause);
  });

  it('should handle non-Error causes via errorMessage', () => {
    const error = severeServiceError('Startup failed', 'raw string error');

    expect(error).toBeInstanceOf(SevereServiceError);
    expect(error.message).toBe('Startup failed: raw string error');
    expect(error.cause).toBe('raw string error');
  });
});
