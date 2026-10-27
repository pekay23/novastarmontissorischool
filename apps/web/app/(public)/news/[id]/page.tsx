import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { cache } from 'react'
import { HeroBand, SectionShell } from '@/components/marketing'
import { getPublishedNewsItem } from '@/lib/data'

const loadArticle = cache(getPublishedNewsItem)

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const article = await loadArticle(id)
  if (!article) return { title: 'News item not found' }
  return {
    title: article.title,
    description: article.excerptEn ?? article.bodyEn.slice(0, 160),
    alternates: { canonical: `/news/${encodeURIComponent(article.id)}/` },
  }
}

export default async function NewsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const article = await loadArticle(id)
  if (!article) notFound()
  return (
    <article>
      <HeroBand tone="purple">
        <div className="mx-auto max-w-3xl space-y-5">
          <Link href="/news" className="text-sm underline underline-offset-4">
            Back to school news
          </Link>
          <h1 className="font-serif text-4xl text-primary sm:text-5xl">
            {article.title}
          </h1>
          {article.publishedAt && (
            <time
              className="block text-sm text-muted-foreground"
              dateTime={article.publishedAt.toISOString()}
            >
              {new Intl.DateTimeFormat('en-GH', {
                dateStyle: 'long',
                timeZone: 'Africa/Accra',
              }).format(article.publishedAt)}
            </time>
          )}
        </div>
      </HeroBand>
      <SectionShell tone="canvas">
        <div className="mx-auto max-w-3xl whitespace-pre-wrap text-lg leading-relaxed">
          {article.bodyEn}
        </div>
      </SectionShell>
    </article>
  )
}
