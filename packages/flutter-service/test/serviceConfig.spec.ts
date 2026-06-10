import { describe, expect, it } from 'vitest';

import { CUSTOM_CAPABILITY_NAME } from '../src/constants.js';
import { getServiceOptionsFromCapability, mergeServiceOptions } from '../src/serviceConfig.js';

describe('getServiceOptionsFromCapability', () => {
  it('should read the options off wdio:flutterServiceOptions', () => {
    const opts = { vmServicePort: 8181 };
    expect(getServiceOptionsFromCapability({ [CUSTOM_CAPABILITY_NAME]: opts })).toBe(opts);
  });

  it('should return undefined when absent', () => {
    expect(getServiceOptionsFromCapability({})).toBeUndefined();
    expect(getServiceOptionsFromCapability(undefined)).toBeUndefined();
  });
});

describe('mergeServiceOptions', () => {
  it('should let capability options win', () => {
    expect(mergeServiceOptions({ vmServicePort: 1 }, { vmServicePort: 2 })).toEqual({ vmServicePort: 2 });
  });

  it('should merge disjoint options', () => {
    expect(mergeServiceOptions({ vmServiceHost: 'h' }, { vmServicePort: 2 })).toEqual({
      vmServiceHost: 'h',
      vmServicePort: 2,
    });
  });

  it('should default to an empty object', () => {
    expect(mergeServiceOptions(undefined, undefined)).toEqual({});
  });
});
