/**
 * Local setup check.
 *
 * Verifies the machine can actually run this repo's pipeline, and generates the
 * one secret that can be generated locally (NEXTAUTH_SECRET). Everything else
 * has to come from a provider, so the script prints exactly what is missing and
 * where to get it rather than pretending to know.
 *
 *   bun run setup
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const repoRoot = resolve(import.meta.dir, '..')
const envLocalPath = resolve(repoRoot, '.env.local')
const envPath = resolve(repoRoot, '.env')

const ok = (m: string) => console.log(`  \x1b[32mok\x1b[0m    ${m}`)
const warn = (m: string) => console.log(`  \x1b[33mwarn\x1b[0m  ${m}`)
const bad = (m: string) => console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`)

function commandExists(cmd: string): boolean {
  const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' })
  return probe.status === 0
}

/**
 * Merge .env and .env.local the same way apps/portal/next.config.ts does:
 * .env first, then .env.local overriding it. Checking only one of the two
 * reports false gaps for a config that is actually complete.
 */
function readEnvFiles(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const path of [envPath, envLocalPath]) {
    if (!existsSync(path)) continue
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/.exec(raw)
      if (!m) continue
      out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  return out
}

console.log('\n== Toolchain ==')
if (commandExists('bun')) ok('bun')
else bad('bun not found - install from https://bun.sh')
if (commandExists('git')) ok('git')
else bad('git not found')

// The Docker daemon is the one thing that can be installed and still be down.
const dockerProbe = spawnSync('docker', ['info'], { stdio: 'ignore', shell: process.platform === 'win32' })
if (dockerProbe.status === 0) {
  ok('docker daemon reachable')
} else {
  warn('docker daemon not reachable - start Docker Desktop (needed for ci:docker and Deploy (Docker Compose))')
}

console.log('\n== Environment ==')
const env = readEnvFiles()
if (!existsSync(envPath) && !existsSync(envLocalPath)) {
  bad('neither .env nor .env.local exists - copy .env.example to .env.local')
} else {
  ok(`read from ${[existsSync(envPath) && '.env', existsSync(envLocalPath) && '.env.local'].filter(Boolean).join(' + ')}`)
}

// NEXTAUTH_SECRET is the only secret that is purely local, so generate it.
// .env.local is gitignored, so writing here cannot leak into the repository.
if (!env.NEXTAUTH_SECRET) {
  const generated = randomBytes(32).toString('base64')
  const target = existsSync(envLocalPath) ? envLocalPath : envPath
  appendFileSync(
    target,
    `${existsSync(target) && !readFileSync(target, 'utf8').endsWith('\n') ? '\n' : ''}NEXTAUTH_SECRET="${generated}"\n`,
  )
  ok(`generated NEXTAUTH_SECRET into ${target.replace(repoRoot, '.')}`)
} else if (env.NEXTAUTH_SECRET.length < 32) {
  bad(`NEXTAUTH_SECRET is only ${env.NEXTAUTH_SECRET.length} chars; NextAuth wants 32+`)
} else {
  ok('NEXTAUTH_SECRET set')
}

const required = ['DATABASE_URL', 'NEXTAUTH_URL', 'NEXT_PUBLIC_ORIGIN']
for (const name of required) {
  if (!env[name]) bad(`${name} not set`)
  else ok(`${name} set`)
}

// The Prisma adapter is @prisma/adapter-neon, which speaks SQL-over-HTTP. A
// local postgres container cannot answer that, so a localhost DATABASE_URL is
// almost always a mistake rather than a working config.
const db = env.DATABASE_URL ?? ''
if (db.startsWith('postgresql://') && /@(localhost|127\.0\.0\.1)/.test(db)) {
  warn('DATABASE_URL points at localhost. packages/database uses @prisma/adapter-neon (SQL-over-HTTP), so a local postgres container will NOT work. Point this at Neon.')
} else if (db) {
  ok('DATABASE_URL looks like a remote database')
}

// Optional integrations degrade rather than fail.
if (!env.UPSTASH_REDIS_REST_URL) {
  warn('UPSTASH_REDIS_REST_URL not set - rate limiting falls back to an in-process Map (fine for dev, not for multi-instance)')
} else {
  ok('UPSTASH_REDIS_REST_URL set')
}

console.log('\n== Pipeline commands ==')
const scripts: Record<string, string> = {
  'ci:install': 'install deps + generate Prisma client',
  'ci:verify': 'lint + typecheck + unit tests',
  'ci:e2e': 'Playwright (chromium, firefox, webkit)',
  'ci:docker': 'build both images with layer caching',
  'ci:deploy': 'Vercel pull/build/deploy (needs VERCEL_*)',
}
const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
for (const [name, desc] of Object.entries(scripts)) {
  if (pkg.scripts[name]) ok(`${name.padEnd(11)} ${desc}`)
  else bad(`${name} is not defined in package.json`)
}

console.log('\n== Secrets you must supply yourself ==')
console.log('  These cannot be generated locally. Where each one goes:\n')
console.log('  GitHub Actions (repo -> Settings -> Secrets and variables -> Actions)')
console.log('    VERCEL_TOKEN              Vercel -> Account Settings -> Tokens')
console.log('    VERCEL_ORG_ID             Vercel -> your team -> Settings -> General')
console.log('    VERCEL_PROJECT_ID_PORTAL  Vercel -> portal project -> Settings -> General')
console.log('    VERCEL_PROJECT_ID_PUBLIC  Vercel -> public-site project -> Settings -> General')
console.log('    TURBO_TOKEN, TURBO_TEAM   Vercel -> Account Settings -> Tokens -> Turbo')
console.log('    DOCKER_USERNAME, DOCKER_PASSWORD  GitHub PAT with packages:write')
console.log('  repository variables (non-secret)')
console.log('    VERCEL_DEPLOY_ENABLED     set to true to turn the deploy job on')
console.log('    DOCKER_BUILD_ENABLED      set to true to turn the image build on')
console.log('  Vercel project settings (preferred over GitHub secrets)')
console.log('    DATABASE_URL, DIRECT_URL, NEXTAUTH_SECRET, NEXTAUTH_URL,')
console.log('    NEXT_PUBLIC_ORIGIN, NEXT_PUBLIC_DOMAIN, RESEND_API_KEY,')
console.log('    UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, ...')
console.log('    `vercel pull` reads these, so they never enter CI logs.')
console.log('\n  TeamCity (Administration -> Project -> Parameters) - same list,')
console.log('  everything secret marked as a password parameter.\n')

console.log('Next:')
console.log('  bun run ci:install && bun run ci:verify')
console.log('  docker compose up -d --wait')
console.log('  portal     http://localhost:3000')
console.log('  public site http://localhost:8080\n')