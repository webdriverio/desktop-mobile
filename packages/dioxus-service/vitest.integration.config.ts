import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.spec.ts'],
    exclude: [...configDefaults.exclude],
    sequence: { concurrent: false },
    testTimeout: 30000,
    hookTimeout: 15000,
    teardownTimeout: 10000,
    fileParallelism: false,
    setupFiles: ['test/integration/setup.ts'],
  },
});
