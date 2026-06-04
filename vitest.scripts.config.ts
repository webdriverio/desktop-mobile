import { defineConfig } from 'vitest/config';

// Tests for repo tooling under scripts/ — run via `pnpm test:scripts` (wired into
// the unconditional lint CI job). Kept separate from vitest.config.ts, which is
// the shared base config that packages extend.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/scripts/**/*.spec.ts'],
  },
});
