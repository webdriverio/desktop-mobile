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

  it('should reject a directory that leaves the repo', () => {
    expect(() => cargoDirectories('updates:\n  - package-ecosystem: cargo\n    directories: ["/../outside"]')).toThrow(
      /Unexpected cargo directory/,
    );
  });

  it('should throw when no cargo directories are configured', () => {
    expect(() => cargoDirectories('updates:\n  - package-ecosystem: npm\n    directory: "/"')).toThrow(
      /no cargo directories/,
    );
  });

  it('should have a lockfile for every directory Dependabot watches', () => {
    const dirs = cargoDirectories(readFileSync(new URL('.github/dependabot.yml', root), 'utf8'));
    expect(dirs).toEqual(
      expect.arrayContaining([
        'packages/dioxus-bridge',
        'packages/dioxus-driver',
        'packages/dioxus-embedded-driver',
        'packages/dioxus-wdio',
        'fixtures/e2e-apps/dioxus',
        'fixtures/package-tests/dioxus-app',
      ]),
    );
    for (const dir of dirs) {
      expect(readFileSync(new URL(`${dir}/Cargo.lock`, root), 'utf8').length).toBeGreaterThan(0);
    }
  });
});

describe('update:dependencies', () => {
  it('should refresh cargo locks after the Tauri pin bump', () => {
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['update:cargo']).toBe('node ./scripts/update-cargo-locks.ts');
    expect(pkg.scripts['update:dependencies']).toMatch(/update:tauri && pnpm update:cargo$/);
  });
});
