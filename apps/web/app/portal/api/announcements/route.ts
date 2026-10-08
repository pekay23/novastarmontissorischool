import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTenantContext } from '@/lib/tenant'
import { hasPermission } from '@novastar/auth'
import { resolveVisibility, visibilityDeniesAll } from '@/lib/visibility'
import { z } from 'zod'
import { logError } from '@/lib/logger'

/**
 * Internal staff announcements.
 *
 * These are stored in `Announcement`, NOT in `News`. `News` is the public
 * marketing CMS: `apps/public-site/lib/data.ts` `getPublishedNews` renders it at
 * BUILD time, filtering on `status: 'PUBLISHED'` and nothing else — it never
 * looks at `audience`. This route used to write here, which meant a notice
 * addressed to one classroom teacher was a single `status` flip away from
 * appearing on the school's public homepage.
 *
 * The two tables are separate storage, not one table with a flag, so there is no
 * audience value that could make a row public and no read of this table that
 * could reach the marketing site. `tests/announcements-not-public.test.ts` pins
 * that boundary.
 *
 * `Announcement` carries a single `body`, not the `bodyEn`/`bodyTw`/
 * `excerptEn`/`excerptTw`/`slug`/`featuredImage` set that made this look like an
 * article: a staff notice is one text written once, not a bilingual published
 * page. The wire shape below mirrors the model.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    const { schoolId, tenantId, userId } = ctx
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'announcement:read', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // School-wide announcements are not narrowed per role, but an
    // unrecognised role resolves to `custom` and is refused rather than shown
    // drafts it was never entitled to read.
    const visibility = await resolveVisibility(ctx, 'announcement:read')
    if (visibilityDeniesAll(visibility)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')

    const where: Prisma.AnnouncementWhereInput = { schoolId, tenantId }
    if (status) where.status = status as Prisma.AnnouncementWhereInput['status']

    // `audience` is a list of role names and an EMPTY list means every role in
    // the school. Without this filter the read path ignored `audience`
    // altogether, so a notice written for `['HEAD_TEACHER']` was handed to every
    // parent who could reach the page -- the one role guaranteed to have nothing
    // to do with a staff notice.
    //
    // The test is "empty, or names my role", and it is expressed in the query
    // rather than by fetching the school-wide set and dropping rows afterwards.
    // A caller whose role cannot be determined is treated as belonging to no
    // audience and sees only the empty-audience notices, never a narrowed one.
    where.OR = ctx.role
      ? [{ audience: { isEmpty: true } }, { audience: { has: ctx.role } }]
      : [{ audience: { isEmpty: true } }]

    const announcements = await prisma.announcement.findMany({
      where,
      include: { author: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ data: announcements })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Announcements GET', error)
    return NextResponse.json({ error: 'Failed to fetch announcements' }, { status: 500 })
  }
}

/**
 * `audience` is a list of role names. An empty list means every role in the
 * school, which is the common case for a general notice — the model documents
 * that convention, so the default here is `[]` and not `['ALL']`, which would
 * name a role that does not exist and target nobody.
 */
const CreateAnnouncementSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  audience: z.array(z.string()).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  publishedAt: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const { schoolId, tenantId, userId } = await getTenantContext()
    if (!schoolId) return NextResponse.json({ error: 'No school assigned' }, { status: 400 })

    // RBAC
    if (!(await hasPermission(userId, 'announcement:create', tenantId, schoolId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parseResult = CreateAnnouncementSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input', details: parseResult.error.issues }, { status: 400 })
    }
    const data = parseResult.data

    const announcement = await prisma.announcement.create({
      data: {
        tenantId,
        schoolId,
        title: data.title,
        body: data.body,
        audience: data.audience ?? [],
        status: data.status ?? 'DRAFT',
        publishedAt: data.publishedAt ? new Date(data.publishedAt) : (data.status === 'PUBLISHED' ? new Date() : null),
        authorId: userId,
      },
    })
    return NextResponse.json(announcement, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    logError('Announcement POST', error)
    return NextResponse.json({ error: 'Failed to create announcement' }, { status: 500 })
  }
}