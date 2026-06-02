import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SevereServiceError } from 'webdriverio';

import {
  type BuildJson,
  getRemoteDebuggingPort,
  readBuildJson,
  resolveElectrobunApp,
  verifyCefRenderer,
  writeRemoteDebuggingPort,
} from '../src/electrobunConfig.js';

const CEF_FRAMEWORK = 'Chromium Embedded Framework.framework';

interface FakeAppOptions {
  withFramework?: boolean;
  buildJson?: BuildJson | undefined;
  bundleName?: string;
}

/**
 * Build a fake macOS `.app` tree under a temp dir. Returns useful paths.
 */
function makeFakeMacApp(root: string, opts: FakeAppOptions = {}): { appDir: string; binaryPath: string } {
  const bundleName = opts.bundleName ?? 'Demo';
  const appDir = join(root, `${bundleName}.app`);
  const macosDir = join(appDir, 'Contents', 'MacOS');
  const resourcesDir = join(appDir, 'Contents', 'Resources');
  mkdirSync(macosDir, { recursive: true });
  mkdirSync(resourcesDir, { recursive: true });

  const binaryPath = join(macosDir, bundleName);
  writeFileSync(binaryPath, '#!/bin/sh\n', 'utf8');

  if (opts.buildJson !== undefined) {
    writeFileSync(join(resourcesDir, 'build.json'), JSON.stringify(opts.buildJson, null, 2), 'utf8');
  }

  if (opts.withFramework) {
    mkdirSync(join(appDir, 'Contents', 'Frameworks', CEF_FRAMEWORK), { recursive: true });
  }

  return { appDir, binaryPath };
}

describe('electrobunConfig', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eb-config-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('resolveElectrobunApp', () => {
    it('should throw a SevereServiceError when appBinaryPath is missing', () => {
      expect(() => resolveElectrobunApp(undefined, 'darwin')).toThrow(SevereServiceError);
      expect(() => resolveElectrobunApp(undefined, 'darwin')).toThrow(/explicit appBinaryPath/);
    });

    it('should throw a SevereServiceError when the path does not exist', () => {
      const missing = join(root, 'NoSuch.app');
      expect(() => resolveElectrobunApp(missing, 'darwin')).toThrow(SevereServiceError);
      expect(() => resolveElectrobunApp(missing, 'darwin')).toThrow(/does not exist/);
    });

    it('should resolve from a macOS .app directory', () => {
      const { appDir } = makeFakeMacApp(root, { buildJson: { identifier: 'com.example.demo' } });

      const resolved = resolveElectrobunApp(appDir, 'darwin');

      expect(resolved.bundlePath).toBe(appDir);
      expect(resolved.resourcesDir).toBe(join(appDir, 'Contents', 'Resources'));
      expect(resolved.buildJsonPath).toBe(join(appDir, 'Contents', 'Resources', 'build.json'));
      expect(resolved.binaryPath).toBe(join(appDir, 'Contents', 'MacOS', 'Demo'));
      expect(resolved.identifier).toBe('com.example.demo');
    });

    it('should resolve from the inner macOS binary path', () => {
      const { appDir, binaryPath } = makeFakeMacApp(root, { buildJson: { identifier: 'com.example.demo' } });

      const resolved = resolveElectrobunApp(binaryPath, 'darwin');

      expect(resolved.bundlePath).toBe(appDir);
      expect(resolved.binaryPath).toBe(binaryPath);
      expect(resolved.buildJsonPath).toBe(join(appDir, 'Contents', 'Resources', 'build.json'));
    });

    it('should resolve a sibling build.json on non-macOS platforms', () => {
      const binDir = join(root, 'linux-app');
      mkdirSync(binDir, { recursive: true });
      const binaryPath = join(binDir, 'demo');
      writeFileSync(binaryPath, '#!/bin/sh\n', 'utf8');
      writeFileSync(join(binDir, 'build.json'), JSON.stringify({ identifier: 'com.example.linux' }), 'utf8');

      const resolved = resolveElectrobunApp(binaryPath, 'linux');

      expect(resolved.binaryPath).toBe(binaryPath);
      expect(resolved.bundlePath).toBe(binDir);
      expect(resolved.resourcesDir).toBe(binDir);
      expect(resolved.buildJsonPath).toBe(join(binDir, 'build.json'));
      expect(resolved.identifier).toBe('com.example.linux');
    });

    it('should resolve the electrobun bin/launcher layout (build.json under Resources) on non-macOS', () => {
      // Linux/Windows bundle: <App>/bin/launcher[.exe] + <App>/Resources/build.json.
      const appRoot = join(root, 'WDIOElectrobunE2E-dev');
      const binDir = join(appRoot, 'bin');
      const resourcesDir = join(appRoot, 'Resources');
      mkdirSync(binDir, { recursive: true });
      mkdirSync(resourcesDir, { recursive: true });
      const binaryPath = join(binDir, 'launcher');
      writeFileSync(binaryPath, '#!/bin/sh\n', 'utf8');
      writeFileSync(
        join(resourcesDir, 'build.json'),
        JSON.stringify({ identifier: 'com.wdio.electrobun.e2e' }),
        'utf8',
      );

      const resolved = resolveElectrobunApp(binaryPath, 'linux');

      expect(resolved.binaryPath).toBe(binaryPath);
      expect(resolved.bundlePath).toBe(appRoot);
      expect(resolved.resourcesDir).toBe(resourcesDir);
      expect(resolved.buildJsonPath).toBe(join(resourcesDir, 'build.json'));
      expect(resolved.identifier).toBe('com.wdio.electrobun.e2e');
    });
  });

  describe('verifyCefRenderer', () => {
    it('should pass on macOS when the CEF framework is present', () => {
      const { appDir } = makeFakeMacApp(root, { withFramework: true, buildJson: {} });
      const resolved = resolveElectrobunApp(appDir, 'darwin');

      expect(() => verifyCefRenderer(resolved, 'darwin')).not.toThrow();
    });

    it('should pass on macOS when build.json indicates the cef renderer', () => {
      const { appDir } = makeFakeMacApp(root, { buildJson: { renderer: 'cef' } });
      const resolved = resolveElectrobunApp(appDir, 'darwin');

      expect(() => verifyCefRenderer(resolved, 'darwin')).not.toThrow();
    });

    it('should pass on macOS when build.json pins a remote-debugging port', () => {
      const { appDir } = makeFakeMacApp(root, {
        buildJson: { chromiumFlags: { 'remote-debugging-port': '9333' } },
      });
      const resolved = resolveElectrobunApp(appDir, 'darwin');

      expect(() => verifyCefRenderer(resolved, 'darwin')).not.toThrow();
    });

    it('should throw cefRendererRequired on macOS when CEF is absent', () => {
      const { appDir } = makeFakeMacApp(root, { buildJson: { renderer: 'webview' } });
      const resolved = resolveElectrobunApp(appDir, 'darwin');

      expect(() => verifyCefRenderer(resolved, 'darwin')).toThrow(SevereServiceError);
      expect(() => verifyCefRenderer(resolved, 'darwin')).toThrow(/CEF renderer/);
    });

    it('should throw cefRendererRequired on macOS when build.json is missing entirely', () => {
      const { appDir } = makeFakeMacApp(root, { buildJson: undefined });
      const resolved = resolveElectrobunApp(appDir, 'darwin');

      expect(() => verifyCefRenderer(resolved, 'darwin')).toThrow(/CEF renderer/);
    });

    it('should not false-negative on non-macOS when CEF cannot be confirmed', () => {
      const binDir = join(root, 'linux-app');
      mkdirSync(binDir, { recursive: true });
      const binaryPath = join(binDir, 'demo');
      writeFileSync(binaryPath, '#!/bin/sh\n', 'utf8');
      const resolved = resolveElectrobunApp(binaryPath, 'linux');

      expect(() => verifyCefRenderer(resolved, 'linux')).not.toThrow();
    });

    it('should pass on non-macOS when build.json indicates cef', () => {
      const binDir = join(root, 'linux-app');
      mkdirSync(binDir, { recursive: true });
      const binaryPath = join(binDir, 'demo');
      writeFileSync(binaryPath, '#!/bin/sh\n', 'utf8');
      writeFileSync(join(binDir, 'build.json'), JSON.stringify({ defaultRenderer: 'cef' }), 'utf8');
      const resolved = resolveElectrobunApp(binaryPath, 'linux');

      expect(() => verifyCefRenderer(resolved, 'linux')).not.toThrow();
    });
  });

  describe('readBuildJson', () => {
    it('should return undefined when build.json does not exist', () => {
      expect(readBuildJson(join(root, 'nope', 'build.json'))).toBeUndefined();
    });

    it('should return undefined when build.json is not valid JSON', () => {
      const p = join(root, 'build.json');
      writeFileSync(p, '{ not json', 'utf8');
      expect(readBuildJson(p)).toBeUndefined();
    });

    it('should parse a valid build.json', () => {
      const p = join(root, 'build.json');
      writeFileSync(p, JSON.stringify({ identifier: 'com.example.demo', chromiumFlags: {} }), 'utf8');
      expect(readBuildJson(p)?.identifier).toBe('com.example.demo');
    });
  });

  describe('getRemoteDebuggingPort', () => {
    it('should return undefined when no port is pinned', () => {
      expect(getRemoteDebuggingPort({ chromiumFlags: {} })).toBeUndefined();
      expect(getRemoteDebuggingPort(undefined)).toBeUndefined();
    });

    it('should parse the pinned port string into a number', () => {
      expect(getRemoteDebuggingPort({ chromiumFlags: { 'remote-debugging-port': '9333' } })).toBe(9333);
    });

    it('should return undefined for a non-numeric pinned value', () => {
      expect(getRemoteDebuggingPort({ chromiumFlags: { 'remote-debugging-port': 'abc' } })).toBeUndefined();
    });
  });

  describe('writeRemoteDebuggingPort', () => {
    it('should write the port as a string and round-trip via readBuildJson', () => {
      const p = join(root, 'build.json');
      writeFileSync(p, JSON.stringify({ identifier: 'com.example.demo', name: 'Demo' }), 'utf8');

      writeRemoteDebuggingPort(p, 9350);

      const after = readBuildJson(p);
      expect(after?.chromiumFlags?.['remote-debugging-port']).toBe('9350');
      expect(getRemoteDebuggingPort(after)).toBe(9350);
      // Other keys are preserved.
      expect(after?.identifier).toBe('com.example.demo');
      expect(after?.name).toBe('Demo');
    });

    it('should preserve existing chromiumFlags when pinning the port', () => {
      const p = join(root, 'build.json');
      writeFileSync(p, JSON.stringify({ chromiumFlags: { 'disable-gpu': 'true' } }), 'utf8');

      writeRemoteDebuggingPort(p, 9351);

      const after = readBuildJson(p);
      expect(after?.chromiumFlags?.['disable-gpu']).toBe('true');
      expect(after?.chromiumFlags?.['remote-debugging-port']).toBe('9351');
    });

    it('should also pin user-data-dir when provided (and omit it when not)', () => {
      const p = join(root, 'build.json');
      writeFileSync(p, JSON.stringify({ name: 'Demo' }), 'utf8');

      writeRemoteDebuggingPort(p, 9352, '/tmp/wdio-electrobun-userdata-abc');
      expect(readBuildJson(p)?.chromiumFlags?.['user-data-dir']).toBe('/tmp/wdio-electrobun-userdata-abc');

      // Omitted → no user-data-dir key written.
      writeFileSync(p, JSON.stringify({ name: 'Demo' }), 'utf8');
      writeRemoteDebuggingPort(p, 9353);
      expect(readBuildJson(p)?.chromiumFlags?.['user-data-dir']).toBeUndefined();
    });

    it('should throw a SevereServiceError when build.json does not exist', () => {
      expect(() => writeRemoteDebuggingPort(join(root, 'missing', 'build.json'), 9333)).toThrow(SevereServiceError);
      expect(() => writeRemoteDebuggingPort(join(root, 'missing', 'build.json'), 9333)).toThrow(/not found/);
    });

    it('should throw a SevereServiceError when build.json is not valid JSON', () => {
      const p = join(root, 'build.json');
      writeFileSync(p, '{ broken', 'utf8');
      expect(() => writeRemoteDebuggingPort(p, 9333)).toThrow(/not valid JSON/);
    });
  });
});
