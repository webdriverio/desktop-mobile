import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { APPIUM_MATRIX, driverSpecFor, supportedAppiumMajors } from '../src/versionMatrix.js';

// Derived, never hardcoded: e2e/package.json is what actually gets installed, so a routine
// driver bump there should only ever require editing the matrix itself — not these specs.
const e2ePkg = JSON.parse(readFileSync(new URL('../../../e2e/package.json', import.meta.url), 'utf8'));
const e2eDevDeps = e2ePkg.devDependencies as Record<string, string>;
const e2eAppiumMajor = Number.parseInt(e2eDevDeps.appium.replace(/^\D*/, ''), 10);

describe('versionMatrix', () => {
  it('should resolve a known driver spec for the supported Appium major', () => {
    const row = APPIUM_MATRIX.find((r) => r.appiumMajor === e2eAppiumMajor);
    expect(driverSpecFor('uiautomator2', e2eAppiumMajor)).toBe(row?.drivers.uiautomator2);
    expect(driverSpecFor('uiautomator2', e2eAppiumMajor)?.source).toBe('appium-uiautomator2-driver');
    expect(driverSpecFor('flutter', e2eAppiumMajor)?.source).toBe('appium-flutter-driver');
  });

  it('should return undefined for an unknown driver or unsupported major', () => {
    expect(driverSpecFor('uiautomator2', 99)).toBeUndefined();
    expect(driverSpecFor('nope', e2eAppiumMajor)).toBeUndefined();
  });

  it('should report the supported Appium majors', () => {
    expect(supportedAppiumMajors()).toContain(e2eAppiumMajor);
  });

  // Drift guard: the matrix must track the Appium major and driver ranges e2e actually installs
  // against, so a bump in e2e that the matrix misses fails here rather than silently installing
  // a stale driver. A new Appium major surfaces as a missing row, which needs a deliberate add.
  it('should match the Appium major and driver ranges pinned in e2e/package.json', () => {
    const row = APPIUM_MATRIX.find((r) => r.appiumMajor === e2eAppiumMajor);
    expect(row).toBeDefined();
    for (const spec of Object.values(row?.drivers ?? {})) {
      expect(e2eDevDeps[spec.source]).toBe(spec.version);
    }
  });
});
