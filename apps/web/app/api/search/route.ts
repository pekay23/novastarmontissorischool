import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@novastar/database'

import { searchCandidates, type SearchCandidate } from '@/lib/search-match'
import { SEARCH_INDEX } from '@/lib/search-index'

/*
 * Public-site search route.
 *
 * The ranking rules live in `lib/search-match.ts`, which has its own tests;
 * this file only supplies the candidates and the response shape. See that
 * module for why matching is tokenised rather than substring, and
 * `tools/build-search-index.ts` for how the static half of the index is
 * generated from the public pages' own copy.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = (searchParams.get('q') || '').trim()

  if (!query) {
    return NextResponse.json({ results: [], query: '', terms: [], total: 0 })
  }

  const candidates: SearchCandidate[] = [...SEARCH_INDEX, ...(await getDynamicContent())]
  const { results, terms, total } = searchCandidates(candidates, query, {
    limit: 20,
    maxRowsPerPage: 3,
  })

  return NextResponse.json({
    results: results.map(({ url, title, text, type, category, score, matched, rank }) => ({
      url,
      title,
      text,
      type,
      category,
      score,
      matched,
      rank,
    })),
    query,
    terms,
    total,
  })
}

/*
 * Published news, events and programmes from the database.
 *
 * Field names follow the Prisma schema: `News.excerptEn`, `Event.descriptionEn`,
 * `ClassLevel.subjects -> SubjectLevel.subject`. The previous hand-rolled query
 * named `excerpt`, `description` and `description` again, all three of which do
 * not exist — each threw, and the surrounding `catch` turned every failure into
 * an empty array, so the database half of search had never once returned a row.
 *
 * URLs point at the section pages, never at a detail route: `/news/[slug]` does
 * not exist in this app, so a result that navigates there lands on a 404.
 */
async function getDynamicContent(): Promise<SearchCandidate[]> {
  if (!process.env.DATABASE_URL) return []

  try {
    const [news, events, programmes] = await Promise.all([
      prisma.news.findMany({
        where: { tenant: { code: 'novastar' }, status: 'PUBLISHED', publishedAt: { lte: new Date() } },
        select: { title: true, excerptEn: true, category: true },
        take: 30,
      }),
      prisma.event.findMany({
        where: { tenant: { code: 'novastar' }, status: 'PUBLISHED', endDate: { gte: new Date() } },
        select: { title: true, descriptionEn: true, location: true },
        take: 30,
      }),
      prisma.classLevel.findMany({
        where: { tenant: { code: 'novastar' } },
        select: {
          name: true,
          code: true,
          phase: true,
          ageMin: true,
          ageMax: true,
          subjects: {
            select: { subject: { select: { name: true, description: true } } },
            orderBy: { periodsPerWeek: 'desc' },
            take: 12,
          },
        },
        orderBy: { order: 'asc' },
      }),
    ])

    const dynamic: SearchCandidate[] = [
      ...news.map((item) => ({
        url: '/news',
        title: item.title,
        text: item.excerptEn || item.category || 'News item published on the school news page.',
        type: 'news',
        category: 'Community',
      })),
      ...events.map((item) => ({
        url: '/events',
        title: item.title,
        text: [item.descriptionEn, item.location].filter(Boolean).join(' — ') || 'Upcoming school event on the school calendar.',
        type: 'event',
        category: 'Community',
      })),
    ]

    for (const programme of programmes) {
      const subjectNames = programme.subjects.map((link) => link.subject.name)
      dynamic.push({
        url: '/academics',
        title: programme.name,
        text: `${programme.name} (${programme.code}) is part of the ${programme.phase.toLowerCase()} programme, for children aged ${programme.ageMin} to ${programme.ageMax} months.${
          subjectNames.length > 0 ? ` Subjects taught: ${subjectNames.join(', ')}.` : ''
        }`,
        type: 'program',
        category: 'Academics',
      })
      for (const link of programme.subjects) {
        dynamic.push({
          url: '/academics',
          title: link.subject.name,
          text: `${link.subject.name} is taught in ${programme.name} at Novastar Montessori School. ${link.subject.description || ''}`.trim(),
          type: 'subject',
          category: 'Academics',
        })
      }
    }

    return dynamic
  } catch {
    // A search must still answer when the database is unreachable; the static
    // index above carries the public pages on its own.
    return []
  }
}
