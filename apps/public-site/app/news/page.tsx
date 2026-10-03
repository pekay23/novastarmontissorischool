import { Card, CardContent, CardHeader, CardTitle } from '@novastar/shared-ui'
import { formatDate } from '@novastar/shared-utils'
import type { News } from '@prisma/client'
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
      <section className="bg-gradient-to-b from-primary/10 to-transparent py-16 md:py-20">
        <div className="container">
          <h1 className="text-responsive-h1 font-heading text-primary mb-4">Latest News</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Stay updated with the latest happenings at Novastar Montessori School.
          </p>
        </div>
      </section>

      <section className="section-y">
        <div className="container">
          {news.length === 0 ? (
            <div className="mx-auto max-w-2xl rounded-xl border border-border bg-surface p-10 text-center">
              <h2 className="mb-2 font-heading text-xl font-semibold text-primary">
                No news posted yet
              </h2>
              <p className="text-muted-foreground">
                We publish school news and term dates here as they happen. In the
                meantime, call or message the school office for anything you need.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {news.map((item) => (
                <NewsCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </section>
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
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-xl">{item.title}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {item.publishedAt ? formatDate(item.publishedAt) : null}
          {item.category ? ` • ${item.category}` : null}
        </p>
      </CardHeader>
      <CardContent>
        <p className="text-foreground/80">{item.excerptEn ?? item.bodyEn.slice(0, 180)}</p>
      </CardContent>
    </Card>
  )
}