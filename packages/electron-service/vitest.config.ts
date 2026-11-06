import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Required for global test functions (describe, it, expect)
    globals: true,
    // The service runs in Node, so no test needs a DOM; a jsdom per test file costs more than the tests do
    environment: 'node',
    // Custom test setup for matchers and configuration
    setupFiles: ['test/setup.ts'],
    // Test file discovery patterns
    include: ['test/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, 'example*/**/*', 'test/integration/**'],
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*'],
      exclude: ['src/cjs/*.ts', 'src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
