import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

import { prisma } from '@/lib/prisma'
import { logError } from '@/lib/logger'
import { authorizeHealthAccess } from '@/lib/health/scope'
import { logAuditEvent, AuditLogAction } from '@/lib/audit/logger'
import { rateLimitByUserAsync } from '@/lib/rate-limit'
import {
  DocumentTooLargeError,
  HEALTH_DOCUMENT_MAX_BYTES,
  StorageNotConfiguredError,
  UnsupportedDocumentTypeError,
  isHealthDocumentStorageConfigured,
  putHealthDocument,
} from '@/lib/storage/health-documents'

/**
 * The medical officer's report: upload, list, and fetch.
 *
 * The policy requires this document "with a report from a certified medical
 * officer or paediatrician" whenever a condition is declared, so this is the
 * route that makes the obligation satisfiable inside the product rather than by
 * WhatsApp.
 *
 * Order of operations matters and is deliberate: validate, write to storage,
 * then create the row. A row is never written for bytes that failed to land,
 * because a metadata row pointing at a missing object is a record that looks
 * complete and cannot be opened — the worst state this feature has.
 *
 * UPLOAD ORDER IS ALSO WHY `documentId` IS GENERATED HERE. The key embeds it,
 * so the object name is decided before the bytes are read and never from
 * anything the caller sent.
 */

/** One multipart part, and nothing else, is accepted. */
const MAX_UPLOADS_PER_HOUR = 20

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const result = await authorizeHealthAccess(id, 'document:health:read')
    if (!result.ok) {
      return NextResponse.json({ error: result.denial.error }, { status: result.denial.status })
    }

    const { student, tenantId, schoolId, userId } = result.access

    const documents = await prisma.studentHealthDocument.findMany({
      where: { studentId: student.id, tenantId, schoolId },
      orderBy: { uploadedAt: 'desc' },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        checksum: true,
        supersedesId: true,
        uploadedAt: true,
      },
    })

    await logAuditEvent({
      userId,
      tenantId,
      schoolId,
      action: AuditLogAction.READ,
      entity: 'StudentHealthDocument',
      entityId: student.id,
      description: `Listed health documents for student ${student.id}`,
    })

    return NextResponse.json({ data: documents })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Student health documents GET', error)
    return NextResponse.json({ error: 'Failed to list health documents' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const result = await authorizeHealthAccess(id, 'document:health:upload')
    if (!result.ok) {
      return NextResponse.json({ error: result.denial.error }, { status: result.denial.status })
    }

    const { student, tenantId, schoolId, userId } = result.access

    // 503 rather than 500, and checked before the body is read: a deployment
    // with no bucket should say "not available", not accept a file and lose it.
    if (!isHealthDocumentStorageConfigured()) {
      return NextResponse.json(
        { error: 'File storage is not configured on this deployment' },
        { status: 503 },
      )
    }

    const limit = await rateLimitByUserAsync(userId, MAX_UPLOADS_PER_HOUR, 60 * 60 * 1000)
    if (!limit.success) {
      return NextResponse.json({ error: 'Too many uploads, try again later' }, { status: 429 })
    }

    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return NextResponse.json({ error: 'Expected a multipart upload' }, { status: 400 })
    }

    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file supplied' }, { status: 400 })
    }

    /*
     * Reject on the DECLARED length before buffering. A 5MB cap checked after
     * `arrayBuffer()` has already let a caller make this process hold 5MB —
     * or several of them; the cap exists to bound memory, so it has to be the
     * thing that decides whether the bytes are read at all.
     */
    if (file.size > HEALTH_DOCUMENT_MAX_BYTES) {
      return NextResponse.json(
        { error: `File is larger than ${HEALTH_DOCUMENT_MAX_BYTES} bytes` },
        { status: 413 },
      )
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'File is empty' }, { status: 400 })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())

    // `supersedesId` is optional and is checked against this child's own
    // documents below, so a caller cannot chain their upload onto another
    // child's record and make its history look tampered with.
    const supersedesRaw = form.get('supersedesId')
    const supersedesId =
      typeof supersedesRaw === 'string' && supersedesRaw.length > 0 ? supersedesRaw : null

    if (supersedesId) {
      const target = await prisma.studentHealthDocument.findFirst({
        where: { id: supersedesId, studentId: student.id, tenantId, schoolId },
        select: { id: true },
      })
      if (!target) {
        return NextResponse.json({ error: 'No such document for this child' }, { status: 400 })
      }
    }

    // Generated by us, and embedded in the storage key. Never the caller's.
    const documentId = randomUUID()

    let stored
    try {
      stored = await putHealthDocument({
        tenantId,
        studentId: student.id,
        documentId,
        contentType: file.type,
        bytes,
      })
    } catch (error) {
      if (error instanceof UnsupportedDocumentTypeError) {
        return NextResponse.json(
          { error: 'Only PDF, JPEG or PNG documents are accepted' },
          { status: 415 },
        )
      }
      if (error instanceof DocumentTooLargeError) {
        return NextResponse.json({ error: error.message }, { status: 413 })
      }
      throw error
    }

    const document = await prisma.studentHealthDocument.create({
      data: {
        tenantId,
        schoolId,
        studentId: student.id,
        storageKey: stored.storageKey,
        fileName: file.name.slice(0, 200) || 'document',
        contentType: stored.contentType,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        supersedesId,
        uploadedById: userId,
      },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        checksum: true,
        supersedesId: true,
        uploadedAt: true,
      },
    })

    await logAuditEvent({
      userId,
      tenantId,
      schoolId,
      action: AuditLogAction.CREATE,
      entity: 'StudentHealthDocument',
      entityId: document.id,
      description: `Uploaded a health document for student ${student.id}`,
      details: { contentType: stored.contentType, sizeBytes: stored.sizeBytes },
    })

    return NextResponse.json({ data: document }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (error instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: 'File storage is not configured' }, { status: 503 })
    }
    logError('Student health documents POST', error)
    return NextResponse.json({ error: 'Failed to upload health document' }, { status: 500 })
  }
}