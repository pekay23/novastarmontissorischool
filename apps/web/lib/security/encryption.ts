/**
 * AES-256-GCM encryption utility for sensitive data at rest.
 *
 * Adapted from Aerojet Academy's `lib/security/encryption.ts`.
 *
 * Uses a dedicated `ENCRYPTION_KEY` (base64-encoded 32-byte raw key). When
 * `ENCRYPTION_KEY` is absent, falls back to `NEXTAUTH_SECRET` for backward
 * compatibility with data encrypted under the old scheme.
 *
 * New ciphertexts are prefixed with `v2:` and derive their working key via
 * HKDF-SHA256. Decryption automatically detects the format and handles both
 * v2 (HKDF-derived, `v2:` prefix) and legacy (scrypt-derived, no prefix).
 */

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const SALT_LENGTH = 16
const IV_LENGTH = 16
const INFO = Buffer.from('novastar:encryption:v2')

const keyCache = new Map<string, Buffer>()
const MAX_KEY_CACHE_SIZE = 100

function getRawKey(): Buffer | null {
  const base64 = process.env.ENCRYPTION_KEY
  if (base64) {
    try {
      const key = Buffer.from(base64, 'base64')
      if (key.length >= 32) return key.slice(0, 32)
    } catch {
      return null
    }
  }
  return null
}

function deriveKeyV2(salt: Buffer): Buffer {
  const cacheKey = 'v2:' + salt.toString('hex')
  const cached = keyCache.get(cacheKey)
  if (cached) return cached

  const ikm = getRawKey() ?? (process.env.NEXTAUTH_SECRET ? Buffer.from(process.env.NEXTAUTH_SECRET, 'utf8') : null)
  if (!ikm) {
    throw new Error('ENCRYPTION_KEY or NEXTAUTH_SECRET is required for encryption operations')
  }

  const key = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, INFO, 32))

  if (keyCache.size >= MAX_KEY_CACHE_SIZE) {
    const first = keyCache.keys().next().value
    if (first) keyCache.delete(first)
  }
  keyCache.set(cacheKey, key)
  return key
}

function deriveKeyLegacy(secret: string, salt: Buffer): Buffer {
  const cacheKey = 'legacy:' + salt.toString('hex')
  const cached = keyCache.get(cacheKey)
  if (cached) return cached

  const key = crypto.scryptSync(secret, salt, 32)

  if (keyCache.size >= MAX_KEY_CACHE_SIZE) {
    const first = keyCache.keys().next().value
    if (first) keyCache.delete(first)
  }
  keyCache.set(cacheKey, key)
  return key
}

export async function encrypt(text: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const key = deriveKeyV2(salt)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return `v2:${salt.toString('hex')}:${iv.toString('hex')}:${authTag}:${encrypted}`
}

export async function decrypt(encryptedText: string): Promise<string> {
  if (encryptedText.startsWith('v2:')) {
    const parts = encryptedText.slice(3).split(':')
    if (parts.length !== 4) throw new Error('Invalid v2 encrypted text format')

    const [saltHex, ivHex, authTagHex, encrypted] = parts
    const salt = Buffer.from(saltHex, 'hex')
    const key = deriveKeyV2(salt)
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }

  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    throw new Error('ENCRYPTION_KEY or NEXTAUTH_SECRET is required for decryption operations')
  }
  const parts = encryptedText.split(':')
  if (parts.length !== 4) throw new Error('Invalid encrypted text format')

  const [saltHex, ivHex, authTagHex, encrypted] = parts
  const salt = Buffer.from(saltHex, 'hex')
  const key = deriveKeyLegacy(secret, salt)
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex')
}
