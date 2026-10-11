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
    },
  },
});
