'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search as SearchIcon, X, ArrowRight, ExternalLink } from 'lucide-react'
import { cn } from '@novastar/shared-ui'

interface SearchResult {
  url: string
  title: string
  text: string
  type: string
  category: string
  score: number
  matches: number
}

const getCategoryColor = (category: string) => {
  switch (category) {
    case 'Home': return 'bg-primary/10 text-primary'
    case 'About': return 'bg-secondary/10 text-secondary'
    case 'Academics': return 'bg-accent-warm/20 text-accent-warm-dark'
    case 'Preschool':
    case 'Primary': return 'bg-tint-warm text-primary'
    case 'Admissions':
    case 'Fees': return 'bg-primary/10 text-primary'
    case 'Community':
    case 'News':
    case 'Events': return 'bg-secondary/10 text-secondary'
    case 'Contact': return 'bg-accent-warm/20 text-accent-warm-dark'
    case 'Legal': return 'bg-muted text-muted-foreground'
    default: return 'bg-muted text-muted-foreground'
  }
}

export default function SearchPageClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [results, setResults] = useState<SearchResult[]>([])
  const [terms, setTerms] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)

  const navigateToResult = useCallback((result: SearchResult) => {
    if (result.url.startsWith('/')) {
      router.push(result.url)
    } else {
      window.open(result.url, '_blank')
    }
    setShowResults(false)
  }, [router])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(async () => {
      if (!query.trim()) {
        setResults([])
        setTerms([])
        setShowResults(false)
        return
      }

      setIsLoading(true)
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=20`)
        const data = await response.json()
        setResults(data.results || [])
        setTerms(data.terms || [])
        setShowResults(true)
      } catch {
        setResults([])
        setTerms([])
        setShowResults(true)
      } finally {
        setIsLoading(false)
      }
    }, 200)

    return () => clearTimeout(handler)
  }, [query])

  // Update URL when query changes
  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    if (query.trim()) {
      params.set('q', query)
    } else {
      params.delete('q')
    }
    router.replace(`/search?${params.toString()}`, { scroll: false })
  }, [query, router, searchParams])

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!showResults || results.length === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => (prev + 1) % results.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev - 1 + results.length) % results.length)
          break
        case 'Enter':
          e.preventDefault()
          if (selectedIndex >= 0 && results[selectedIndex]) {
            navigateToResult(results[selectedIndex])
          }
          break
        case 'Escape':
          setShowResults(false)
          inputRef.current?.blur()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showResults, results, selectedIndex, navigateToResult])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim() && results.length > 0) {
      navigateToResult(results[0])
    }
  }

  const handleClear = () => {
    setQuery('')
    setResults([])
    setShowResults(false)
    inputRef.current?.focus()
  }

  return (
    <div className="min-h-screen bg-purple-whisper">
      <SearchHero query={query} onQueryChange={setQuery} inputRef={inputRef} onClear={handleClear} onSubmit={handleSubmit} isLoading={isLoading} />

      <section className="container section-y">
        <div className="max-w-3xl mx-auto">
          {query.trim() && (
            <div className="mb-6 flex items-center gap-3 text-muted-foreground">
              <span className="type-label uppercase">Results for</span>
              <span className="font-serif text-xl text-foreground">"{query}"</span>
              <span className="text-sm">({results.length} {results.length === 1 ? 'result' : 'results'})</span>
            </div>
          )}

          {query.trim() && !isLoading && results.length === 0 && (
            <div className="text-center py-16">
              <SearchIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" aria-hidden="true" />
              <h2 className="font-serif text-2xl text-foreground mb-2">No results found</h2>
              <p className="text-muted-foreground mb-6">
                We couldn&apos;t find anything matching "{query}".
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
                <span>Try:</span>
                <ul className="flex flex-wrap items-center gap-3 list-disc pl-4">
                  <li>Checking your spelling</li>
                  <li>Using fewer keywords</li>
                  <li>Trying more general terms</li>
                </ul>
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-3" role="list" aria-label="Search results">
              {results.map((result, index) => (
                <SearchResultCard
                  key={`${result.url}-${index}`}
                  result={result}
                  terms={terms}
                  isSelected={index === selectedIndex}
                  onClick={() => navigateToResult(result)}
                />
              ))}
            </div>
          )}

          {!query.trim() && (
            <div className="text-center py-16">
              <SearchIcon className="h-16 w-16 mx-auto mb-6 text-muted-foreground/30" aria-hidden="true" />
              <h2 className="font-serif text-3xl text-foreground mb-4">Search Novastar</h2>
              <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
                Find information about our programmes, admissions, fees, news, events, and more.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <PopularSearches onSearch={setQuery} inputRef={inputRef} />
              </div>
            </div>
          )}
        </div>
      </section>

      <SearchFooter />
    </div>
  )
}

function SearchHero({
  query,
  onQueryChange,
  inputRef,
  onClear,
  onSubmit,
  isLoading,
}: {
  query: string
  onQueryChange: (q: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  onClear: () => void
  onSubmit: (e: React.FormEvent) => void
  isLoading: boolean
}) {
  return (
    <section className="relative w-full py-16 md:py-24 lg:py-32 overflow-hidden">
      <div className="absolute inset-0 bg-purple-gradient-diagonal" />
      <div className="container relative z-10 mx-auto px-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-primary mb-4">
              Search Novastar
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground">
              Find programmes, admissions info, fees, news, events, and more.
            </p>
          </div>

          <form onSubmit={onSubmit} className="relative">
            <label htmlFor="search-input" className="sr-only">
              Search the site
            </label>
            <div className="relative">
              <SearchIcon
                className={cn(
                  'absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground',
                  query ? 'opacity-50' : 'opacity-100'
                )}
                aria-hidden="true"
              />
              <input
                ref={inputRef}
                id="search-input"
                type="search"
                value={query}
                onChange={e => onQueryChange(e.target.value)}
                placeholder="Search programmes, admissions, fees, news, events..."
                className={cn(
                  'w-full h-14 pl-12 pr-14 text-lg bg-background border border-border rounded-xl',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
                  'placeholder:text-muted-foreground/50',
                  'transition-colors duration-fast'
                )}
                autoComplete="off"
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={onClear}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-fast"
                  aria-label="Clear search"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
              {isLoading && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
                  <span>Searching...</span>
                </div>
              )}
            </div>
          </form>
        </div>
      </div>
    </section>
  )
}

function SearchResultCard({
  result,
  terms,
  isSelected,
  onClick,
}: {
  result: SearchResult
  terms: string[]
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <article
      role="listitem"
      className={cn(
        'group relative flex items-start gap-4 p-4 rounded-xl border border-border bg-surface-container-lowest',
        'transition-all duration-fast',
        'hover:border-primary/30 hover:shadow-raised hover:-translate-y-0.5',
        isSelected && 'border-primary bg-primary/5 ring-1 ring-primary/20',
        'focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20'
      )}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
    >
      <div className="shrink-0 mt-0.5">
        <span className={cn('inline-flex items-center justify-center w-10 h-10 rounded-lg', getCategoryColor(result.category))}>
          {result.category.charAt(0)}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={cn('type-eyebrow uppercase', getCategoryColor(result.category))}>
            {result.category}
          </span>
          {result.type !== 'page' && (
            <span className="type-eyebrow uppercase text-muted-foreground bg-muted px-2 py-0.5 rounded-xs">
              {result.type}
            </span>
          )}
          {result.matches > 1 && (
            <span className="type-eyebrow uppercase text-muted-foreground/70">
              +{result.matches - 1} more on this page
            </span>
          )}
        </div>
        <h3 className="font-serif text-lg text-foreground group-hover:text-primary transition-colors duration-fast">
          <Highlight text={result.title} terms={terms} />
        </h3>
        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
          <Highlight text={result.text} terms={terms} />
        </p>
        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <span className="font-mono">{result.url}</span>
          <ExternalLink className="h-3 w-3 opacity-50 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
        </div>
      </div>
      <ArrowRight
        className={cn(
          'shrink-0 h-5 w-5 text-muted-foreground transition-all duration-fast',
          'group-hover:text-primary group-hover:translate-x-1',
          isSelected && 'text-primary translate-x-1'
        )}
        aria-hidden="true"
      />
    </article>
  )
}

/**
 * Marks the visitor's own words inside a result, so the reason a row matched is
 * visible without re-reading the whole snippet.
 *
 * Folding matches the API's own stem rule, so "fees" marks "Fee" and
 * "programmes" marks "programme" — a highlight that is stricter than the
 * matcher would show a row the visitor cannot explain.
 */
function highlightTerms(terms: string[]): string[] {
  const out = new Set<string>()
  for (const term of terms.filter((t) => t.length >= 2)) {
    out.add(term)
    if (!term.endsWith('s')) out.add(`${term}s`)
    if (term.endsWith('ies') && term.length > 5) out.add(`${term.slice(0, -3)}y`)
    // "fees" must mark "Fee", so de-pluralising down to three letters is
    // allowed; two-letter stems are not, because "fees" would then mark
    // every word beginning "fe". "class" never loses its s.
    if (term.endsWith('es')) {
      const stem = term.slice(0, -2)
      if (stem.length >= 3) out.add(stem)
    }
    if (term.endsWith('s') && !term.endsWith('ss')) {
      const stem = term.slice(0, -1)
      if (stem.length >= 3) out.add(stem)
    }
  }
  return [...out]
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const usableTerms = highlightTerms(terms)
  if (usableTerms.length === 0) return <>{text}</>

  const escaped = usableTerms
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  // The capture group must span the WHOLE match, including the trailing word
  // characters. A group covering only the term itself makes `split` discard
  // the rest of the word — "kindergar" would swallow the "ten" in
  // "kindergarten".
  const pattern = new RegExp(`((?:${escaped.join('|')})[\\p{L}\\p{N}]*)`, 'giu')
  const parts = text.split(pattern).filter((part) => part !== undefined && part !== '')

  return (
    <>
      {parts.map((part, index) =>
        usableTerms.some((term) => part.toLowerCase().startsWith(term)) ? (
          <mark key={index} className="rounded-xs bg-primary/20 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  )
}

function PopularSearches({ onSearch, inputRef }: { onSearch: (q: string) => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const popular = [
    'admissions',
    'fees',
    'preschool',
    'primary school',
    'calendar',
    'contact',
    'academics',
    'events',
  ]

  return (
    <div className="flex flex-wrap justify-center gap-2" role="list" aria-label="Popular searches">
      {popular.map(term => (
        <button
          key={term}
          type="button"
          onClick={() => {
            onSearch(term)
            inputRef.current?.focus()
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-primary transition-all duration-fast"
          role="listitem"
        >
          <SearchIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          {term}
        </button>
      ))}
    </div>
  )
}

function SearchFooter() {
  return (
    <footer className="border-t border-border bg-surface-container-low py-12">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto text-center md:text-left">
          <div>
            <h3 className="font-serif text-lg text-primary mb-3">Quick Links</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/admissions" className="hover:text-primary transition-colors">Admissions</Link></li>
              <li><Link href="/fees" className="hover:text-primary transition-colors">Tuition & Fees</Link></li>
              <li><Link href="/academics" className="hover:text-primary transition-colors">Academics</Link></li>
              <li><Link href="/contact" className="hover:text-primary transition-colors">Contact Us</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-serif text-lg text-primary mb-3">Programmes</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/preschool" className="hover:text-primary transition-colors">Preschool (6mo–5yr)</Link></li>
              <li><Link href="/primary-school" className="hover:text-primary transition-colors">Primary (6–11yr)</Link></li>
              <li><Link href="/academics#jhs" className="hover:text-primary transition-colors">Junior High (11–14yr)</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-serif text-lg text-primary mb-3">Community</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/news" className="hover:text-primary transition-colors">News</Link></li>
              <li><Link href="/events" className="hover:text-primary transition-colors">Events</Link></li>
              <li><Link href="/about" className="hover:text-primary transition-colors">About Us</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 pt-8 border-t border-border text-center text-sm text-muted-foreground">
          <p>Novastar Montessori School &copy; {new Date().getFullYear()} &mdash; Ayeduase, Kumasi, Ghana</p>
        </div>
      </div>
    </footer>
  )
}