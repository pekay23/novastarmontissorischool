import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ============================================================
  // RUNNER-COLLISION GUARD
  // Enforces the two-runner rule: bun:test side vs Playwright side
  // ============================================================

  // src/**, msw/** — must NOT import @playwright/test or bun:test
  // index.ts IS the bun:test-side barrel, so it CAN import bun:test
  {
    files: ['src/**/*.ts', 'msw/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@playwright/test', '@playwright/test/**'],
              message:
                'Playwright imports are forbidden in the bun:test side (src/**, msw/**). Use @novastar/testing/e2e for Playwright-side code.',
            },
            {
              group: ['bun:test'],
              message:
                'bun:test imports are forbidden in src/**, msw/**. This package is runner-agnostic; runner-specific helpers belong in index.ts (bun:test) or e2e.ts (Playwright).',
            },
          ],
        },
      ],
    },
  },

  // e2e.ts, e2e/** — must NOT import bun:test
  {
    files: ['e2e.ts', 'e2e/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['bun:test'],
              message:
                'bun:test imports are forbidden in the Playwright side (e2e.ts, e2e/**). Use @novastar/testing for runner-agnostic helpers.',
            },
          ],
        },
      ],
    },
  },

  // ============================================================
  // General TypeScript/ESLint config
  // ============================================================

  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // Ignore node_modules and any generated files
  {
    ignores: ['node_modules/**', 'dist/**', '*.config.*', '*.json'],
  }
)