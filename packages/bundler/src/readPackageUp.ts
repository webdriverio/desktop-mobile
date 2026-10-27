// Inlined here to avoid a circular build dependency: bundler builds native-utils,
// so native-utils cannot be imported by bundler at build time.
// The canonical implementation lives in @wdio/native-utils/src/package.ts.
import { readFileSync } from 'node:fs';
import { findUpSync } from 'find-up-simple';

export interface NormalizedPackageJson {
  name?: string;
  version?: string;
  description?: string;
  main?: string;
  module?: string;
  types?: string;
  exports?: unknown;
  type?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

export interface NormalizedReadResult {
  packageJson: NormalizedPackageJson;
  path: string;
}

export function readPackageUpSync(options: { cwd?: string } = {}): NormalizedReadResult | undefined {
  const filePath = findUpSync('package.json', { cwd: options.cwd || process.cwd() });
  if (!filePath) {
    return undefined;
  }
  return { packageJson: JSON.parse(readFileSync(filePath, 'utf-8')) as NormalizedPackageJson, path: filePath };
}
