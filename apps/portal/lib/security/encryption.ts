/**
 * AES-256-GCM encryption utility for sensitive data at rest.
 *
 * Adapted from Aerojet Academy's `lib/security/encryption.ts`.
 * Uses NEXTAUTH_SECRET as the master key (already present in Novastar).
 */

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const SALT_LENGTH = 16
const IV_LENGTH = 16

// Cache derived keys to avoid re-deriving on every call
const keyCache = new Map<string, Buffer>()
const MAX_KEY_CACHE_SIZE = 100

function deriveKey(secret: string, salt: Buffer): Buffer {
  const cacheKey = salt.toString('hex')
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
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is required for encryption operations')
  }
  const salt = crypto.randomBytes(SALT_LENGTH)
  const key = deriveKey(secret, salt)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag}:${encrypted}`
}

export async function decrypt(encryptedText: string): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is required for encryption operations')
  }
  const parts = encryptedText.split(':')
  if (parts.length !== 4) throw new Error('Invalid encrypted text format')

  const [saltHex, ivHex, authTagHex, encrypted] = parts
  const salt = Buffer.from(saltHex, 'hex')
  const key = deriveKey(secret, salt)
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
