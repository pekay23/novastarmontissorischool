import 'server-only'

import crypto from 'crypto'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * S3-compatible object storage for a child's health documents.
 *
 * The database holds metadata only (`StudentHealthDocument`); the bytes live in
 * a private bucket. Nothing here ever produces a permanent URL for an object —
 * reads go through `presignHealthDocumentRead`, which mints a URL that expires.
 * That is what lets the bucket stay private, and it is why `storageKey` is not
 * derivable into a shareable address.
 *
 * S3-compatible rather than S3 proper on purpose: Neon, Cloudflare R2 and MinIO
 * all speak this API, so the same code runs against each. `S3_ENDPOINT` selects
 * which. Omit it and the AWS SDK resolves the real S3 endpoint from the region.
 *
 * THREE THINGS THIS MODULE REFUSES TO DO
 *
 * 1. Trust a declared content type. `File.type` comes from the client and is
 *    whatever the caller felt like sending, so the first bytes are checked
 *    against the declared type before anything is written. A `.pdf` that is
 *    really an HTML document rendered in a browser context is the classic way to
 *    turn an upload feature into stored XSS.
 * 2. Derive a path from a filename. The uploaded name is kept in the database
 *    for display and never reaches a key. An extension is looked up from a fixed
 *    map keyed on the verified content type, so `../../` and `x.pdf.html` cannot
 *    occur.
 * 3. Stay quiet when unconfigured. `requireStorageConfig` throws rather than
 *    falling back, because a silent no-op here would look like a successful
 *    upload with the file discarded. Callers that need a soft answer use
 *    `isHealthDocumentStorageConfigured` and branch deliberately.
 */

export const HEALTH_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024

export const HEALTH_DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const

export type HealthDocumentContentType = (typeof HEALTH_DOCUMENT_CONTENT_TYPES)[number]

/** Thrown when the bucket is not configured. Distinct so a route can 503 it. */
export class StorageNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`File storage is not configured; missing ${missing.join(', ')}`)
    this.name = 'StorageNotConfiguredError'
  }
}

export class UnsupportedDocumentTypeError extends Error {
  constructor(received: string) {
    super(`Unsupported document type: ${received}`)
    this.name = 'UnsupportedDocumentTypeError'
  }
}

export class DocumentTooLargeError extends Error {
  constructor(sizeBytes: number, maxBytes: number) {
    super(`Document is ${sizeBytes} bytes; the limit is ${maxBytes}`)
    this.name = 'DocumentTooLargeError'
  }
}

/** Extension per verified content type. The only place an extension is chosen. */
const EXTENSION_BY_TYPE: Record<HealthDocumentContentType, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
}

/**
 * Leading bytes each type must begin with.
 *
 * PDF files start with `%PDF-`. JPEG starts `FF D8 FF` (the third byte is a
 * marker nibble; `FF D8` alone is enough to reject HTML and is what every
 * parser keys on). PNG is the full 8-byte signature.
 */
const MAGIC_BY_TYPE: Record<HealthDocumentContentType, readonly number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46], // %PDF
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
}

function isHealthDocumentContentType(value: string): value is HealthDocumentContentType {
  return (HEALTH_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(value)
}

/**
 * Confirms the bytes actually are the type the caller declared.
 *
 * A prefix check, not a full parse: it is enough to reject the HTML/SVG payload
 * that turns an upload into stored XSS, which is the threat here. It is not a
 * validator — a deliberately malformed file with a correct signature is still
 * possible, so the bucket must not be web-servable and downloads must be served
 * with `Content-Disposition: attachment`, which is what
 * `presignHealthDocumentRead` does.
 */
export function contentTypeMatchesBytes(contentType: string, bytes: Uint8Array): boolean {
  if (!isHealthDocumentContentType(contentType)) return false
  const magic = MAGIC_BY_TYPE[contentType]
  if (bytes.length < magic.length) return false
  return magic.every((byte, index) => bytes[index] === byte)
}

interface StorageConfig {
  bucket: string
  region: string
  endpoint?: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

/**
 * `S3_*` first, then the standard `AWS_*` names, so a deployment that already
 * exports AWS credentials does not need a second copy of them.
 */
function readStorageConfig(): { config?: StorageConfig; missing: string[] } {
  const env = process.env
  const missing: string[] = []

  const bucket = env.S3_BUCKET
  const accessKeyId = env.S3_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY

  if (!bucket) missing.push('S3_BUCKET')
  if (!accessKeyId) missing.push('S3_ACCESS_KEY_ID')
  if (!secretAccessKey) missing.push('S3_SECRET_ACCESS_KEY')

  if (missing.length > 0) return { missing }

  return {
    missing,
    config: {
      bucket: bucket!,
      region: env.S3_REGION || env.AWS_REGION || 'us-east-1',
      endpoint: env.S3_ENDPOINT || undefined,
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
      // Path-style addressing is required by MinIO and accepted everywhere, so it
      // is the default rather than something each deployment must remember.
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    },
  }
}

/** True when a bucket is configured. Branch on this; never catch the throw. */
export function isHealthDocumentStorageConfigured(): boolean {
  return readStorageConfig().missing.length === 0
}

function requireStorageConfig(): StorageConfig {
  const { config, missing } = readStorageConfig()
  if (!config) throw new StorageNotConfiguredError(missing)
  return config
}

let cached: { key: string; client: S3Client } | null = null

/**
 * The client is built on first use rather than at module load so that importing
 * this file — which the portal's other modules may do transitively — does not
 * require credentials to be present. The cache key is the endpoint and bucket,
 * so a test that swaps them gets a fresh client instead of the old one.
 */
function client(): { s3: S3Client; bucket: string } {
  const config = requireStorageConfig()
  const key = `${config.endpoint ?? 'aws'}|${config.region}|${config.bucket}|${config.accessKeyId}`

  if (!cached || cached.key !== key) {
    cached = {
      key,
      client: new S3Client({
        region: config.region,
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        forcePathStyle: config.forcePathStyle,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      }),
    }
  }

  return { s3: cached.client, bucket: config.bucket }
}

/**
 * The object key. Tenant-prefixed so a mistake in one school's key builder
 * cannot address another school's objects even if the database row were wrong,
 * and student-scoped so a leaked listing is one child rather than one school.
 *
 * `documentId` is generated by us, and the extension comes from the verified
 * content type — neither segment is attacker-controlled.
 */
export function healthDocumentKey(input: {
  tenantId: string
  studentId: string
  documentId: string
  contentType: HealthDocumentContentType
}): string {
  return [
    'tenants',
    input.tenantId,
    'students',
    input.studentId,
    'health',
    `${input.documentId}${EXTENSION_BY_TYPE[input.contentType]}`,
  ].join('/')
}

export interface PutHealthDocumentInput {
  tenantId: string
  studentId: string
  documentId: string
  contentType: string
  bytes: Uint8Array
}

export interface PutHealthDocumentResult {
  storageKey: string
  contentType: HealthDocumentContentType
  sizeBytes: number
  /** SHA-256 hex, so a swapped file is detectable after the fact. */
  checksum: string
}

/**
 * Writes the bytes and returns the metadata to store on the row.
 *
 * Validates before it opens a connection: an unsupported type or an oversized
 * body throws without a request being made, so a caller cannot fill the bucket
 * with junk by ignoring the response.
 */
export async function putHealthDocument(input: PutHealthDocumentInput): Promise<PutHealthDocumentResult> {
  if (!isHealthDocumentContentType(input.contentType)) {
    throw new UnsupportedDocumentTypeError(input.contentType)
  }
  if (input.bytes.byteLength === 0) {
    throw new DocumentTooLargeError(0, HEALTH_DOCUMENT_MAX_BYTES)
  }
  if (input.bytes.byteLength > HEALTH_DOCUMENT_MAX_BYTES) {
    throw new DocumentTooLargeError(input.bytes.byteLength, HEALTH_DOCUMENT_MAX_BYTES)
  }
  if (!contentTypeMatchesBytes(input.contentType, input.bytes)) {
    throw new UnsupportedDocumentTypeError(`${input.contentType} (bytes do not match)`)
  }

  const contentType = input.contentType
  const storageKey = healthDocumentKey({
    tenantId: input.tenantId,
    studentId: input.studentId,
    documentId: input.documentId,
    contentType,
  })

  const { s3, bucket } = client()

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: input.bytes,
      ContentType: contentType,
      ContentLength: input.bytes.byteLength,
      // Belt and braces with `attachment` on the presigned read: if the bucket is
      // ever exposed by a misconfiguration, these stop the browser treating the
      // object as a document to render.
      ContentDisposition: 'attachment',
      ServerSideEncryption: 'AES256',
    }),
  )

  return {
    storageKey,
    contentType,
    sizeBytes: input.bytes.byteLength,
    checksum: crypto.createHash('sha256').update(input.bytes).digest('hex'),
  }
}

/**
 * A short-lived read URL.
 *
 * Five minutes is deliberate: long enough for a parent on a slow connection to
 * open a PDF, short enough that a URL pasted into a chat is worthless by the
 * time it is read. `ResponseContentDisposition` forces a download rather than an
 * inline render, which is what makes the magic-byte check above sufficient.
 */
export async function presignHealthDocumentRead(storageKey: string, fileName: string): Promise<string> {
  const { s3, bucket } = client()

  // `fileName` is attacker-controlled, so characters that would break out of the
  // header value are stripped. It is a display name, not a path.
  const safeName = fileName.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120) || 'document'

  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      ResponseContentDisposition: `attachment; filename="${safeName}"`,
    }),
    { expiresIn: 300 },
  )
}