import { describe, expect, it } from 'vitest';

import { CUSTOM_CAPABILITY_NAME } from '../src/constants.js';
import { getServiceOptionsFromCapability, mergeServiceOptions } from '../src/serviceConfig.js';

describe('getServiceOptionsFromCapability', () => {
  it('should read the service options off the custom capability key', () => {
    const opts = { metroPort: 9000 };
    expect(getServiceOptionsFromCapability({ [CUSTOM_CAPABILITY_NAME]: opts })).toBe(opts);
  });

  it('should return undefined when the capability has no service options', () => {
    expect(getServiceOptionsFromCapability({})).toBeUndefined();
    expect(getServiceOptionsFromCapability(undefined)).toBeUndefined();
  });
});

describe('mergeServiceOptions', () => {
  it('should let capability options win over global options', () => {
    expect(mergeServiceOptions({ metroPort: 8081 }, { metroPort: 9000 })).toEqual({ metroPort: 9000 });
  });

  it('should merge disjoint global and capability options', () => {
    expect(mergeServiceOptions({ metroHost: 'localhost' }, { metroPort: 9000 })).toEqual({
      metroHost: 'localhost',
      metroPort: 9000,
    });
  });

  it('should default to an empty object when no options are given', () => {
    expect(mergeServiceOptions(undefined, undefined)).toEqual({});
  });
});
