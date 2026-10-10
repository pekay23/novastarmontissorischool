import 'server-only'

import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { logError } from '@/lib/logger'
import { authorizeHealthAccess } from '@/lib/health/scope'
import { logAuditEvent, AuditLogAction } from '@/lib/audit/logger'
import { presignHealthDocumentRead } from '@/lib/storage/health-documents'

/**
 * A short-lived download URL for one health document.
 *
 * Scoped twice on purpose. The permission gate is `document:health:read`, and the
 * lookup then requires BOTH the child from the path and the document id — so a
 * document id belonging to a different child is a 404, not a URL. Passing only
 * the document id would have made this a lookup into every child's health
 * records for anyone holding the key.
 *
 * The URL expires in five minutes (`presignHealthDocumentRead`), so it is safe
 * to hand to a browser and useless if pasted into a chat afterwards. The bucket
 * itself is never public, which is the property that makes this work.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  try {
    const { id, documentId } = await params

    const result = await authorizeHealthAccess(id, 'document:health:read')
    if (!result.ok) {
      return NextResponse.json({ error: result.denial.error }, { status: result.denial.status })
    }

    const { student, tenantId, schoolId, userId } = result.access

    const document = await prisma.studentHealthDocument.findFirst({
      where: { id: documentId, studentId: student.id, tenantId, schoolId },
      select: { id: true, storageKey: true, fileName: true },
    })
    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    const url = await presignHealthDocumentRead(document.storageKey, document.fileName)

    /*
     * Minting a URL IS the read. The bytes leave through the bucket, so this
     * row is the only place the access is observable — logging it in the route
     * that lists documents would record that someone looked, not that someone
     * opened a report.
     */
    await logAuditEvent({
      userId,
      tenantId,
      schoolId,
      action: AuditLogAction.READ,
      entity: 'StudentHealthDocument',
      entityId: document.id,
      description: `Issued a download URL for a health document of student ${student.id}`,
    })

    return NextResponse.json({ url, expiresInSeconds: 300 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Student health document GET', error)
    return NextResponse.json({ error: 'Failed to fetch health document' }, { status: 500 })
  }
}