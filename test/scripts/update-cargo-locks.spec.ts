import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cargoDirectories } from '../../scripts/update-cargo-locks.ts';

const root = new URL('../../', import.meta.url);

describe('cargoDirectories', () => {
  it('should read the cargo ecosystem only', () => {
    const yaml = `
updates:
  - package-ecosystem: npm
    directory: "/"
    directories:
      - "/not-cargo"
  - package-ecosystem: cargo
    directories:
      - "/packages/dioxus-bridge"
      - "/fixtures/e2e-apps/dioxus"
`;
    expect(cargoDirectories(yaml)).toEqual(['packages/dioxus-bridge', 'fixtures/e2e-apps/dioxus']);
  });

  it('should throw when no cargo directories are configured', () => {
    expect(() => cargoDirectories('updates:\n  - package-ecosystem: npm\n    directory: "/"')).toThrow(
      /no cargo directories/,
    );
  });

  it('should have a lockfile for every directory Dependabot watches', () => {
    for (const dir of cargoDirectories(readFileSync(new URL('.github/dependabot.yml', root), 'utf8'))) {
      expect(readFileSync(new URL(`${dir}/Cargo.lock`, root), 'utf8').length).toBeGreaterThan(0);
    }
  });
});
