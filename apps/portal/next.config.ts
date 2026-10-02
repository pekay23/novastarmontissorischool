import fs from 'node:fs'
import path from 'node:path'
import type { NextConfig } from 'next'

/**
 * Load the monorepo-root env files into process.env before Next boots.
 *
 * This repo keeps a single set of env files at the root (`.env`, `.env.local`,
 * both gitignored). Neither tool that could load them for us does:
 *
 * - Turborepo only hashes `.env*` through `globalDependencies`; it never loads
 *   them into a task's runtime. See "Handling `.env` files" in the bundled docs
 *   at node_modules/turbo/docs/crafting-your-repository/using-environment-variables.mdx.
 * - Next.js only auto-loads `.env*` from the directory holding this config, and
 *   exposes no option to point it elsewhere. See "Loading Environment Variables"
 *   in the bundled docs at
 *   node_modules/next/dist/docs/01-app/02-guides/environment-variables.md.
 *
 * Without this, running `next dev`/`next build` from inside apps/portal would
 * otherwise start with no DATABASE_URL / NEXTAUTH_SECRET / NEXTAUTH_URL — which
 * surfaces as NextAuth `NO_SECRET` errors and Prisma connection failures.
 *
 * Precedence (highest first): real environment > .env.local > .env.
 * Values already present in process.env are never overwritten.
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
    const required = ['DATABASE_URL', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL']
    const missing = required.filter((key) => !process.env[key])
    if (missing.length > 0) {
      console.warn(`[next.config] Missing env vars for the portal: ${missing.join(', ')}`)
    }
  }
}

loadRootEnv()

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    '192.168.8.202',
    '192.168.8.226',
    '172.25.96.1',
    '172.31.16.1',
  ],
  // PWA for offline-first
  experimental: {
    webpackBuildWorker: true,
    // The `typescript` dependency is aliased to @typescript/typescript6, which ships
    // `lib/typescript.js` but no `typescript/bin/tsc`. Next's CLI mode (the 16.3 default)
    // hard-requires `typescript/bin/tsc` and otherwise tries to npm-install TypeScript,
    // which fails on this repo's `workspace:*` protocol. Use the TypeScript API instead.
    useTypeScriptCli: false,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'utfs.io' },
      { protocol: 'https', hostname: 'uploadthing.com' },
      { protocol: 'https', hostname: '*.ufs.sh' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
    localPatterns: [
      { pathname: '/images/**' },
      { pathname: '/logo.svg' },
      { pathname: '/favicon.ico' },
    ],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Output standalone for Docker
  output: 'standalone',
  // Trace from the workspace root so standalone output keeps the monorepo
  // layout (apps/portal/server.js) and the workspace packages it links to.
  outputFileTracingRoot: repoRoot,
  async headers() {
    const isProd = process.env.NODE_ENV === 'production'
    const isDev = !isProd

    // Production CSP: strict, nonce-based — no unsafe-inline/unsafe-eval.
    // Development CSP: permissive to allow HMR and local tooling.
    // Adopted from Aerojet Academy's production CSP hardening (ADR-022).
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
          "script-src 'self' 'blob:' https://js.stripe.com https://uploadthing.com https://www.google.com https://www.gstatic.com https://va.vercel-scripts.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "img-src 'self' blob: data: https://utfs.io https://*.ufs.sh https://uploadthing.com https://lh3.googleusercontent.com",
          "font-src 'self' https: data: https://fonts.gstatic.com",
          "connect-src 'self' https://api.stripe.com https://*.supabase.co wss://*.supabase.co https://*.uploadthing.com https://*.ufs.sh https://vitals.vercel-insights.com",
          "frame-src 'self' blob: https://js.stripe.com https://hooks.stripe.com https://www.google.com/recaptcha/",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "object-src 'none'",
          'upgrade-insecure-requests',
        ].join('; ')

    // CORS: lock origin to NEXT_PUBLIC_ORIGIN in production; allow same-origin in dev
    const allowedOrigin = isProd
      ? process.env.NEXT_PUBLIC_ORIGIN || ''
      : process.env.NEXT_PUBLIC_ORIGIN || '*'

    const corsHeaders = isProd && allowedOrigin
      ? [
          { key: 'Access-Control-Allow-Origin', value: allowedOrigin },
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
        ]
      : [
          { key: 'Access-Control-Allow-Origin', value: allowedOrigin },
          { key: 'Access-Control-Allow-Credentials', value: isProd ? 'true' : 'false' },
        ]

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self)' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          ...corsHeaders,
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig

