import { type Metadata } from 'next'

export const metadata: Metadata = {
  title: {
    default: 'Novastar Montessori School — Quality Montessori Education in Kumasi, Ghana',
    template: `%s | Novastar Montessori School`,
  },
  description: 'Novastar Montessori School in Kumasi offers authentic Montessori education from Creche to JHS. Ghanaian curriculum + Montessori method. Apply online now.',
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
    url: 'https://novastarmontissorischool.com',
    siteName: 'Novastar Montessori School',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'Novastar Montessori School',
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
    canonical: 'https://novastarmontissorischool.com',
  },
}

// School metadata from branding config
export const SCHOOL_INFO = {
  name: 'Novastar Montessori School',
  location: 'Ayeduase New Site, K-5 Junction, Ayeduase Road, Kumasi, Ashanti Region, Ghana',
  phone: '+233 24 493 5251',
  email: 'info@novastarmontissorischool.com',
  established: 2016,
  website: 'https://novastarmontissorischool.com',
  description: 'Bringing quality care and experience to learning through authentic Montessori education that nurtures each child\'s natural curiosity, independence, and love for discovery.',
  motto: 'Learning Through Discovery',
} as const

// Programs
export const PROGRAMS = [
  {
    id: 'creche',
    name: 'Creche & Nursery',
    age: '6 months – 3 years',
    description: 'A nurturing Montessori toddler environment designed to support separation anxiety and independence.',
    icon: 'baby-carriage',
  },
  {
    id: 'kindergarten',
    name: 'Kindergarten',
    age: '4-5 years (KG1, KG2)',
    description: 'Practical life, sensorial, language, math, and cultural activities following Montessori principles.',
    icon: 'book-open',
  },
  {
    id: 'lower-primary',
    name: 'Lower Primary',
    age: '6-8 years (B1, B2, B3)',
    description: 'Montessori materials integrated with Ghana Education Service standards for a strong foundation.',
    icon: 'graduation-cap',
  },
  {
    id: 'upper-primary',
    name: 'Upper Primary',
    age: '9-11 years (B4, B5, B6)',
    description: 'Advanced Montessori materials with NaCCA standards, including BECE preparation.',
    icon: 'school',
  },
  {
    id: 'jhs',
    name: 'Junior High School',
    age: '12-15 years (JHS 1-3)',
    description: 'Common Core Programme with BECE preparation, combining academic excellence with Montessori values.',
    icon: 'award',
  },
] as const

export type Program = (typeof PROGRAMS)[number]

// Testimonials (placeholder until real ones provided)
export const TESTIMONIALS = [
  {
    name: 'Parent of KG2 Student',
    quote: 'Since starting at Novastar, my daughter has become so much more independent and confident. The teachers are amazing!',
    relation: 'Parent',
  },
  {
    name: 'Parent of B3 Student',
    quote: 'The blend of Montessori and Ghanaian curriculum gives our children the best of both worlds. Practical learning through play is truly effective.',
    relation: 'Parent',
  },
] as const