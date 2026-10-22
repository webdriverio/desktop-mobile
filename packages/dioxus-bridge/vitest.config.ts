import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['guest-js/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['guest-js/**/*.ts'],
      exclude: ['guest-js/**/__tests__/**', 'guest-js/**/*.spec.ts'],
      thresholds: {
        statements: 52,
        branches: 64,
        functions: 38,
        lines: 54,
      },
    },
  },
});
