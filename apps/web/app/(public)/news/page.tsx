import { cn } from '@novastar/shared-ui'
import { formatDate } from '@novastar/shared-utils'
import type { News } from '@prisma/client'

import { CARD_PAD, Card, CardTitle, HeroBand, SectionShell } from '@/components/marketing'
import { getPublishedNews } from '@/lib/data'
import { generateNewsMetadata } from '@/lib/metadata'

export const metadata = generateNewsMetadata()

/*
 * Content comes from the database. This page previously rendered three
 * hardcoded items — a "new science lab inaugurated", a "parent workshop", and a
 * 2021 BECE claim — as though they were real news, and each card linked to a
 * `/news/[slug]` route that does not exist, so all three 404'd. On a live
 * school site that is worse than an empty page: a parent could act on an event
 * that was never going to happen.
 *
 * `getPublishedNews` returns `[]` when there is no database at build time, so
 * the empty state below is what ships until real content is published.
 */
export default async function NewsPage() {
  const news = await getPublishedNews()

  return (
    <div className="min-h-screen">
      {/* Hero. The band wash is `--color-tint-warm` rather than the maroon-tinted
          `from-primary/10` every inner page carried before; `HeroBand` also owns
          the header clearance, which was re-stated per page. */}
      <HeroBand>
        <h1 className="font-serif text-5xl md:text-6xl mx-auto max-w-[18ch] text-center text-primary">Latest News</h1>
        <p className="mx-auto mt-6 max-w-[60ch] text-lg leading-relaxed text-foreground/85 text-center">
          Stay updated with the latest happenings at Novastar Montessori School.
        </p>
      </HeroBand>

      <SectionShell tone="canvas">
        {news.length === 0 ? (
          <Card tone="flat" className={cn(CARD_PAD, 'mx-auto max-w-2xl text-center bg-surface-container-low border-transparent')}>
            <h2 className="font-serif text-3xl text-primary">No news posted yet</h2>
            <p className="mt-4 text-lg text-foreground/85">
              We publish school news and term dates here as they happen. In the
              meantime, call or message the school office for anything you need.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {news.map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </SectionShell>
    </div>
  )
}

function NewsCard({ item }: { item: News }) {
  return (
    /*
      Not a link. There is no /news/[slug] route, so wrapping this in <Link>
      produced a card that navigated to a 404. Add the route before making
      these clickable again.
    */
    <Card tone="flat" className={cn(CARD_PAD, 'flex h-full flex-col gap-4 bg-surface-container-low border-transparent transition-all duration-700 hover:-translate-y-1 hover:shadow-floating')}>
      <CardTitle className="font-serif text-xl">{item.title}</CardTitle>
      <p className="text-sm text-foreground/70">
        {item.publishedAt ? formatDate(item.publishedAt) : null}
        {item.category ? ` • ${item.category}` : null}
      </p>
      <p className="text-lg leading-relaxed text-foreground/85">
        {item.excerptEn ?? item.bodyEn.slice(0, 180)}
      </p>
    </Card>
  )
}