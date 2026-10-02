import { type Metadata } from 'next'

export const SCHOOL_INFO = {
  name: 'Novastar Montessori School',
  shortName: 'Novastar',
  location: 'Ayeduase New Site, K-5 Junction, Ayeduase Road, Kumasi, Ashanti Region, Ghana',
  phone: '+233 24 493 5251',
  /** Digits only, for tel: and wa.me links. */
  phoneHref: '+233244935251',
  whatsapp: '233244935251',
  email: 'info@novastarmontissorischool.com',
  established: 2016,
  website: 'https://novastarmontissorischool.com',
  description: 'Bringing quality care and experience to learning through authentic Montessori education that nurtures each child\'s natural curiosity, independence, and love for discovery.',
  motto: 'Learning Through Discovery',
  /**
   * Single source of truth for opening hours. Pages must not restate these —
   * a parent calling at the wrong hour because two sections disagreed is a
   * worse failure than the duplication that caused it.
   */
  hours: [
    { days: 'Monday – Friday', time: '7:30 AM – 5:30 PM' },
    { days: 'Saturday', time: '9:00 AM – 1:00 PM' },
    { days: 'Sunday', time: 'Closed' },
  ],
  /** Google Maps keyless embed. `output=embed` needs no API key. */
  mapEmbedUrl:
    'https://www.google.com/maps?q=Ayeduase+New+Site%2C+K-5+Junction%2C+Ayeduase+Road%2C+Kumasi%2C+Ashanti+Region%2C+Ghana&output=embed',
  mapLinkUrl:
    'https://www.google.com/maps/search/?api=1&query=Ayeduase+New+Site%2C+K-5+Junction%2C+Ayeduase+Road%2C+Kumasi%2C+Ashanti+Region%2C+Ghana',
} as const

export const baseMetadata: Metadata = {
  /* Required so relative Open Graph / Twitter image URLs (e.g. `/og-image.png`)
     resolve to absolute URLs. Without it Next falls back to
     `http://localhost:3000` and every social share renders broken. */
  metadataBase: new URL(SCHOOL_INFO.website),
  title: {
    default: 'Novastar Montessori School — Authentic Montessori Education in Kumasi, Ghana',
    template: '%s | Novastar Montessori School',
  },
  description: 'Novastar Montessori School in Kumasi offers authentic Montessori education from Crèche to Junior High. Ghanaian curriculum + Montessori method. Book a visit or apply online.',
  keywords: [
    'Montessori school',
    'Kumasi',
    'Ghana',
    'education',
    'preschool',
    'primary school',
    'junior high',
    'Montessori education',
    'BECE prep',
    'Ghana education',
    'NaCCA',
    'GES',
  ],
  authors: [{ name: 'Novastar Montessori School' }],
  creator: 'Novastar Montessori School',
  publisher: 'Novastar Montessori School',
  openGraph: {
    type: 'website',
    locale: 'en_GH',
    url: SCHOOL_INFO.website,
    siteName: SCHOOL_INFO.name,
    images: [
      {
        // PNG, not SVG: Facebook, X and LinkedIn do not render SVG previews, so
        // the SVG version this replaced showed up as a blank card in every share.
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Novastar Montessori School — Campus and Classrooms',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@NovastarMontessori',
    creator: '@NovastarMontessori',
  },
  formatDetection: {
    email: false,
    telephone: false,
  },
  alternates: {
    canonical: SCHOOL_INFO.website,
  },
}

export function generateHomeMetadata(): Metadata {
  return {
    ...baseMetadata,
    title: 'Authentic Montessori Education — Crèche to Junior High',
    description: 'Novastar Montessori School in Kumasi: mixed-age classrooms, 3-hour work cycles, GES-aligned curriculum. Book a classroom visit today.',
  }
}

export function generateAboutMetadata(): Metadata {
  return {
    ...baseMetadata,
    title: 'About Novastar Montessori',
    description: 'Learn about Novastar Montessori School\'s history, philosophy, and approach to authentic Montessori education in Kumasi, Ghana.',
  }
}

export function generateAcademicsMetadata(): Metadata {
  return {
    ...baseMetadata,
    title: 'Academic Programs — Crèche to JHS',
    description: 'Explore Novastar\'s Montessori programs: Crèche & Nursery, Kindergarten, Lower Primary, Upper Primary, and Junior High School. GES and NaCCA aligned.',
  }
}

export function generateAdmissionsMetadata(): Metadata {
  return {
    ...baseMetadata,
    title: 'Admissions — Apply Online',
    description: 'Apply to Novastar Montessori School. Simple online application for Crèche through Junior High. Admissions open for 2026/27 academic year.',
  }
}

export function generateFeesMetadata(): Metadata {
  return {
    ...baseMetadata,
    title: 'Fee Structure — Tuition & Payment Options',
    description: 'Transparent fee structure for all Novastar Montessori programs. Term-based tuition, payment plans, and sibling discounts available.',
  }
}

export function generateNewsMetadata(): Metadata {
  return {
    ...baseMetadata,
    title: 'News & Updates',
    description: 'Latest news, announcements, and updates from Novastar Montessori School. Term dates, events, and school achievements.',
  }
}

export function generateEventsMetadata(): Metadata {
  return {
    ...baseMetadata,
    title: 'Events & Calendar',
    description: 'Upcoming events at Novastar Montessori: open mornings, parent workshops, school performances, and academic calendar dates.',
  }
}

export function generateContactMetadata(): Metadata {
  return {
    ...baseMetadata,
    title: 'Contact Us — Visit or Get in Touch',
    description: 'Contact Novastar Montessori School. Phone, WhatsApp, email, and address. Schedule a visit Monday–Friday, 7:30am–5:30pm.',
  }
}
