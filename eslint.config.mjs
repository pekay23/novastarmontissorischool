// ESLint flat config for Novastar Montessori School.
// Migrated from .eslintrc.json (legacy) to ESLint 10 + Next.js 16 flat config.
//
// Composition:
//   1. `eslint-config-next/core-web-vitals` — Next/React/Core-Web-Vitals rules
//   2. `eslint-config-next/typescript`     — @typescript-eslint/recommended
//   3. Project-specific rule overrides and ignore patterns

import { defineConfig, globalIgnores } from 'eslint/config'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

export default defineConfig([
  // ── Global ignores ─────────────────────────────────────────────────────────
  // ESLint flat config does NOT honour .gitignore, .eslintignore, or
  // `files:`-block rules that match outside their glob. Anything we want
  // hidden from the linter must be listed here.
  globalIgnores([
    // Next.js build output
    '.next/**',
    'apps/**/.next/**',
    'packages/**/.next/**',
    // Static export output
    'out/**',
    'apps/**/out/**',
    'packages/**/out/**',
    // Build output
    'dist/**',
    'apps/**/dist/**',
    'packages/**/dist/**',
    'next-env.d.ts',
    'apps/**/next-env.d.ts',
    // Vercel deployment helpers
    '.vercel/**',
    // Test / coverage artefacts
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    // Storybook
    'storybook-static/**',
    '.storybook/**',
    // Vendored / mirror content that is not authored source
    'supabase/**',
    'prisma/migrations/**',
    // Documentation site (compiled HTML, not source)
    'docs/html/**',
    // Editor / agent / IDE / VCS metadata
    '.git/**',
    '.github/**',
    '.husky/**',
    '.vscode/**',
    '.cursor/**',
    '.claude/**',
    '.claude-design/**',
    '.agents/**',
    '.kilo/**',
    '.codegraph/**',
    '.playwright-mcp/**',
    // Generated / throwaway directories
    'tmp/**',
    'scratch/**',
    'artifacts/**',
    'plans/**',
    'node_modules/**',
    // One-off ad-hoc scripts at the repo root — not part of the build or
    // any npm script; kept for history but should not gate CI lint.
    'fix.js',
    'migrate_enums.js',
    // One-off CommonJS ad-hoc utilities in scripts/ — use `require()` and
    // aren't referenced by any package.json script.
    'scripts/check-joyride-classes.cjs',
    'scripts/check-test-users.cjs',
    'scripts/_tmp_*.cjs',
    'scripts/debug.mjs',
    'scripts/debug2.mjs',
    'scripts/debug3.mjs',
    'scripts/fix_as_any.cjs',
    'scripts/fix_as_any.js',
    'scripts/migrate-prisma.js',
    'scripts/migrate-prisma-2.js',
    'scripts/replace.cjs',
    // Test files — use Vitest mocks with `any` for test isolation
    'tests/**',
  ]),

  // ── Next + Core Web Vitals + TypeScript ────────────────────────────────────
  // Both flat-config modules already include `files:` blocks, so the spread
  // here activates them on the project source roots via their own globs.
  ...nextCoreWebVitals,
  ...nextTypescript,

  // ── Project-specific overrides ─────────────────────────────────────────────
  {
    rules: {
      // Match the prior .eslintrc.json — these were warnings, not errors.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // The Next core-web-vitals config upgrades a few rules to errors; we
      // previously opted out of these because the codebase is mid-migration.
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',

      // The `next/typescript` config uses `recommended` which turns on
      // `no-unused-vars` (the non-TS one). Disable it because we use the
      // TypeScript version above, which has better project-aware behaviour.
      'no-unused-vars': 'off',
    },
  },

  // ── Non-Next workspaces ────────────────────────────────────────────────────
  // `next/no-html-link-for-pages` throws "Pages directory cannot be found" when
  // it runs somewhere without a pages/ or src/pages/ directory. That made
  // `eslint .` fail with exit 1 in every package under packages/ and tools/,
  // which in turn failed `bun run lint` for the whole repo. The rule only means
  // something inside a Next app, so it is switched off everywhere else.
  {
    files: ['packages/**/*.{ts,tsx}', 'tools/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx}', '*.ts'],
    rules: {
      'next/no-html-link-for-pages': 'off',
    },
  },
])