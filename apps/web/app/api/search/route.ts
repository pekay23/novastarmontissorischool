import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@novastar/database'

// Search index for static public content
// This is a simple in-memory index built from the public page content
const STATIC_SEARCH_INDEX = [
  // Home page
  { url: '/', title: 'Novastar Montessori School', description: 'Authentic Montessori education from Crèche to Junior High in Kumasi, Ghana, integrated with Ghana Education Service standards.', type: 'page', category: 'Home' },
  { url: '/', title: 'Admissions Open', description: 'Enquiries for the 2026/27 academic year are being taken now. Apply for admission.', type: 'page', category: 'Home' },
  { url: '/', title: 'Mixed-Age Classrooms', description: 'Younger children learn by observing older peers, while older children build confidence and reinforce their knowledge by mentoring.', type: 'feature', category: 'Approach' },
  { url: '/', title: 'Self-Directed Learning', description: 'Uninterrupted work cycles allow children to follow their intellectual curiosity deeply, building true academic stamina.', type: 'feature', category: 'Approach' },
  { url: '/', title: 'GES Aligned', description: 'A pure, authentic Montessori foundation that seamlessly integrates with the standards and rigor required for the BECE.', type: 'feature', category: 'Approach' },
  { url: '/', title: 'Our Approach', description: 'We do not simply deliver lessons. We prepare an environment in which a child can teach themselves through dignified inquiry.', type: 'page', category: 'Home' },
  { url: '/', title: 'Campus Location', description: 'Our campus is in Ayeduase, Kumasi, on Ayeduase Road near the K-5 Junction traffic light.', type: 'page', category: 'Home' },

  // About page
  { url: '/about', title: 'About Novastar Montessori School', description: 'Our history, vision, and mission. Founded in 2016 in Ayeduase, Kumasi.', type: 'page', category: 'About' },
  { url: '/about', title: 'Vision', description: 'To provide a world-class Montessori education to children and prepare them to become responsible citizens capable of leading meaningful and morally sound adult life.', type: 'content', category: 'About' },
  { url: '/about', title: 'Mission', description: 'Novastar exists to provide a safe, developmentally appropriate environment for preschool and school age children. Our focus is to provide a stimulating early care and education experience which promotes each child\'s social/emotional, physical and cognitive development. Our goal is to support children\'s desire to be life-long learners.', type: 'content', category: 'About' },
  { url: '/about', title: 'History', description: 'Founded in 2016, Novastar Montessori School began as a small creche with a vision to bring authentic Montessori education to Kumasi. Over the years, we have grown into a full-fledged school offering programs from Creche through Junior High School.', type: 'content', category: 'About' },

  // Preschool page
  { url: '/preschool', title: 'Preschool', description: 'From six months to five years, the absorbent mind forms itself through touch, sound, and movement in a prepared environment.', type: 'page', category: 'Academics' },
  { url: '/preschool', title: 'Crèche & Nursery', description: 'Ages 6 months to 3 years. Practical Life, Sensorial, Language (English & Twi), Cultural Subjects.', type: 'program', category: 'Preschool' },
  { url: '/preschool', title: 'Kindergarten', description: 'Ages 3 to 5 years. Numeracy & Mathematics, Literacy & Phonics, Environmental Studies, Creative Arts.', type: 'program', category: 'Preschool' },

  // Primary School page
  { url: '/primary-school', title: 'Primary School', description: 'For children aged 6 to 11, the reasoning mind explores the Great Lessons, building research skills and academic stamina.', type: 'page', category: 'Academics' },
  { url: '/primary-school', title: 'Primary School (B1–B6)', description: 'English Language, Mathematics, Integrated Science, Asante Twi, Computing, History of Ghana.', type: 'program', category: 'Primary' },

  // Academics page
  { url: '/academics', title: 'Academics', description: 'Our curriculum approach. Montessori Method integrated with Ghana Education Service and NaCCA standards.', type: 'page', category: 'Academics' },
  { url: '/academics', title: 'Junior High School (JHS 1–3)', description: 'English Language, Mathematics, Integrated Science, Social Studies, Asante Twi, Computing.', type: 'program', category: 'Academics' },

  // Admissions page
  { url: '/admissions', title: 'Admissions', description: 'How to apply to Novastar Montessori School. Application process, requirements, and important dates.', type: 'page', category: 'Admissions' },
  { url: '/admissions', title: 'Apply for Admission', description: 'Start your journey at Novastar. Online application form for the 2026/27 academic year.', type: 'action', category: 'Admissions' },

  // Fees page
  { url: '/fees', title: 'Tuition & Fees', description: 'View our fee schedules for Crèche, Kindergarten, Primary School, and Junior High School. Tuition, books, feeding, PTA dues, and admission fees.', type: 'page', category: 'Admissions' },
  { url: '/fees', title: 'Fee Schedule', description: 'Tuition Fee per term, Books and Stationery, Feeding Fee, PTA Dues, Admission Fee (one-time).', type: 'content', category: 'Fees' },

  // News page
  { url: '/news', title: 'News', description: 'Latest updates and announcements from Novastar Montessori School.', type: 'page', category: 'Community' },

  // Events page
  { url: '/events', title: 'Events', description: 'Upcoming activities and important dates for the school community.', type: 'page', category: 'Community' },

  // Contact page
  { url: '/contact', title: 'Contact Us', description: 'Get in touch with Novastar Montessori School. Call, message, or visit our campus in Kumasi.', type: 'page', category: 'Contact' },
  { url: '/contact', title: 'Phone', description: 'Call the school office during weekdays.', type: 'contact', category: 'Contact' },
  { url: '/contact', title: 'Email', description: 'Email the school office for enquiries.', type: 'contact', category: 'Contact' },
  { url: '/contact', title: 'WhatsApp', description: 'Message us on WhatsApp for quick enquiries during office hours.', type: 'contact', category: 'Contact' },
  { url: '/contact', title: 'Address', description: 'Ayeduase Road near K-5 Junction traffic light, Kumasi, Ghana.', type: 'contact', category: 'Contact' },
  { url: '/contact', title: 'Office Hours', description: 'Monday – Friday: 7:00 AM – 4:00 PM.', type: 'contact', category: 'Contact' },
  { url: '/contact', title: 'Complaints', description: 'Parents and guardians are to channel all their grievances directly to the school administrator or the proprietress.', type: 'content', category: 'Contact' },

  // Policies
  { url: '/policies', title: 'Policies', description: 'School policies and guidelines.', type: 'page', category: 'About' },
  { url: '/accessibility', title: 'Accessibility', description: 'Our commitment to accessibility and inclusive education.', type: 'page', category: 'About' },
  { url: '/nondiscrimination', title: 'Non-Discrimination Policy', description: 'Novastar Montessori School does not discriminate on the basis of race, color, national or ethnic origin.', type: 'page', category: 'About' },
  { url: '/terms', title: 'Terms of Service', description: 'Terms and conditions for using this website.', type: 'page', category: 'Legal' },
  { url: '/privacy', title: 'Privacy Policy', description: 'How we collect, use, and protect your personal information.', type: 'page', category: 'Legal' },
]

// Dynamic content from database (news, events, etc.)
async function getDynamicContent() {
  try {
    const [news, events, programs] = await Promise.all([
      prisma.news.findMany({
        where: { tenant: { code: 'novastar' }, status: 'PUBLISHED', publishedAt: { lte: new Date() } },
        select: { id: true, title: true, excerpt: true, slug: true, publishedAt: true },
        take: 20,
      }),
      prisma.event.findMany({
        where: { tenant: { code: 'novastar' }, status: 'PUBLISHED', endDate: { gte: new Date() } },
        select: { id: true, title: true, description: true, slug: true, startDate: true, endDate: true },
        take: 20,
      }),
      prisma.classLevel.findMany({
        where: { tenant: { code: 'novastar' } },
        select: { id: true, name: true, code: true, description: true },
        orderBy: { order: 'asc' },
      }),
    ])

    const dynamic = [
      ...news.map(n => ({
        url: `/news/${n.slug}`,
        title: n.title,
        description: n.excerpt || '',
        type: 'news',
        category: 'News',
      })),
      ...events.map(e => ({
        url: `/events/${e.slug}`,
        title: e.title,
        description: e.description || '',
        type: 'event',
        category: 'Events',
      })),
      ...programs.map(p => ({
        url: `/academics#${p.id}`,
        title: p.name,
        description: p.description || '',
        type: 'program',
        category: 'Academics',
      })),
    ]

    return dynamic
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim().toLowerCase() || ''
  const limit = parseInt(searchParams.get('limit') || '20', 10)

  if (!query) {
    return NextResponse.json({ results: [], query: '' })
  }

  // Search static index
  const staticResults = STATIC_SEARCH_INDEX
    .filter(item => {
      const searchText = `${item.title} ${item.description} ${item.category}`.toLowerCase()
      return searchText.includes(query)
    })
    .map(item => ({
      ...item,
      score: calculateScore(query, item.title, item.description),
    }))
    .sort((a, b) => b.score - a.score)

  // Search dynamic content
  const dynamicContent = await getDynamicContent()
  const dynamicResults = dynamicContent
    .filter(item => {
      const searchText = `${item.title} ${item.description} ${item.category}`.toLowerCase()
      return searchText.includes(query)
    })
    .map(item => ({
      ...item,
      score: calculateScore(query, item.title, item.description),
    }))
    .sort((a, b) => b.score - a.score)

  // Combine and deduplicate by URL
  const allResults = [...staticResults, ...dynamicResults]
  const seen = new Set<string>()
  const uniqueResults = allResults
    .filter(item => {
      if (seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
    .slice(0, limit)

  return NextResponse.json({
    results: uniqueResults,
    query,
    total: uniqueResults.length,
  })
}

function calculateScore(query: string, title: string, description: string): number {
  const q = query.toLowerCase()
  const t = title.toLowerCase()
  const d = description.toLowerCase()

  let score = 0

  // Exact title match gets highest score
  if (t === q) score += 100
  // Title starts with query
  else if (t.startsWith(q)) score += 80
  // Title contains query as word
  else if (t.split(' ').includes(q)) score += 60
  // Title contains query
  else if (t.includes(q)) score += 40

  // Description matches
  if (d.includes(q)) score += 20

  // Word boundary matches in title
  const titleWords = t.split(/\s+/)
  if (titleWords.some(w => w.startsWith(q))) score += 10

  return score
}