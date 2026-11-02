import { afterEach, describe, expect, it } from 'vitest';

import { mergeEnv } from '../src/env.js';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('mergeEnv', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('should set each layer over the ones before it', () => {
    expect(mergeEnv({ A: '1', B: '1' }, { B: '2', C: '2' }, undefined, { C: '3' })).toEqual({ A: '1', B: '2', C: '3' });
  });

  it("should replace a variable whatever its case on Windows, keeping the later layer's name", () => {
    setPlatform('win32');

    expect(mergeEnv({ PATH: 'C:\\Windows', Other: '1' }, { Path: 'C:\\tools' })).toEqual({
      Path: 'C:\\tools',
      Other: '1',
    });
  });

  it('should fold names to upper case, as Node does, so ß and SS count as one name', () => {
    setPlatform('win32');

    expect(mergeEnv({ STRASSE: 'old' }, { straße: 'new' })).toEqual({ straße: 'new' });
  });

  it('should keep a variable named __proto__', () => {
    const layer = JSON.parse('{"__proto__": "kept"}') as Record<string, string>;

    expect(Object.entries(mergeEnv(layer))).toEqual([['__proto__', 'kept']]);
  });

  it('should keep differently cased names apart elsewhere', () => {
    setPlatform('linux');

    expect(mergeEnv({ PATH: '/usr/bin' }, { Path: '/opt/bin' })).toEqual({ PATH: '/usr/bin', Path: '/opt/bin' });
  });
});
