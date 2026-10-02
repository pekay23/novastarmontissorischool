/**
 * CI: build the two container images.
 *
 * Speed comes from two independent caches:
 *
 *   - Docker layer cache. The `deps` stage in each Dockerfile copies only
 *     package.json manifests before running `bun install`, so editing a source
 *     file does not re-run the install. Layer reuse is what actually makes the
 *     second build fast.
 *   - BuildKit cache export. `--cache-to type=local` writes the layer metadata
 *     to .docker-cache/<image> so a cold daemon (fresh CI runner) still gets a
 *     warm cache. .dockerignore excludes .docker-cache, so the cache directory
 *     is never copied back into the build context.
 *
 * Set DOCKER_PUSH=true plus DOCKER_USERNAME / DOCKER_PASSWORD to publish.
 */

import { $ } from 'bun'
import { existsSync, mkdirSync, rename, rm } from 'node:fs'
import { resolve } from 'node:path'
import { log } from './shared'

const step = 'ci:docker'
const repoRoot = resolve(import.meta.dir, '..', '..')

interface ImageSpec {
  name: string
  dockerfile: string
  args: Record<string, string>
}

const registry = process.env.DOCKER_REGISTRY ?? 'novastar'
const tag = process.env.DOCKER_TAG ?? 'local'

const images: ImageSpec[] = [
  {
    name: 'portal',
    dockerfile: 'Dockerfile',
    args: {
      // A build-time placeholder is sufficient: packages/database falls back to
      // a mock Prisma client when DATABASE_URL is absent (it keys off
      // NEXT_PHASE, which `next build` always sets), so the build needs no
      // reachable database.
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? 'build-only-placeholder-not-a-real-secret',
      NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? 'http://localhost:3000',
      NEXT_PUBLIC_ORIGIN: process.env.NEXT_PUBLIC_ORIGIN ?? 'http://localhost:3000',
      NEXT_PUBLIC_DOMAIN: process.env.NEXT_PUBLIC_DOMAIN ?? 'localhost:3000',
    },
  },
  {
    name: 'public-site',
    dockerfile: 'Dockerfile.public-site',
    args: {
      NEXT_PUBLIC_ORIGIN: process.env.NEXT_PUBLIC_ORIGIN ?? 'http://localhost:8080',
      NEXT_PUBLIC_DOMAIN: process.env.NEXT_PUBLIC_DOMAIN ?? 'localhost:8080',
    },
  },
]

for (const image of images) {
  const cacheDir = resolve(repoRoot, '.docker-cache', image.name)
  mkdirSync(cacheDir, { recursive: true })

  const imageRef = `${registry}/novastar-${image.name}:${tag}`
  log(step, `Building ${imageRef} from ${image.dockerfile}`)

  const argFlags = Object.entries(image.args).flatMap(([key, value]) => ['--build-arg', `${key}=${value}`])
  // Swap in a rename so an interrupted build cannot leave a corrupt cache that
  // fails every subsequent build.
  await $`docker buildx build ${argFlags}
      --cache-from type=local,src=${cacheDir}
      --cache-to type=local,dest=${cacheDir}-new,mode=max
      --file ${image.dockerfile}
      --tag ${imageRef}
      --load
      ${repoRoot}`.quiet()

  const previous = `${cacheDir}-new`
  if (existsSync(previous)) {
    // Swap atomically-ish: buildx writes to -new so an interrupted build cannot
    // leave a half-written cache that poisons every later build.
    await rm(cacheDir, { recursive: true, force: true })
    await rename(previous, cacheDir)
  }

  log(step, `Built ${imageRef}`)
}

if (process.env.DOCKER_PUSH === 'true') {
  if (!process.env.DOCKER_USERNAME || !process.env.DOCKER_PASSWORD) {
    console.error(`\nDOCKER_PUSH=true but DOCKER_USERNAME / DOCKER_PASSWORD are not both set.\n`)
    process.exit(1)
  }
  log(step, `Logging in to ${registry}`)
  await $`echo ${process.env.DOCKER_PASSWORD} | docker login ${registry} -u ${process.env.DOCKER_USERNAME} --password-stdin`.quiet()

  for (const image of images) {
    log(step, `Pushing ${registry}/novastar-${image.name}:${tag}`)
    await $`docker push ${registry}/novastar-${image.name}:${tag}`.quiet()
  }
}

log(step, 'Done')