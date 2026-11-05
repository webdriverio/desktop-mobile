import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  followWebdriverio,
  getUpdateType,
  pickNextCatalogVersion,
  setCatalogVersions,
  withWdioGroup,
} from '../../scripts/update-catalogs.ts';

describe('compareVersions', () => {
  it.each([
    ['10.2.0-alpha.100.sha-b38abd894', '10.1.0'],
    ['10.1.0', '10.1.0-alpha.30'],
    ['10.1.0-alpha.100', '10.1.0-alpha.30'],
    ['1.0.0-beta', '1.0.0-alpha'],
    ['1.0.0-alpha.1', '1.0.0-alpha'],
    ['1.0.0-alpha', '1.0.0-1'],
    ['2.0.0', '1.99.99'],
  ])('should order %s after %s', (newer, older) => {
    expect(compareVersions(newer, older)).toBeGreaterThan(0);
    expect(compareVersions(older, newer)).toBeLessThan(0);
  });

  it('should ignore build metadata', () => {
    expect(compareVersions('1.0.0+build.1', '1.0.0')).toBe(0);
  });
});

describe('getUpdateType', () => {
  it.each([
    ['10.1.0', '11.0.0', 'major'],
    ['10.1.0', '10.2.0-alpha.1', 'minor'],
    ['10.1.0', '10.1.1', 'patch'],
    ['10.2.0-alpha.100', '10.2.0-alpha.101', 'prerelease'],
    ['10.2.0-alpha.1', '10.2.0', 'prerelease'],
    ['10.2.0-alpha.1', '10.2.0+sha.abc', 'prerelease'],
    ['latest', '10.1.0', 'unknown'],
  ])('should call %s to %s a %s update', (current, latest, type) => {
    expect(getUpdateType(current, latest)).toBe(type);
  });
});

describe('followWebdriverio', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const day = 1440;
  const old = '2026-10-31T00:00:00Z';
  const info = (name: string, currentVersion: string, latestVersion: string) => ({
    name,
    currentVersion,
    latestVersion,
    isUpToDate: currentVersion === latestVersion,
    updateType: getUpdateType(currentVersion, latestVersion),
  });
  const published = (time: Record<string, string>) => ({ time, versions: Object.keys(time) });

  it("should move the packages that published webdriverio's version to webdriverio's pick", () => {
    const infos = [
      info('webdriverio', '10.2.0-alpha.100', '10.2.0-alpha.101'),
      info('@wdio/cli', '10.2.0-alpha.99', '10.2.0-alpha.99'),
      info('@wdio/visual-service', '11.0.0', '11.1.0'),
    ];
    const packuments = new Map([
      ['webdriverio', published({ '10.2.0-alpha.100': old, '10.2.0-alpha.101': old })],
      ['@wdio/cli', published({ '10.2.0-alpha.99': old, '10.2.0-alpha.100': old, '10.2.0-alpha.101': old })],
      ['@wdio/visual-service', published({ '11.0.0': old, '11.1.0': old })],
    ]);

    expect(followWebdriverio(infos, packuments, now, day)).toBeUndefined();
    expect(infos.map((pkg) => [pkg.name, pkg.latestVersion])).toEqual([
      ['webdriverio', '10.2.0-alpha.101'],
      ['@wdio/cli', '10.2.0-alpha.101'],
      ['@wdio/visual-service', '11.1.0'],
    ]);
  });

  it("should keep them all and say which is missing when one hasn't published webdriverio's pick", () => {
    const infos = [
      info('webdriverio', '10.2.0-alpha.100', '10.2.0-alpha.101'),
      info('@wdio/utils', '10.2.0-alpha.100', '10.2.0-alpha.100'),
    ];
    const packuments = new Map([
      ['webdriverio', published({ '10.2.0-alpha.100': old, '10.2.0-alpha.101': old })],
      ['@wdio/utils', published({ '10.2.0-alpha.100': old })],
    ]);

    expect(followWebdriverio(infos, packuments, now, day)).toContain('@wdio/utils');
    expect(infos.map((pkg) => [pkg.latestVersion, pkg.isUpToDate])).toEqual([
      ['10.2.0-alpha.100', true],
      ['10.2.0-alpha.100', true],
    ]);
  });

  it("should keep them all when one on webdriverio's version couldn't be looked up", () => {
    const infos = [
      info('webdriverio', '10.2.0-alpha.100', '10.2.0-alpha.101'),
      info('@wdio/types', '10.2.0-alpha.100', 'unknown'),
    ];
    const packuments = new Map([['webdriverio', published({ '10.2.0-alpha.100': old, '10.2.0-alpha.101': old })]]);

    expect(followWebdriverio(infos, packuments, now, day)).toContain('@wdio/types');
    expect(infos[0].latestVersion).toBe('10.2.0-alpha.100');
  });
});

describe('withWdioGroup', () => {
  it('should add the rest of the WebdriverIO packages when one of them is selected', () => {
    const infos = [
      { name: 'webdriverio', followsWebdriverio: true, isUpToDate: false },
      { name: '@wdio/cli', followsWebdriverio: true, isUpToDate: false },
      { name: 'electron-nightly', isUpToDate: false },
    ].map((pkg) => ({ currentVersion: 'a', latestVersion: 'b', updateType: 'unknown' as const, ...pkg }));

    expect(withWdioGroup(['@wdio/cli'], infos)).toEqual(['@wdio/cli', 'webdriverio']);
    expect(withWdioGroup(['electron-nightly'], infos)).toEqual(['electron-nightly']);
  });
});

describe('pickNextCatalogVersion', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const day = 1440;
  const packument = (tags: Record<string, string>, published: Record<string, string>) => ({
    'dist-tags': tags,
    time: published,
    versions: Object.keys(published),
  });

  it('should take the next prerelease when it is newer than latest', () => {
    const version = pickNextCatalogVersion(
      packument(
        { latest: '10.1.0', next: '10.2.0-alpha.100' },
        { '10.1.0': '2026-10-18T00:00:00Z', '10.2.0-alpha.100': '2026-10-31T00:00:00Z' },
      ),
      '10.1.0',
      now,
      day,
    );

    expect(version).toBe('10.2.0-alpha.100');
  });

  it('should take latest while next still points at an older prerelease', () => {
    const version = pickNextCatalogVersion(
      packument(
        { latest: '10.1.0', next: '10.1.0-alpha.30' },
        { '10.1.0': '2026-10-18T00:00:00Z', '10.1.0-alpha.30': '2026-10-07T00:00:00Z' },
      ),
      '10.1.0-alpha.30',
      now,
      day,
    );

    expect(version).toBe('10.1.0');
  });

  it('should keep the current pin while next is too new for the release age, not fall back to latest', () => {
    const version = pickNextCatalogVersion(
      packument(
        { latest: '10.1.0', next: '10.2.0-alpha.101' },
        { '10.1.0': '2026-10-18T00:00:00Z', '10.2.0-alpha.101': '2026-11-04T06:00:00Z' },
      ),
      '10.2.0-alpha.100',
      now,
      day,
    );

    expect(version).toBe('10.2.0-alpha.100');
  });

  it('should take the newest alpha old enough for the release age when next is too new', () => {
    const version = pickNextCatalogVersion(
      packument(
        { latest: '10.1.0', next: '10.2.0-alpha.101' },
        {
          '10.1.0': '2026-10-18T00:00:00Z',
          '10.2.0-alpha.99': '2026-11-02T00:00:00Z',
          '10.2.0-alpha.100': '2026-11-03T06:00:00Z',
          '10.2.0-alpha.101': '2026-11-04T06:00:00Z',
        },
      ),
      '10.2.0-alpha.99',
      now,
      day,
    );

    expect(version).toBe('10.2.0-alpha.100');
  });

  it('should take latest when there is no next tag', () => {
    expect(
      pickNextCatalogVersion(packument({ latest: '11.0.0' }, { '11.0.0': '2026-10-01T00:00:00Z' }), '10.0.0', now, day),
    ).toBe('11.0.0');
  });

  it('should keep the current pin when no tagged version is old enough or has a publish time', () => {
    const version = pickNextCatalogVersion(
      packument({ latest: '10.1.0', next: '10.2.0-alpha.101' }, { '10.2.0-alpha.101': '2026-11-04T06:00:00Z' }),
      '10.2.0-alpha.100',
      now,
      day,
    );

    expect(version).toBe('10.2.0-alpha.100');
  });
});

describe('setCatalogVersions', () => {
  const workspace = [
    'packages:',
    '  - packages/*',
    '# The catalogs',
    'catalogs:',
    '  default:',
    '    "@wdio/cli": 10.1.0',
    '    webdriverio: 10.1.0',
    '  next:',
    '    "@wdio/cli": latest # tracked by update-catalogs',
    '    webdriverio: latest',
    'minimumReleaseAgeExclude:',
    '  - "@wdio/native-core@1.3.1"',
    '',
  ].join('\n');

  it('should set the versions in the named catalog only', () => {
    const updated = setCatalogVersions(workspace, 'next', {
      '@wdio/cli': '10.2.0-alpha.100',
      webdriverio: '10.2.0-alpha.100',
    });

    expect(updated).toContain('    "@wdio/cli": 10.2.0-alpha.100 # tracked by update-catalogs');
    expect(updated).toContain('    webdriverio: 10.2.0-alpha.100');
    expect(updated).toContain('  default:\n    "@wdio/cli": 10.1.0\n    webdriverio: 10.1.0');
  });

  it('should keep the rest of the file, including the sections after the catalogs', () => {
    const updated = setCatalogVersions(workspace, 'next', { webdriverio: '10.2.0-alpha.100' });

    expect(updated).toBe(workspace.replace('    webdriverio: latest', '    webdriverio: 10.2.0-alpha.100'));
  });
});
