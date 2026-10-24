import { describe, expect, it } from 'vitest';
import { isMultiremote } from '../src/multiremote.js';

type BrowserArg = Parameters<typeof isMultiremote>[0];

describe('isMultiremote', () => {
  it('should read the v10 flag', () => {
    expect(isMultiremote({ isMultiRemote: true } as unknown as BrowserArg)).toBe(true);
    expect(isMultiremote({ isMultiRemote: false } as unknown as BrowserArg)).toBe(false);
  });

  it('should read the v9 flag', () => {
    expect(isMultiremote({ isMultiremote: true } as unknown as BrowserArg)).toBe(true);
    expect(isMultiremote({ isMultiremote: false } as unknown as BrowserArg)).toBe(false);
  });

  it('should be false when neither flag is set', () => {
    expect(isMultiremote({} as unknown as BrowserArg)).toBe(false);
  });
});
