import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { APPIUM_MATRIX, driverSpecFor, supportedAppiumMajors } from '../src/versionMatrix.js';

describe('versionMatrix', () => {
  it('should resolve a known driver spec for the supported Appium major', () => {
    expect(driverSpecFor('uiautomator2', 3)).toEqual({
      name: 'uiautomator2',
      source: 'appium-uiautomator2-driver',
      version: '^8.0.1',
    });
    expect(driverSpecFor('flutter', 3)?.source).toBe('appium-flutter-driver');
  });

  it('should return undefined for an unknown driver or unsupported major', () => {
    expect(driverSpecFor('uiautomator2', 99)).toBeUndefined();
    expect(driverSpecFor('nope', 3)).toBeUndefined();
  });

  it('should report the supported Appium majors', () => {
    expect(supportedAppiumMajors()).toContain(3);
  });

  // Drift guard: the matrix must track the ranges e2e actually installs against, so a bump
  // in e2e that the matrix misses fails here rather than silently installing a stale driver.
  it('should match the driver version ranges pinned in e2e/package.json', () => {
    const e2ePkg = JSON.parse(readFileSync(new URL('../../../e2e/package.json', import.meta.url), 'utf8'));
    const dev = e2ePkg.devDependencies as Record<string, string>;
    const row = APPIUM_MATRIX.find((r) => r.appiumMajor === 3);
    expect(row).toBeDefined();
    for (const spec of Object.values(row?.drivers ?? {})) {
      expect(dev[spec.source]).toBe(spec.version);
    }
  });
});
