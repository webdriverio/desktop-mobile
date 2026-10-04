// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getConfig } from '../../src/config/builder.js';
import { APP_NAME_DETECTION_ERROR } from '../../src/constants.js';
import { getFixturePackageJson } from '../testUtils.js';

vi.mock('@wdio/native-utils', async (importActual) => {
  const actual = await importActual<typeof import('@wdio/native-utils')>();
  const { createLogger } = await import('../__mock__/log.js');
  return { ...actual, createLogger };
});

const expectedCandidates = [
  'electron-builder.yml',
  'electron-builder.config.yml',
  'electron-builder.yaml',
  'electron-builder.config.yaml',
  'electron-builder.json',
  'electron-builder.config.json',
  'electron-builder.json5',
  'electron-builder.config.json5',
  'electron-builder.toml',
  'electron-builder.config.toml',
  'electron-builder.js',
  'electron-builder.config.js',
  'electron-builder.mjs',
  'electron-builder.config.mjs',
  'electron-builder.cjs',
  'electron-builder.config.cjs',
  'electron-builder.ts',
  'electron-builder.config.ts',
  'electron-builder.mts',
  'electron-builder.config.mts',
  'electron-builder.cts',
  'electron-builder.config.cts',
];

describe('getConfig', () => {
  describe('config formats', () => {
    it.each([
      ['CJS config', 'builder-dependency-cjs-config'],
      ['CTS config', 'builder-dependency-cts-config'],
      ['JS config', 'builder-dependency-js-config'],
      ['JSON config', 'builder-dependency-json-config'],
      ['JSON5 config', 'builder-dependency-json5-config'],
      ['MJS config', 'builder-dependency-mjs-config'],
      ['MTS config', 'builder-dependency-mts-config'],
      ['TOML config', 'builder-dependency-toml-config'],
      ['TS-Fn config', 'builder-dependency-ts-fn-config'],
      ['TS-Obj config', 'builder-dependency-ts-obj-config'],
      ['YAML(.yaml) config', 'builder-dependency-yaml-config'],
      ['YAML(.yml) config', 'builder-dependency-yml-config'],
    ])('%s', async (_title, scenario) => {
      const pkg = await getFixturePackageJson('config-formats', scenario);
      const config = await getConfig(pkg);
      // Not toStrictEqual: smol-toml returns null-prototype objects, which it treats as a type mismatch.
      expect(config).toEqual({
        appName: scenario,
        config: {
          productName: scenario,
        },
        isBuilder: true,
        isForge: false,
      });
    });

    it('should return undefined if no config file is found', async () => {
      const spy = vi.spyOn(fs, 'access');
      const pkg = await getFixturePackageJson('config-formats', 'builder-dependency-no-config');
      const config = await getConfig(pkg);
      const checkedFiles = spy.mock.calls.map(([file]) => path.basename(file.toString()));

      expect(config).toBeUndefined();
      expect(checkedFiles).toStrictEqual(expectedCandidates);
    });

    it('should return the expected config when productName is set in the package.json', async () => {
      const pkg = await getFixturePackageJson('config-formats', 'builder-dependency-inline-config');
      const config = await getConfig(pkg);

      expect(config?.appName).toBe('builder-dependency-inline-config-product-name');
    });

    it('should return the expected config when productName is set in the builderConfig', async () => {
      const pkg = await getFixturePackageJson('config-formats', 'builder-dependency-inline-config');
      delete pkg.packageJson.productName;
      const config = await getConfig(pkg);

      expect(config?.appName).toBe('builder-dependency-inline-config');
    });

    it('should return the expected config when name is set in the package.json', async () => {
      const pkg = await getFixturePackageJson('config-formats', 'builder-dependency-inline-config');
      delete pkg.packageJson.productName;
      delete pkg.packageJson.build.productName;
      const config = await getConfig(pkg);

      expect(config?.appName).toBe('fixture-config-formats_builder-dependency-inline-config');
    });

    it('should throw the error when could not detect the appName', async () => {
      const pkg = await getFixturePackageJson('config-formats', 'builder-dependency-inline-config');
      delete pkg.packageJson.productName;
      delete pkg.packageJson.build.productName;
      delete pkg.packageJson.name;

      await expect(() => getConfig(pkg)).rejects.toThrowError(APP_NAME_DETECTION_ERROR);
    });
  });

  describe('extends support', () => {
    it('should resolve single extends config', async () => {
      const pkg = await getFixturePackageJson('config-formats', 'builder-extends-single');
      const config = await getConfig(pkg);

      expect(config).toStrictEqual({
        appName: 'builder-extends-single',
        config: {
          productName: 'builder-extends-single',
          directories: { output: 'custom-dist' },
          executableName: 'base-executable',
        },
        isBuilder: true,
        isForge: false,
      });
    });

    it('should resolve array extends with proper precedence', async () => {
      const pkg = await getFixturePackageJson('config-formats', 'builder-extends-array');
      const config = await getConfig(pkg);

      // override.config.js should override base.config.js output dir
      // main config productName takes final precedence
      expect(config?.config.directories?.output).toBe('override-dist');
      expect(config?.config.executableName).toBe('base-name');
      expect(config?.config.productName).toBe('builder-extends-array');
    });

    it('should resolve nested extends chains', async () => {
      const pkg = await getFixturePackageJson('config-formats', 'builder-extends-nested');
      const config = await getConfig(pkg);

      expect(config?.config.directories?.output).toBe('grandparent-dist');
      expect(config?.config.executableName).toBe('parent-name');
      expect(config?.config.productName).toBe('builder-extends-nested');
    });

    it('should use custom config path when provided', async () => {
      const pkg = await getFixturePackageJson('config-formats', 'builder-extends-single');
      // Pass the complete path to the config file
      const customConfigPath = path.join(path.dirname(pkg.path), 'electron-builder.config.js');
      const config = await getConfig(pkg, customConfigPath);

      expect(config?.config.productName).toBe('builder-extends-single');
      expect(config?.config.executableName).toBe('base-executable');
    });
  });
});
