import { z } from 'zod'

export const SyllabusCreateSchema = z.object({
  classSubjectId: z.string().trim().min(1),
  termId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  body: z.string().nullable().optional(),
  topics: z.array(z.string().trim().min(1)).min(1),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
})

/** The shared projection for a syllabus row, so GET and POST agree. */
export const SYLLABUS_INCLUDE = {
  classSubject: {
    include: {
      class: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true, code: true } },
    },
  },
  term: {
    select: { id: true, name: true, academicYear: { select: { name: true } } },
  },
} as const
