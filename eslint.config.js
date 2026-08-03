import tsParser from '@typescript-eslint/parser';
import vitest from '@vitest/eslint-plugin';
import * as wdio from 'eslint-plugin-wdio';

export default [
  // Ignored dirs
  {
    ignores: ['**/dist/**/*', '**/coverage/**/*', '**/out/**/*', '**/.turbo/**/*', '.claude/**/*'],
  },
  // E2E test files - WebdriverIO specific rules
  {
    files: ['e2e/**/*.spec.ts', 'e2e/**/*.test.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        project: './tsconfig.base.json',
      },
      globals: {
        ...wdio.configs['flat/recommended'].globals,
      },
    },
    plugins: {
      wdio,
    },
    rules: {
      ...wdio.configs['flat/recommended'].rules,
    },
  },
  // Package test files - Vitest specific rules
  {
    files: ['packages/**/test/**/*.spec.ts', 'packages/**/test/**/*.test.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        project: './tsconfig.base.json',
      },
    },
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,
      // Disabled due to poor implementation
      'vitest/prefer-called-exactly-once-with': 'off',
    },
  },
];
