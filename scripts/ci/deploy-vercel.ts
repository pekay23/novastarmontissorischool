/**
 * CI: deploy both apps to Vercel.
 *
 * Flow is pull -> build -> deploy --prebuilt for each app.
 *
 *   `vercel pull` fetches the project's environment variables from Vercel into
 *   .vercel/. That is why application secrets are NOT passed through CI: the
 *   portal's DATABASE_URL, NEXTAUTH_SECRET and NEXT_PUBLIC_ORIGIN live in the
 *   Vercel project settings and never appear in runner logs.
 *
 *   `vercel deploy --prebuilt` uploads the artifact this repo built instead of
 *   letting Vercel rebuild from source, so the thing that ships is the thing CI
 *   gated on.
 *
 * VERCEL_ORG_ID + VERCEL_PROJECT_ID_* target a project without a committed
 * .vercel/ directory, which is what makes this work from a clean checkout.
 *
 * Set VERCEL_TARGET=preview to deploy a preview instead of production.
 */

import { $ } from 'bun'
import { resolve } from 'node:path'
import { log, requireEnv } from './shared'

const step = 'ci:deploy-vercel'

const token = process.env.VERCEL_TOKEN
const orgId = process.env.VERCEL_ORG_ID

requireEnv('VERCEL_TOKEN', 'VERCEL_ORG_ID')

const target = process.env.VERCEL_TARGET ?? 'production'
const environment = target === 'production' ? 'production' : 'preview'
const repoRoot = resolve(import.meta.dir, '..', '..')

const apps = [
  { name: 'portal', dir: 'apps/portal', projectIdEnv: 'VERCEL_PROJECT_ID_PORTAL' },
  { name: 'public-site', dir: 'apps/public-site', projectIdEnv: 'VERCEL_PROJECT_ID_PUBLIC' },
] as const

for (const app of apps) {
  const projectId = process.env[app.projectIdEnv]
  requireEnv(app.projectIdEnv)

  const env = {
    VERCEL_TOKEN: token!,
    VERCEL_ORG_ID: orgId!,
    VERCEL_PROJECT_ID: projectId!,
  }

  // Run from the app directory so the CLI treats that app as the project root,
  // which is how a Vercel monorepo project is configured.
  const cwd = resolve(repoRoot, app.dir)

  log(step, `${app.name}: pulling project configuration (${environment})`)
  await $`bunx vercel@latest pull --yes --environment=${environment}`
    .cwd(cwd)
    .env(env)
    .quiet()

  log(step, `${app.name}: building`)
  await $`bunx vercel@latest build`.cwd(cwd).env(env).quiet()

  log(step, `${app.name}: deploying (${target})`)
  await $`bunx vercel@latest deploy --prebuilt --yes ${target === 'production' ? '--prod' : ''}`
    .cwd(cwd)
    .env(env)

  log(step, `${app.name}: deployed`)
}

log(step, 'All apps deployed')