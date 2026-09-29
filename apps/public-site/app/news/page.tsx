import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@novastar/shared-ui'
import { formatDate } from '@novastar/shared-utils'
import { metadata } from '@/lib/metadata'

export { metadata }

// Placeholder news data (will be replaced by CMS content from portal)
const NEWS_ITEMS = [
  {
    id: '1',
    title: 'Novastar Achieves 100% Grade 1 in BECE Science 2021',
    slug: 'bece-science-success',
    excerpt: 'We are proud to announce that 100% of our JHS 3 students achieved Grade 1 in the BECE Science examination...',
    date: '2021-08-15',
    category: 'Achievement',
    image: '/news/bece-success.jpg',
  },
  {
    id: '2',
    title: 'New Science Lab Inaugurated',
    slug: 'new-science-lab',
    excerpt: 'Our brand-new science laboratory was inaugurated this week, equipped with modern equipment for hands-on learning...',
    date: '2026-06-10',
    category: 'Facilities',
    image: '/news/science-lab.jpg',
  },
  {
    id: '3',
    title: 'Montessori Parent Workshop',
    slug: 'montessori-parent-workshop',
    excerpt: 'Join us for a workshop on supporting Montessori learning at home. This event is open to all parents...',
    date: '2026-05-20',
    category: 'Events',
    image: '/news/parent-workshop.jpg',
  },
]

export default function NewsPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="bg-gradient-to-b from-primary/10 to-transparent py-16 md:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-responsive-h1 font-heading text-primary mb-4">Latest News</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Stay updated with the latest happenings at Novastar Montessori School.
          </p>
        </div>
      </section>

      {/* News Grid */}
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {NEWS_ITEMS.map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function NewsCard({ item }: { item: typeof NEWS_ITEMS[0] }) {
  return (
    <Link href={`/news/${item.slug}`} className="group">
      <Card className="h-full transition-transform group-hover:shadow-lg">
        <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded-t-lg overflow-hidden">
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            Image
          </div>
        </div>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-xl group-hover:text-primary transition-colors">
                {item.title}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {formatDate(item.date)} • {item.category}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-foreground/80">{item.excerpt}</p>
        </CardContent>
      </Card>
    </Link>
  )
}