import fs from 'node:fs'
import path from 'node:path'
import type { NextConfig } from 'next'

/**
 * One app, three sections (see ADR-024):
 *
 *   /            the marketing site   (app/(public), purple brand)
 *   /portal/*    the tenant portal    (app/portal, emerald brand)
 *   /admin/*     the operator console (app/admin, navy brand)
 *
 * The portal and the console used to be separate apps with
 * `basePath` set here. They are physical route directories now, so
 * no `basePath` remains — `/portal/dashboard` really is
 * `app/portal/(portal)/dashboard`.
 *
 * Load the monorepo-root env files into process.env before Next
 * boots. This repo keeps a single set of env files at the root
 * (`.env`, `.env.local`, both gitignored). Neither tool that could
 * load them for us does:
 *
 * - Turborepo only hashes `.env*` through `globalDependencies`; it
 *   never loads them into a task's runtime.
 * - Next.js only auto-loads `.env*` from the directory holding this
 *   config, and exposes no option to point it elsewhere.
 *
 * Without this, `next dev`/`next build` would start with no
 * DATABASE_URL / NEXTAUTH_SECRET / PLATFORM_SESSION_SECRET — which
 * surfaces as NextAuth `NO_SECRET` errors, Prisma connection
 * failures, and a console that denies every route.
 *
 * Precedence (highest first): real environment > .env.local > .env.
 * Values already present in process.env are never overwritten.
 */
const appDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd()
const repoRoot = path.resolve(appDir, '..', '..')

// dotenv's line grammar: optional `export`, then a single-quoted,
// double-quoted or bare value, then an optional `#` comment. The
// root env files hold no multiline values, so those are not handled
// here.
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
    // The portal's signing trio and the console's session secret.
    // Warn-only and never fatal: this one build serves all three
    // sections, and an environment that only renders the marketing
    // pages must not be blocked by variables it does not use. The
    // runtime refusal (the proxy's deny-by-default, the console's
    // unconfigured state) is what actually gates access.
    const required = [
      'DATABASE_URL',
      'NEXTAUTH_SECRET',
      'NEXTAUTH_URL',
      'PLATFORM_SESSION_SECRET',
    ]
    const missing = required.filter((key) => !process.env[key])
    if (missing.length > 0) {
      console.warn(
        `[next.config] Missing env vars: ${missing.join(', ')}. ` +
          'The portal and the console will render only their sign-in ' +
          'pages while these are unset.',
      )
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
  experimental: {
    webpackBuildWorker: true,
    // The `typescript` dependency is aliased to @typescript/typescript6,
    // which ships `lib/typescript.js` but no `typescript/bin/tsc`. Next's
    // CLI mode (the 16.3 default) hard-requires `typescript/bin/tsc` and
    // otherwise tries to npm-install TypeScript, which fails on this
    // repo's `workspace:*` protocol. Use the TypeScript API instead.
    useTypeScriptCli: false,
    serverActions: {
      bodySizeLimit: '4mb',
      allowedOrigins: [
        'localhost:3000',
        ...(process.env.EXTRA_ALLOWED_ORIGINS?.split(',').filter(Boolean) || []),
      ],
    },
  },
  // Workspace packages are consumed as TypeScript source (ADR-016):
  // each one's `main` is its `index.ts`. Bun symlinks them into
  // node_modules, and Next follows the symlink to a real path outside
  // node_modules and transpiles it, but naming them here makes that a
  // stated contract rather than a side effect of the package manager's
  // layout.
  transpilePackages: [
    '@novastar/auth',
    '@novastar/database',
    '@novastar/shared-types',
    '@novastar/shared-ui',
    '@novastar/shared-utils',
    '@novastar/tenant-cli',
  ],
  images: {
    // All three predecessor apps ran unoptimized; the marketing site
    // because it is statically exported, the portal and the console
    // because their images are user uploads served from their own
    // storage. One app keeps that posture.
    unoptimized: true,
    remotePatterns: [
      // Marketing photography (public site)
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
      { protocol: 'https', hostname: 'thumb.wikimedia.org' },
      // Portal file storage (UploadThing / Fly)
      { protocol: 'https', hostname: 'utfs.io' },
      { protocol: 'https', hostname: 'uploadthing.com' },
      { protocol: 'https', hostname: '*.ufs.sh' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      // Portal avatars (generated initials)
      { protocol: 'https', hostname: 'api.dicebear.com' },
    ],
    localPatterns: [
      { pathname: '/images/**' },
      { pathname: '/logo.svg' },
      { pathname: '/favicon.ico' },
    ],
  },
  typedRoutes: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  // Trace from the workspace root so a standalone build keeps the
  // monorepo layout and the workspace packages it links to. Inert
  // unless `output: 'standalone'` is set (Docker parity).
  outputFileTracingRoot: repoRoot,
  async headers() {
    const isProd = process.env.NODE_ENV === 'production'

    /*
     * Base headers for every page of every section. The marketing
     * site shipped without any of these; the portal and the console
     * shipped all of them. They are all safe on a marketing page
     * (none restricts loading), so the whole domain gets them.
     *
     * Content-Security-Policy is deliberately NOT here: the three
     * sections have three different allowlists, and a CSP that is
     * right for one section breaks another. Each section sets its
     * own below, and the marketing pages keep their current posture
     * (no CSP) rather than risking a broken live site.
     */
    const baseHeaders = [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'origin-when-cross-origin' },
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains; preload',
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), payment=(self)',
      },
    ]

    // Production CSP: strict, allowlist-based — no unsafe-inline for
    // scripts beyond what the third-party integrations require.
    // Development CSP: permissive to allow HMR and local tooling.
    // Adopted from Aerojet Academy's production CSP hardening
    // (ADR-022), from apps/portal.
    const portalCsp = isProd
      ? [
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
      : [
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

    // The console loads no third-party script and no upload UI, so
    // its production allowlist is strictly narrower than the
    // portal's. From apps/super-admin.
    const adminCsp = isProd
      ? [
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
      : [
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

    // CORS: lock the portal's API origin to NEXT_PUBLIC_ORIGIN in
    // production; allow same-origin in dev. From apps/portal.
    const allowedOrigin = isProd
      ? process.env.NEXT_PUBLIC_ORIGIN || ''
      : process.env.NEXT_PUBLIC_ORIGIN || '*'

    const portalCorsHeaders = [
      { key: 'Access-Control-Allow-Origin', value: allowedOrigin },
      { key: 'Access-Control-Allow-Credentials', value: 'true' },
      { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' },
      { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
    ]

    return [
      {
        source: '/(.*)',
        headers: baseHeaders,
      },
      {
        // Portal pages and portal API.
        source: '/portal/:path*',
        headers: [{ key: 'Content-Security-Policy', value: portalCsp }],
      },
      {
        source: '/portal/api/:path*',
        headers: portalCorsHeaders,
      },
      {
        // Console pages and console API. Same-origin only, and
        // credentials disallowed: the dashboard has no cross-origin
        // callers, and an API route that answered a foreign origin
        // with `Access-Control-Allow-Credentials: true` would let a
        // page the operator visits read every tenant's data through
        // their cookie. From apps/super-admin.
        source: '/admin/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: adminCsp },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      {
        source: '/admin/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: "'none'" },
          { key: 'Access-Control-Allow-Credentials', value: 'false' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
          { key: 'Vary', value: 'Origin' },
        ],
      },
      {
        // A session-bearing control plane must never sit in a shared
        // cache. The source patterns are the console's sections,
        // prefixed the way the routes are now.
        source: '/admin/(tenants|health|audit|login)/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
      },
      {
        // The portal's service worker must never be cached.
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
