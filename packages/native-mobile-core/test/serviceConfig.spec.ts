import { describe, expect, it } from 'vitest';

import { getServiceOptionsFromCapability, mergeServiceOptions } from '../src/serviceConfig.js';

interface Opts {
  metroHost?: string;
  metroPort?: number;
}

const KEY = 'wdio:testServiceOptions';

describe('getServiceOptionsFromCapability', () => {
  it('should read the service options off the given custom-capability key', () => {
    const opts = { metroPort: 9000 };
    expect(getServiceOptionsFromCapability<Opts>({ [KEY]: opts }, KEY)).toBe(opts);
  });

  it('should return undefined when the capability has no service options', () => {
    expect(getServiceOptionsFromCapability<Opts>({}, KEY)).toBeUndefined();
    expect(getServiceOptionsFromCapability<Opts>(undefined, KEY)).toBeUndefined();
  });
});

describe('mergeServiceOptions', () => {
  it('should let capability options win over global options', () => {
    expect(mergeServiceOptions<Opts>({ metroPort: 8081 }, { metroPort: 9000 })).toEqual({ metroPort: 9000 });
  });

  it('should merge disjoint global and capability options', () => {
    expect(mergeServiceOptions<Opts>({ metroHost: 'localhost' }, { metroPort: 9000 })).toEqual({
      metroHost: 'localhost',
      metroPort: 9000,
    });
  });

  it('should default to an empty object when no options are given', () => {
    expect(mergeServiceOptions<Opts>(undefined, undefined)).toEqual({});
  });
});
