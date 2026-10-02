/**
 * CI: build the two container images.
 *
 * Speed comes from two independent caches:
 *
 *   - Docker layer cache. The `deps` stage in each Dockerfile copies only
 *     package.json manifests before `bun install`, so editing a source file does
 *     not re-run the install. Layer reuse is what actually makes the second
 *     build fast.
 *
 * Build-time secrets
 * ------------------
 * The image is built with placeholder values for NEXTAUTH_SECRET and the
 * NEXT_PUBLIC_* origins, and never with values read from .env. Two reasons:
 *
 *   - Build args are not secret. They land in image metadata, so anyone who can
 *     pull the image or read `docker history` can read them. The real secret is
 *     supplied at runtime by the container environment.
 *   - Nothing at build time needs the real value. packages/database falls back
 *     to a mock Prisma client when DATABASE_URL is absent (it keys off
 *     NEXT_PHASE, which `next build` always sets), so the build needs no
 *     reachable database. The CI docker job already builds with a placeholder,
 *     so the local path matches what CI proves works.
 *
 * For the same reason the failure message below redacts build args instead of
 * echoing argv verbatim.
 *
 * Persistent cache export
 * -----------------------
 * `--cache-to type=local` is OFF by default. It sounds useful but is a poor fit
 * for a developer machine:
 *
 *   - `mode=max` exported every intermediate layer of the 342 MB portal image and
 *     took 29 minutes. `mode=min` is seconds, but on Docker Desktop both hit gRPC
 *     transport errors partway through ("error writing layer blob: ... EOF"),
 *     which fails the whole build even though the image itself was already
 *     written and is perfectly usable.
 *
 * Docker Desktop already keeps layer data between builds, so a local rebuild
 * gets the reuse it needs without the export. The place a persistent cache
 * actually pays off is a fresh CI runner, and the GitHub Actions docker job
 * covers that: it does not call this script, it drives buildx through
 * docker/build-push-action with `type=gha,mode=max`.
 *
 * Set DOCKER_CACHE_MODE=min or max to opt into the local export when you need to
 * prime a cache for a fresh daemon (for example before a demo on another
 * machine).
 *
 * Commands are run through spawnSync with an argument array rather than a shell
 * string. A multi-line `$` template literal is parsed with newlines as command
 * separators, so a wrapped command silently becomes several bogus commands --
 * and Bun 1.4's `$` rejects the array form outright.
 *
 * Set DOCKER_PUSH=true plus DOCKER_USERNAME / DOCKER_PASSWORD to publish.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { log } from './shared'

const step = 'ci:docker'
const repoRoot = resolve(import.meta.dir, '..', '..')

/** Build args whose values must never be echoed back in an error message. */
const secretArgs = new Set(['NEXTAUTH_SECRET'])

/** Render argv for an error message, with any secret value masked. */
function redacted(argv: string[]): string {
  return argv
    .map((part) => {
      const eq = part.indexOf('=')
      if (eq === -1 || !secretArgs.has(part.slice(0, eq))) {
        return part
      }
      return `${part.slice(0, eq + 1)}***`
    })
    .join(' ')
}

/** Run a command, streaming its output, and abort the build if it fails. */
function run(argv: string[], stdin?: string): void {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: repoRoot,
    stdio: stdin === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    input: stdin,
    // Docker writes progress to stderr; without this the build log is silent.
    env: { ...process.env, BUILDKIT_PROGRESS: 'plain' },
  })
  if (result.status !== 0) {
    console.error(`\nCommand failed with exit code ${result.status}: ${redacted(argv)}\n`)
    process.exit(result.status ?? 1)
  }
}

interface ImageSpec {
  name: string
  dockerfile: string
  args: Record<string, string>
}

const registry = process.env.DOCKER_REGISTRY ?? 'novastar'
const tag = process.env.DOCKER_TAG ?? 'local'
// Off by default; see the header for why. 'min' or 'max' opts in.
const cacheMode = process.env.DOCKER_CACHE_MODE

const images: ImageSpec[] = [
  {
    name: 'portal',
    dockerfile: 'Dockerfile',
    // Placeholders, deliberately not read from .env. See the header.
    args: {
      NEXTAUTH_SECRET: 'build-only-placeholder-not-a-real-secret',
      NEXTAUTH_URL: 'https://portal.example.com',
      NEXT_PUBLIC_ORIGIN: 'https://portal.example.com',
      NEXT_PUBLIC_DOMAIN: 'portal.example.com',
    },
  },
  {
    name: 'public-site',
    dockerfile: 'Dockerfile.public-site',
    args: {
      NEXT_PUBLIC_ORIGIN: 'https://example.com',
      NEXT_PUBLIC_DOMAIN: 'example.com',
    },
  },
]

for (const image of images) {
  const imageRef = `${registry}/novastar-${image.name}:${tag}`

  const argv = ['docker', 'buildx', 'build']

  if (cacheMode) {
    const cacheDir = resolve(repoRoot, '.docker-cache', image.name)
    // buildx writes to -new so an interrupted export cannot leave a
    // half-written cache that poisons every later build. These are sync fs
    // calls because Bun's node:fs `rm`/`rename` shims are callback-only and
    // reject the promise form.
    const incomingCache = `${cacheDir}-new`
    rmSync(incomingCache, { recursive: true, force: true })
    mkdirSync(cacheDir, { recursive: true })
    argv.push('--cache-from', `type=local,src=${cacheDir}`)
    argv.push('--cache-to', `type=local,dest=${incomingCache},mode=${cacheMode}`)
    // Hand the swap back to the loop below once the build has run.
    argv.push('--progress', 'plain')
  }

  argv.push('--file', resolve(repoRoot, image.dockerfile), '--tag', imageRef, '--load')
  for (const [key, value] of Object.entries(image.args)) {
    argv.push('--build-arg', `${key}=${value}`)
  }
  // The context must come last.
  argv.push(repoRoot)

  log(step, `Building ${imageRef} from ${image.dockerfile}`)
  run(argv)

  if (cacheMode) {
    const cacheDir = resolve(repoRoot, '.docker-cache', image.name)
    const incomingCache = `${cacheDir}-new`
    if (existsSync(incomingCache)) {
      rmSync(cacheDir, { recursive: true, force: true })
      renameSync(incomingCache, cacheDir)
    } else {
      log(step, `No cache was exported for ${image.name}; keeping the previous cache`)
    }
  }

  log(step, `Built ${imageRef}`)
}

if (process.env.DOCKER_PUSH === 'true') {
  if (!process.env.DOCKER_USERNAME || !process.env.DOCKER_PASSWORD) {
    console.error('\nDOCKER_PUSH=true but DOCKER_USERNAME / DOCKER_PASSWORD are not both set.\n')
    process.exit(1)
  }

  log(step, `Logging in to ${registry}`)
  run(
    ['docker', 'login', registry, '-u', process.env.DOCKER_USERNAME, '--password-stdin'],
    `${process.env.DOCKER_PASSWORD}\n`,
  )

  for (const image of images) {
    const imageRef = `${registry}/novastar-${image.name}:${tag}`
    log(step, `Pushing ${imageRef}`)
    run(['docker', 'push', imageRef])
  }
}

log(step, 'Done')