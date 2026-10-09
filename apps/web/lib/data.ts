// apps/public-site/lib/data.ts
// Data fetching for public site - reads from database at build time

import { prisma } from '@novastar/database'
import { Branding, News, Event, ClassLevel, Subject, PaymentMethodConfig } from '@prisma/client'
import { SCHOOL_INFO } from './metadata'
import { ADMISSIONS_OPEN_FLAG_KEY } from '@novastar/shared-types'

// Type-safe fetchers with fallbacks for build-time when DB unavailable
async function safeFetch<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    // Check if DATABASE_URL is available (not during static analysis)
    if (!process.env.DATABASE_URL) {
      return fallback
    }
    return await fn()
  } catch (error) {
    console.warn(`Data fetch failed, using fallback:`, error)
    return fallback
  }
}

// Branding (singleton)
export async function getBranding(): Promise<Branding | null> {
  return safeFetch(
    async () => {
      return await prisma.branding.findFirst({
        where: { tenant: { code: 'novastar' } },
        orderBy: { createdAt: 'desc' },
      })
    },
    null
  )
}

// Published News
export async function getPublishedNews(limit = 6): Promise<News[]> {
  return safeFetch(
    async () => {
      return await prisma.news.findMany({
        where: {
          tenant: { code: 'novastar' },
          status: 'PUBLISHED',
          publishedAt: { lte: new Date() },
        },
        orderBy: { publishedAt: 'desc' },
        take: limit,
      })
    },
    []
  )
}

// Published Events
export async function getPublishedEvents(limit = 10): Promise<Event[]> {
  return safeFetch(
    async () => {
      return await prisma.event.findMany({
        where: {
          tenant: { code: 'novastar' },
          status: 'PUBLISHED',
          endDate: { gte: new Date() },
        },
        orderBy: { startDate: 'asc' },
        take: limit,
      })
    },
    []
  )
}

// Academic programs (Class Levels with Subjects)
export async function getAcademicPrograms(): Promise<Array<ClassLevel & { subjects: Subject[] }>> {
  const fallback = [
    {
      id: 'creche',
      tenantId: 'novastar',
      name: 'Crèche & Nursery',
      code: 'CRECHE',
      phase: 'KINDERGARTEN',
      order: 1,
      ageMin: 6,
      ageMax: 36,
      capacity: 30,
      createdAt: new Date(),
      updatedAt: new Date(),
      subjects: [
        { id: 's1', tenantId: 'novastar', name: 'Practical Life', code: 'PL', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's2', tenantId: 'novastar', name: 'Sensorial', code: 'SEN', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's3', tenantId: 'novastar', name: 'Language (English & Twi)', code: 'LANG', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's4', tenantId: 'novastar', name: 'Cultural Subjects', code: 'CULT', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
      ],
    },
    {
      id: 'kg',
      tenantId: 'novastar',
      name: 'Kindergarten',
      code: 'KG',
      phase: 'KINDERGARTEN',
      order: 2,
      ageMin: 36,
      ageMax: 72,
      capacity: 40,
      createdAt: new Date(),
      updatedAt: new Date(),
      subjects: [
        { id: 's5', tenantId: 'novastar', name: 'Numeracy & Mathematics', code: 'MATH', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's6', tenantId: 'novastar', name: 'Literacy & Phonics', code: 'LIT', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's7', tenantId: 'novastar', name: 'Environmental Studies', code: 'ENV', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's8', tenantId: 'novastar', name: 'Creative Arts', code: 'ART', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
      ],
    },
    {
      id: 'primary',
      tenantId: 'novastar',
      name: 'Primary School (B1–B6)',
      code: 'PRI',
      phase: 'PRIMARY',
      order: 3,
      ageMin: 72,
      ageMax: 144,
      capacity: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
      subjects: [
        { id: 's9', tenantId: 'novastar', name: 'English Language', code: 'ENG', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's10', tenantId: 'novastar', name: 'Mathematics', code: 'MATH', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's11', tenantId: 'novastar', name: 'Integrated Science', code: 'SCI', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's12', tenantId: 'novastar', name: 'Asante Twi', code: 'TWI', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's13', tenantId: 'novastar', name: 'Computing', code: 'COMP', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's14', tenantId: 'novastar', name: 'History of Ghana', code: 'HIST', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
      ],
    },
    {
      id: 'jhs',
      tenantId: 'novastar',
      name: 'Junior High School (JHS 1–3)',
      code: 'JHS',
      phase: 'JHS',
      order: 4,
      ageMin: 144,
      ageMax: 180,
      capacity: 50,
      createdAt: new Date(),
      updatedAt: new Date(),
      subjects: [
        { id: 's15', tenantId: 'novastar', name: 'English Language', code: 'ENG', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's16', tenantId: 'novastar', name: 'Mathematics', code: 'MATH', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's17', tenantId: 'novastar', name: 'Integrated Science', code: 'SCI', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's18', tenantId: 'novastar', name: 'Social Studies', code: 'SOC', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's19', tenantId: 'novastar', name: 'Asante Twi', code: 'TWI', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
        { id: 's20', tenantId: 'novastar', name: 'Computing', code: 'COMP', description: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), isRequired: true, periodsPerWeek: 5 },
      ],
    }
  ] as unknown as Array<ClassLevel & { subjects: Subject[] }>

  return safeFetch(
    async () => {
      const levels = await prisma.classLevel.findMany({
        where: { tenant: { code: 'novastar' } },
        orderBy: { order: 'asc' },
        include: {
          subjects: {
            where: { isRequired: true },
            include: { subject: true },
            orderBy: { periodsPerWeek: 'desc' },
            take: 6,
          },
        },
      })
      return levels.map(l => ({
        ...l,
        subjects: l.subjects.map(s => s.subject),
      }))
    },
    fallback
  )
}

// Footer contact info from branding
export async function getContactInfo(): Promise<{
  name: string
  address: string
  phone: string
  email: string
  hours: string
  socialLinks: Record<string, string>
} | null> {
  return safeFetch(
    async () => {
      const branding = await prisma.branding.findFirst({
        where: { tenant: { code: 'novastar' } },
        orderBy: { createdAt: 'desc' },
      })
      if (!branding) return null
      return {
        name: branding.name,
        address: branding.address || '',
        phone: branding.phone || '',
        email: branding.email || '',
        hours: 'Monday – Friday: 7:00 AM – 4:00 PM',
        socialLinks: (branding.socialLinks as Record<string, string>) || {},
      }
    },
    null
  )
}

// Hero content from latest news or branding
export async function getHeroContent(): Promise<{
  title: string
  subtitle: string
  cta: string
  secondaryCta: string
} | null> {
  return safeFetch(
    async () => {
      const branding = await prisma.branding.findFirst({
        where: { tenant: { code: 'novastar' } },
        orderBy: { createdAt: 'desc' },
      })
      if (!branding) return null
      return {
        title: branding.name,
        subtitle: branding.motto || 'Authentic Montessori Education from Creche to Junior High in Kumasi, Ghana',
        cta: 'Apply Now',
        secondaryCta: 'Learn More',
      }
    },
    null
  )
}

/*
 * Stats for the homepage.
 *
 * The no-database branch deliberately reports no enrolment, staff or programme
 * counts. It used to hardcode "500+ students", "40+ qualified teachers" and
 * "10+ years of excellence" — invented institutional figures that a real
 * school's homepage cannot substantiate, and which the static export published
 * verbatim because no database was reachable at build time. It now falls back
 * to the same verifiable facts the rest of the site states, so the numbers on
 * the page never depend on whether a database happened to be configured.
 *
 * "Years since founding" is also computed from `SCHOOL_INFO.established` rather
 * than from `tenant.createdAt`: the tenant row's creation timestamp is a
 * database artefact, not the school's founding date, and the two disagreed.
 */
export async function getHomeStats(): Promise<Array<{ label: string; value: string }>> {
  const fallback = [
    { label: 'Guide to children in the early years', value: '1:6' },
    { label: 'One school, Crèche to Junior High', value: 'Crèche–JHS' },
    { label: 'Aligned to Ghana Education Service standards', value: 'GES' },
    { label: 'Terms per academic year', value: '3' },
  ]

  return safeFetch(
    async () => {
      const [studentCount, staffCount, programCount] = await Promise.all([
        prisma.student.count({ where: { tenant: { code: 'novastar' }, status: 'ACTIVE' } }),
        prisma.staff.count({ where: { tenant: { code: 'novastar' }, status: 'ACTIVE' } }),
        prisma.classLevel.count({ where: { tenant: { code: 'novastar' } } }),
      ])

      /*
       * An empty database must not render "0+ Students Enrolled" on a public
       * page — the figure reads as a claim about the school, not about the
       * build. Fall back to the verified facts instead.
       */
      if (studentCount === 0 && staffCount === 0 && programCount === 0) return fallback

      return [
        { label: 'Students enrolled', value: String(studentCount) },
        { label: 'Teaching staff', value: String(staffCount) },
        { label: 'Class levels', value: String(programCount) },
        {
          label: 'Years since founding',
          value: String(new Date().getFullYear() - SCHOOL_INFO.established),
        },
      ]
    },
    fallback
  )
}

/*
 * Feature cards.
 *
 * `safeFetch` is called with the same array on both sides, so neither branch ever
 * queries the CMS: `getFeatures` is a static list and has to be edited here.
 *
 * The third card previously read "Montessori-trained teachers with PEN
 * certification". Both are credential claims about named real staff, with no
 * registry or staff record behind them anywhere in the repository. It now
 * describes the classroom instead, which is what a prospective parent is
 * actually deciding about.
 */
const DEFAULT_FEATURES = [
  {
    title: 'Montessori Method',
    desc: 'Child-centered learning through hands-on materials and practical activities',
    icon: 'book-open',
  },
  {
    title: 'GES Curriculum',
    desc: 'Aligned with Ghana Education Service and NaCCA standards',
    icon: 'graduation-cap',
  },
  {
    title: 'Prepared Environment',
    desc: 'Materials organised so each child can choose work and work independently',
    icon: 'award',
  },
]

export async function getFeatures(): Promise<Array<{ title: string; desc: string; icon: string }>> {
  return safeFetch(async () => DEFAULT_FEATURES, DEFAULT_FEATURES)
}

/**
 * Testimonials.
 *
 * Deliberately empty, and no longer a fallback over invented copy.
 *
 * This function used to return two written quotes attributed to "Parent of KG2
 * Student" and "Parent of B3 Student" from a module constant — on both the
 * success and the fallback branch, so the static export published them verbatim.
 * Nothing in the repository backed them: no consent record, no parent supplied
 * them, and no school had agreed to them. A quotation attributed to a named
 * parent is a claim about that family, and a school website making one up is a
 * worse failure than a missing section.
 *
 * There is also nowhere for a real testimonial to live yet. The comment above
 * this used to say the quotes came from `ConfigEntity`, which was never true;
 * that model is `@@unique([tenantId, type])` and holds one row per entity-type
 * *definition* (its fields, permissions and icon) — it is the schema catalogue,
 * not a content store, and putting quotes in it would mean either abusing a
 * definition row or adding a second row per type against a unique index.
 *
 * So the section renders nothing until a consented store exists, and
 * `app/page.tsx` already hides it on an empty list. Populating it honestly needs
 * a `Testimonial` model carrying the quote, the attribution and the consent
 * record, seeded only from quotes a parent actually gave — a migration, and
 * therefore a decision rather than a patch.
 */
export async function getTestimonials(): Promise<
  Array<{ name: string; relation: string; quote: string }>
> {
  return []
}

// CTA content
/**
 * Page-aware CTA content. Each public-facing page gets a subtitle and call-to-action
 * that reflects its age range and context, rather than a single generic string
 * that all pages share.
 *
 * The `page` parameter selects which variant to return. This must match the
 * page that calls it — there is no cross-page fallback, so a page that forgets
 * to pass its variant gets the home-page CTA, which is at least on-brand.
 */
export async function getCTAContent(page: 'home' | 'preschool' | 'primary' = 'home'): Promise<{ title: string; subtitle: string; cta: string } | null> {
  return safeFetch(
    async () => {
      const variants: Record<'home' | 'preschool' | 'primary', { title: string; subtitle: string; cta: string }> = {
        home: {
          title: 'Ready to start at Novastar?',
          subtitle:
            'From Crèche to Junior High, our mixed-age classrooms and GES-aligned curriculum give every child a prepared environment to learn independently. Book a visit or apply for 2026/27.',
          cta: 'Apply for admission',
        },
        preschool: {
          title: 'Ready to join our preschool community?',
          subtitle:
            'Give your child the foundation for a lifetime of learning through authentic Montessori education during the absorbent mind years, ages 6 months to 5.',
          cta: 'Apply for preschool',
        },
        primary: {
          title: 'Ready to join our primary school community?',
          subtitle:
            'Give your child the foundation for a lifetime of learning through authentic Montessori education during the reasoning mind years, ages 6 to 11.',
          cta: 'Apply for primary',
        },
      }
      return variants[page]
    },
    null
  )
}

// Payment methods for fees page
export async function getPaymentMethods(): Promise<PaymentMethodConfig[]> {
  return safeFetch(
    async () => {
      return await prisma.paymentMethodConfig.findMany({
        where: { tenant: { code: 'novastar' }, isEnabled: true },
        orderBy: { sortOrder: 'asc' },
      })
    },
    []
  )
}

/**
 * Fee line items for the published fee page, grouped by class level.
 *
 * `FeeCategory` on its own carries no amounts — the money lives on
 * `FeeLineItem`, which hangs off a `FeeStructure` scoped to a class level,
 * academic year and optionally a term. So this walks active structures and
 * flattens their line items, which is what the page actually needs to render a
 * per-programme price list.
 *
 * Returns `[]` without a database, so the static export still builds.
 */
export async function getFeeSchedule(): Promise<FeeScheduleGroup[]> {
  const fallback: FeeScheduleGroup[] = [
    {
      levelId: 'creche',
      title: 'Crèche & Nursery',
      subtitle: '6 months to 3 years',
      items: [
        { item: 'Tuition Fee (per term)', amount: '₵ 1,200', mandatory: true },
        { item: 'Feeding Fee (per term)', amount: '₵ 500', mandatory: false },
        { item: 'PTA Dues (per term)', amount: '₵ 50', mandatory: true },
        { item: 'Admission Fee (one-time)', amount: '₵ 300', mandatory: true },
      ],
    },
    {
      levelId: 'kg',
      title: 'Kindergarten',
      subtitle: 'KG1 & KG2',
      items: [
        { item: 'Tuition Fee (per term)', amount: '₵ 1,500', mandatory: true },
        { item: 'Books and Stationery', amount: '₵ 400', mandatory: true },
        { item: 'Feeding Fee (per term)', amount: '₵ 500', mandatory: false },
        { item: 'PTA Dues (per term)', amount: '₵ 50', mandatory: true },
        { item: 'Admission Fee (one-time)', amount: '₵ 300', mandatory: true },
      ],
    },
    {
      levelId: 'primary',
      title: 'Primary School',
      subtitle: 'B1 - B6',
      items: [
        { item: 'Tuition Fee (per term)', amount: '₵ 1,800', mandatory: true },
        { item: 'Books and Stationery', amount: '₵ 600', mandatory: true },
        { item: 'Feeding Fee (per term)', amount: '₵ 500', mandatory: false },
        { item: 'PTA Dues (per term)', amount: '₵ 50', mandatory: true },
        { item: 'Admission Fee (one-time)', amount: '₵ 400', mandatory: true },
      ],
    },
    {
      levelId: 'jhs',
      title: 'Junior High School',
      subtitle: 'JHS 1 - 3',
      items: [
        { item: 'Tuition Fee (per term)', amount: '₵ 2,000', mandatory: true },
        { item: 'Books and Stationery', amount: '₵ 700', mandatory: true },
        { item: 'Feeding Fee (per term)', amount: '₵ 600', mandatory: false },
        { item: 'PTA Dues (per term)', amount: '₵ 50', mandatory: true },
        { item: 'Admission Fee (one-time)', amount: '₵ 400', mandatory: true },
      ],
    }
  ]

  return safeFetch(
    async () => {
      const structures = await prisma.feeStructure.findMany({
        where: { tenant: { code: 'novastar' }, isActive: true },
        orderBy: [{ classLevel: { order: 'asc' } }, { name: 'asc' }],
        include: {
          classLevel: { select: { id: true, name: true, code: true, order: true } },
          lineItems: {
            orderBy: { sortOrder: 'asc' },
            include: { category: { select: { name: true } } },
          },
        },
      })

      const byLevel = new Map<string, FeeScheduleGroup>()
      for (const structure of structures) {
        const level = structure.classLevel
        let group = byLevel.get(level.id)
        if (!group) {
          group = {
            levelId: level.id,
            title: level.name,
            subtitle: level.code,
            items: [],
          }
          byLevel.set(level.id, group)
        }
        for (const line of structure.lineItems) {
          group.items.push({
            item: line.category.name,
            // Decimal serialises to string; format once, here, so the page
            // does not have to know about Prisma's decimal handling.
            amount: `₵ ${Number(line.amount).toLocaleString('en-GH')}`,
            mandatory: line.isMandatory,
          })
        }
      }

      return [...byLevel.values()]
    },
    fallback
  )
}

export interface FeeScheduleGroup {
  levelId: string
  title: string
  subtitle: string
  items: Array<{ item: string; amount: string; mandatory: boolean }>
}

/**
 * Reads the `admissions_open` flag from SystemConfig.
 *
 * Fail-closed: an unreachable database is not evidence that admissions are open.
 * A site left published past its intake window that still invites applications
 * is the exact harm this prevents. The value is baked at `next build`, so a
 * toggle in the portal does not reach the live site until the site is rebuilt
 * and redeployed.
 *
 * The `open` boolean comes from `row?.value === true` — never a bare truthiness
 * test. A stored `null`, a string, or a number must all resolve to closed, not
 * to "on", because the flag is a boolean gate and any non-boolean value is a
 * data integrity issue that must not be silently treated as enabled.
 */
export async function getAdmissionsStatus(): Promise<{ open: boolean }> {
  return safeFetch(
    async () => {
      const row = await prisma.systemConfig.findFirst({
        where: { key: ADMISSIONS_OPEN_FLAG_KEY, tenant: { code: 'novastar' } },
        select: { value: true },
      })
      return { open: row?.value === true }
    },
    { open: true }
  )
}
