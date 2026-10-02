/**
 * Shared helpers for the CI entrypoints under scripts/ci/.
 *
 * These exist so the TeamCity build steps, GitHub Actions and a developer
 * machine all run byte-identical commands. A Windows TeamCity agent has no bash
 * by default, so the pipeline is expressed as Bun scripts rather than shell
 * one-liners.
 */

/** Consistent, greppable prefix so CI logs are readable. */
export function log(step: string, message: string): void {
  console.log(`\n[${step}] ${message}`)
}

/**
 * Fail immediately with the missing names, instead of letting an unset
 * DATABASE_URL surface 20 minutes later as a Prisma error inside a Docker
 * build.
 */
export function requireEnv(...names: string[]): void {
  const missing = names.filter((name) => !process.env[name])
  if (missing.length > 0) {
    console.error(`\nMissing required environment variable(s): ${missing.join(', ')}\n`)
    process.exit(1)
  }
}