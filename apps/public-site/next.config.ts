import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // The `typescript` dependency is aliased to @typescript/typescript6, which ships
    // `lib/typescript.js` but no `typescript/bin/tsc`. Next's CLI mode (the 16.3 default)
    // hard-requires `typescript/bin/tsc` and otherwise tries to npm-install TypeScript,
    // which fails on this repo's `workspace:*` protocol. Use the TypeScript API instead.
    useTypeScriptCli: false,
  },
  allowedDevOrigins: [
    '192.168.8.202',
    '192.168.8.226',
    '172.25.96.1',
    '172.31.16.1',
  ],
  output: 'export',           // Static export for free hosting
  trailingSlash: true,
  images: {
    unoptimized: true,        // For static export
    /*
     * Remote hosts allowed to appear in `next/image`.
     *
     * `unoptimized: true` means no optimiser runs, so these URLs are served
     * straight to the browser — but the allow-list is still declared, because a
     * host missing from it is a blank `<img>` on a page that looks otherwise
     * finished, and `apps/public-site/tests/design-tokens.test.ts` asserts that
     * every remote host used in source is listed here.
     *
     * `images.unsplash.com` is listed at the owner's request for the real
     * photography pass. `*.wikimedia.org` is what the current placeholders
     * actually use — see `lib/placeholder-images.ts`, which explains why Unsplash
     * could not be reached and what to delete when the real photos land.
     */
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
      { protocol: 'https', hostname: 'thumb.wikimedia.org' },
    ],
    formats: ['image/avif', 'image/webp'],
    qualities: [75, 80, 90],
    minimumCacheTTL: 3600,
  },
  // typedRoutes moved to top-level in Next.js 15+
  typedRoutes: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  // Multi-tenant: generate static paths for each tenant
  // For first school, Novastar only
}

export default nextConfig