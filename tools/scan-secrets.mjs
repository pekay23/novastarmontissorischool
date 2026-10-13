#!/usr/bin/env node
/**
 * Pre-commit secret scanner.
 *
 * Walks the git-tracked file list (so ignored files such as `.env` are never
 * read) and fails on the shapes that are credentials in this project:
 *
 *   - AWS access key ids (AKIA…) and PEM private keys;
 *   - assignments to the named secret variables with a value long enough to be
 *     real, rather than a placeholder;
 *   - a password embedded in a PostgreSQL connection URL.
 *
 * Placeholders do not fail: `example`, `changeme`, `your-…`, `<…>`, `xxx…`,
 * `***`, and the literal words `example`/`placeholder`/`redacted` anywhere in
 * the value. `.env.example` therefore passes by construction — its values are
 * the placeholder kind.
 *
 * Usage: node tools/scan-secrets.mjs           (exit 1 on findings)
 *        node tools/scan-secrets.mjs --staged  (scan the index instead of HEAD)
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const staged = process.argv.includes('--staged')

function trackedFiles() {
  if (staged) {
    // Porcelain rather than `diff --cached`: intent-to-add files (`git add -N`,
    // which is what `git commit` materialises for new files in some flows) never
    // appear in the diff but do show as ` A` here.
    const out = execFileSync('git', ['status', '--porcelain', '-z'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    const files = []
    for (const entry of out.split('\0')) {
      if (entry.length < 4) continue
      const index = entry[0]
      const worktree = entry[1]
      const path = entry.slice(3).replace(/^"(.*)"$/, '$1')
      if (index !== ' ' && index !== '?' && index !== '!') files.push(path)
      else if (worktree === 'A') files.push(path)
    }
    return files
  }
  return execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

const SECRET_NAMES = [
  'NEXTAUTH_SECRET',
  'PLATFORM_SESSION_SECRET',
  'ENCRYPTION_KEY',
  'RESEND_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'UPSTASH_REDIS_REST_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'MTN_API_KEY',
  'MTN_SUBSCRIPTION_KEY',
  'SYNC_API_TOKEN',
  'PLATFORM_OPERATOR_PASSWORD',
  'DATABASE_URL',
]

const PLACEHOLDER = /example|changeme|placeholder|redacted|your[-_]|xxxx|\*\*\*|<[^>]*>|^\s*$|^\$\(|^process\.env|^env\./i
const MIN_SECRET_LENGTH = 20

/** Test fixtures are canaries by design; they look live and are not. */
const isTestFile = (file) =>
  /(^|\/)(tests?|__tests__|fixtures?)\//i.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(file)

/** The password segment of a connection URL, for placeholder judgement. */
function urlPassword(line) {
  const match = line.match(/postgres(?:ql)?:\/\/[^:\s/@]+:([^@\s/]+)@/)
  return match?.[1]
}

const isPlaceholderUrl = (line) => {
  const password = urlPassword(line)
  if (!password) return false
  return (
    PLACEHOLDER.test(password) ||
    /^(password|pass|secret|pw|pwd)$/i.test(password) ||
    /@(localhost|127\.0\.0\.1|host|db|postgres|example)\b/i.test(line) ||
    /\.example\./i.test(line)
  )
}

/** [pattern, label] pairs applied line by line. */
const PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY/, 'PEM private key'],
  [/postgres(?:ql)?:\/\/[^:\s/@]+:[^@\s/]{6,}@/, 'password in a PostgreSQL URL'],
]

const findings = []

for (const file of trackedFiles()) {
  if (/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|tar|gz|lock)$/i.test(file)) continue
  if (file === 'tools/scan-secrets.mjs') continue
  // An `.env.example`'s entire purpose is to name every variable with a
  // placeholder value; its values are meant to look like the real thing.
  if (/(^|\/)\.env\.[^/]*example$/i.test(file) || /(^|\/)\.env\.example$/i.test(file)) continue

  let text
  try {
    const raw = readFileSync(file)
    // A UTF-16 file read as utf8 is mojibake that hides every secret in it;
    // decode it properly instead of scanning an empty-looking buffer.
    if (raw.length >= 2 && ((raw[0] === 0xff && raw[1] === 0xfe) || (raw[0] === 0xfe && raw[1] === 0xff))) {
      text = raw.toString('utf16le')
    } else if (raw.includes(0)) {
      text = raw.toString('utf16le')
    } else {
      text = raw.toString('utf8')
    }
  } catch {
    continue
  }
  if (isTestFile(file)) continue

  // Whole content, not line by line: a secret padded with comment whitespace on
  // a long line used to pass because long lines were skipped.
  const lineOf = (index) => text.slice(0, index).split('\n').length
  const report = (match, label) => {
    findings.push(`${file}:${lineOf(match.index ?? 0)}  ${label}`)
  }

  for (const [pattern, label] of PATTERNS) {
    const global = new RegExp(pattern.source, 'gi')
    for (const match of text.matchAll(global)) {
      if (label === 'password in a PostgreSQL URL' && isPlaceholderUrl(match[0])) continue
      report(match, label)
      break
    }
  }

  for (const name of SECRET_NAMES) {
    const assignment = new RegExp(`${name}\\s*[:=]\\s*["']?([^"'\\s,;}]{12,})`, 'gi')
    for (const match of text.matchAll(assignment)) {
      const value = match[1] ?? ''
      if (value.length >= MIN_SECRET_LENGTH && !PLACEHOLDER.test(value)) {
        report(match, `${name} looks like a live secret`)
        break
      }
    }
  }
}

if (findings.length > 0) {
  console.error('scan-secrets: refusing to proceed — live-looking secrets in tracked files:')
  for (const finding of findings) console.error(`  ${finding}`)
  console.error('')
  console.error('Move the value to a local, ignored .env file (see .env.example for the names).')
  process.exit(1)
}

console.log('scan-secrets: no live-looking secrets in tracked files')
