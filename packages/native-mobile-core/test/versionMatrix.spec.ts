import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { APPIUM_MATRIX, driverSpecFor, supportedAppiumMajors } from '../src/versionMatrix.js';

// Derived, never hardcoded: e2e/package.json is what actually gets installed, so a routine
// driver bump there should only ever require editing the matrix itself — not these specs.
const e2ePkg = JSON.parse(readFileSync(new URL('../../../e2e/package.json', import.meta.url), 'utf8'));
const e2eDevDeps = e2ePkg.devDependencies as Record<string, string>;
const majorOf = (range: string) => Number.parseInt(range.replace(/^\D*/, ''), 10);
const e2eAppiumMajor = majorOf(e2eDevDeps.appium);

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

  // Drift guard: the matrix must track the Appium major and each driver *major* e2e actually
  // installs against, so a driver-major bump in e2e (a compatibility change we ship to users)
  // fails here rather than silently pinning a stale major — while routine patch/minor bumps in
  // e2e flow through untouched. A new Appium major surfaces as a missing row needing a deliberate add.
  it('should match the Appium major and driver majors pinned in e2e/package.json', () => {
    const row = APPIUM_MATRIX.find((r) => r.appiumMajor === e2eAppiumMajor);
    expect(row).toBeDefined();
    for (const spec of Object.values(row?.drivers ?? {})) {
      const installed = e2eDevDeps[spec.source];
      expect(installed, `${spec.source} is missing from e2e/package.json devDependencies`).toBeDefined();
      expect(majorOf(installed as string)).toBe(majorOf(spec.version));
    }
  });
});
