import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['guest-js/__tests__/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['guest-js/**/*.ts'],
      exclude: ['**/*.d.ts', 'guest-js/__tests__/**'],
      thresholds: {
        statements: 68,
        branches: 62,
        functions: 61,
        lines: 69,
      },
    },
  },
});
