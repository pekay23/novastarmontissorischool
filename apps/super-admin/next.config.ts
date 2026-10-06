import fs from 'node:fs'
import path from 'node:path'
import type { NextConfig } from 'next'

/**
 * Load the monorepo-root env files into process.env before Next boots.
 *
 * Copied from `apps/portal/next.config.ts` because neither Turborepo nor Next
 * loads a root `.env` for a nested app:
 *
 * - Turborepo only hashes `.env*` through `globalDependencies`; it never loads
 *   them into a task's runtime.
 * - Next.js only auto-loads `.env*` from the directory holding this config.
 *
 * Without this, `next build` and `next start` from inside apps/super-admin start
 * with no `PLATFORM_SESSION_SECRET` and no database URL, which surfaces as an
 * unconfigured dashboard rather than as a missing-variable error: every route
 * denies, because the operator check is deny-by-default.
 *
 * Precedence (highest first): real environment > .env.local > .env. Values
 * already present in process.env are never overwritten.
 */
const appDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd()
const repoRoot = path.resolve(appDir, '..', '..')

// dotenv's line grammar: optional `export`, then a single-quoted, double-quoted
// or bare value, then an optional `#` comment. The root env files hold no
// multiline values, so those are not handled here.
const ENV_LINE = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^#\r\n]*?))\s*(?:#.*)?$/

function loadRootEnv(): void {
  const merged = new Map<string, string>()

  for (const file of ['.env', '.env.local']) {
    const filePath = path.join(repoRoot, file)
    if (!fs.existsSync(filePath)) continue

    for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const match = ENV_LINE.exec(rawLine)
      if (!match) continue
      const [, key, singleQuoted, doubleQuoted, bare] = match
      merged.set(
        key,
        doubleQuoted !== undefined
          ? doubleQuoted.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
          : (singleQuoted ?? bare ?? '').trim(),
      )
    }
  }

  for (const [key, value] of merged) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  if (process.env.NODE_ENV !== 'production') {
    // Session signing only. There is no operator allowlist any more — operator
    // accounts live in the database and are created by the CLI — so this is the one
    // variable whose absence makes every sign-in fail and every session unverifiable.
    // Warn-only and never fatal, because a build in an environment that does not
    // serve this app must not be blocked by a variable it does not use; the runtime
    // refusal is deny-by-default on its own.
    const required = ['PLATFORM_SESSION_SECRET']
    const missing = required.filter((key) => !process.env[key])
    if (missing.length > 0) {
      console.warn(
        `[next.config] Missing env vars for super-admin: ${missing.join(', ')}. ` +
          'No operator session can be signed or verified while these are unset, so ' +
          'the console will render only its login page.',
      )
    }
  }
}

loadRootEnv()

const nextConfig: NextConfig = {
  // Mounted under /admin on the single nms domain (see root `vercel.json`).
  // Next strips this prefix before the request reaches the app, so the login
  // page, the tenant routes and the dashboard all stay relative — `/login`,
  // `/api/tenants`, `/api/health` — exactly as written. The console's own
  // session cookie is scoped to its own path regardless, so it never collides
  // with a portal session on the shared origin.
  //
  // Dev runs bare on localhost:3200 with no prefix, which is what the routes
  // assume. Do not derive this from env.
  basePath: '/admin',
  allowedDevOrigins: [
    '192.168.8.202',
    '192.168.8.226',
    '172.25.96.1',
    '172.31.16.1',
  ],
  experimental: {
    webpackBuildWorker: true,
    // The `typescript` dependency is aliased to @typescript/typescript6, which ships
    // `lib/typescript.js` but no `typescript/bin/tsc`. Next's CLI mode (the 16.3 default)
    // hard-requires `typescript/bin/tsc` and otherwise tries to npm-install TypeScript,
    // which fails on this repo's `workspace:*` protocol. Use the TypeScript API instead.
    useTypeScriptCli: false,
  },
  // Workspace packages are consumed as TypeScript source (ADR-016): each one's
  // `main` is its `index.ts`. Bun symlinks them into node_modules, and Next
  // follows the symlink to a real path outside node_modules and transpiles it,
  // but naming them here makes that a stated contract rather than a side effect
  // of the package manager's layout.
  transpilePackages: [
    '@novastar/auth',
    '@novastar/database',
    '@novastar/shared-types',
    '@novastar/shared-ui',
    '@novastar/shared-utils',
    '@novastar/tenant-cli',
  ],
  // Docker-targeted, self-hosted Node server. NOT `export`: the dashboard is
  // session-bearing and reads a live database, so there is nothing to prerender.
  output: 'standalone',
  // Trace from the workspace root so standalone output keeps the monorepo
  // layout and the workspace packages it links to.
  outputFileTracingRoot: repoRoot,
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    const isProd = process.env.NODE_ENV === 'production'
    const isDev = !isProd

    // Production CSP: strict, nonce-based - no unsafe-inline/unsafe-eval.
    // Development CSP: permissive to allow HMR and local tooling.
    // Adopted from Aerojet Academy's production CSP hardening (ADR-022), matching
    // apps/portal. The dashboard loads no third-party script and no upload UI, so
    // its production allowlist is strictly narrower than the portal's.
    const csp = isDev
      ? [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'blob:' https:",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' blob: data: https:",
          "font-src 'self' https: data:",
          "connect-src 'self' https:",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ')
      : [
          "default-src 'self'",
          "script-src 'self' 'blob:'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' blob: data:",
          "font-src 'self' https: data:",
          "connect-src 'self'",
          "frame-src 'none'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "object-src 'none'",
          'upgrade-insecure-requests',
        ].join('; ')

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      {
        // Same-origin only, and credentials disallowed. The dashboard has no
        // cross-origin callers: an API route that answered a foreign origin
        // with `Access-Control-Allow-Credentials: true` would let a page the
        // operator visits read every tenant's data through their cookie.
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: "'none'" },
          { key: 'Access-Control-Allow-Credentials', value: 'false' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
          { key: 'Vary', value: 'Origin' },
        ],
      },
      {
        // A session-bearing control plane must never sit in a shared cache.
        source: '/(tenants|health|audit|login)',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
      },
    ]
  },
}

export default nextConfig
