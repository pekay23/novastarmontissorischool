/*
 * The public-site search matcher.
 *
 * Split out of `app/api/search/route.ts` so the ranking rules can be exercised
 * directly by `search-match.test.ts` — the API route is then a thin shell over
 * this module, and a ranking regression shows up as a failing test instead of
 * as "search returns the wrong page", which is the failure the owner reported.
 *
 * Matching is tokenised rather than substring, because substring matching is
 * what produced that report: the query "school fees" appears in no single
 * field verbatim, so it matched nothing even though both words are all over the
 * site. Each word is scored independently and results are ranked by how many
 * of the query's words an entry covers.
 */

export interface SearchCandidate {
  url: string
  title: string
  text: string
  type: string
  category: string
}

export interface ScoredCandidate extends SearchCandidate {
  score: number
  /** How many distinct query words this entry matched. */
  matched: number
  /** The strongest single-word score, used to gate the page-level bonus. */
  best: number
  /** Zero-based rank once sorted. */
  rank: number
}

export interface SearchResponse {
  results: ScoredCandidate[]
  query: string
  terms: string[]
  total: number
}

/** Words that carry no search intent and would otherwise match everything. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by',
  'as', 'is', 'are', 'be', 'do', 'does', 'did', 'has', 'have', 'had', 'i',
  'me', 'my', 'we', 'our', 'us', 'you', 'your', 'it', 'its', 'this', 'that',
  'with', 'from', 'about', 'into', 'can', 'could', 'would', 'should', 'will',
  'shall', 'may', 'might', 'must', 'so', 'if', 'then', 'than', 'there', 'here',
])

/** Below this length a typo correction matches too many unrelated words. */
const MIN_FUZZY_TOKEN_LENGTH = 4
/** Below this length a prefix match matches too many unrelated words. */
const MIN_PREFIX_LENGTH = 3
/** A heading- or URL-level match, as opposed to a body-text hit. */
const STRONG_MATCH_SCORE = 20
/** A row for the page itself outranks a section or subject row. */
const PAGE_BONUS = 25

/**
 * Word splitter that keeps apostrophes and hyphens inside words, so "crèche",
 * "6–11", "NaCCA" and "child's" stay one token each.
 */
const WORD_RE = /[\p{L}\p{N}'’\-]+/gu

export function splitWords(value: string): string[] {
  return value.toLowerCase().match(WORD_RE) ?? []
}

/**
 * Light plural/tense folding. Deliberately not a real stemmer: it only needs
 * the endings English actually inflects with here, and it must not be so
 * aggressive that "class" and "classes" diverge.
 */
export function variants(token: string): string[] {
  const out = [token]
  if (token.length <= 3) return out
  if (token.endsWith('ies')) out.push(token.slice(0, -3) + 'y')
  if (token.endsWith('es')) out.push(token.slice(0, -2))
  if (token.endsWith('s') && !token.endsWith('ss')) out.push(token.slice(0, -1))
  if (token.endsWith('ing') && token.length > 5) out.push(token.slice(0, -3))
  if (token.endsWith('ed') && token.length > 4) out.push(token.slice(0, -2))
  return out
}

/**
 * True when two strings differ by at most one edit — a substitute, an insert
 * or a delete. Returns false as soon as a second edit is needed, so it never
 * walks the whole string for an obvious mismatch.
 */
export function isOneEditApart(a: string, b: string): boolean {
  if (a === b) return true
  const longer = a.length >= b.length ? a : b
  const shorter = a.length >= b.length ? b : a
  if (longer.length - shorter.length > 1) return false

  let edits = 0
  let i = 0
  let j = 0
  while (i < longer.length && j < shorter.length) {
    if (longer[i] === shorter[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    // A substitution advances both; an insert or delete advances the longer.
    if (longer.length === shorter.length) j++
    i++
  }
  return true
}

/** Where a word appeared decides its weight: a heading is what a reader wants. */
const PASSAGES = [
  { field: 'title', exact: 42, prefix: 26, fuzzy: 13 },
  { field: 'url', exact: 30, prefix: 22, fuzzy: 10 },
  { field: 'category', exact: 16, prefix: 12, fuzzy: 6 },
  { field: 'text', exact: 9, prefix: 5, fuzzy: 3 },
] as const

function scoreTokenAgainst(
  words: string[],
  token: string,
  tokenVariants: Set<string>,
  weights: { exact: number; prefix: number; fuzzy: number },
): number {
  if (words.length === 0) return 0

  let best = 0
  for (const word of words) {
    let value = 0

    // Prefix either way: the index word may be longer than the query
    // ("kindergar" against "kindergarten") or the query longer than it
    // ("fees" against "fee").
    if (word.length >= MIN_PREFIX_LENGTH && word.startsWith(token)) {
      value = weights.prefix
    } else if (
      token.length >= MIN_PREFIX_LENGTH &&
      token.startsWith(word) &&
      word.length >= MIN_PREFIX_LENGTH
    ) {
      value = weights.prefix
    }

    // Stemmed equality outranks a prefix hit, so "fees" matching "fee"
    // scores above "fees" matching "feeschedule".
    for (const wordVariant of variants(word)) {
      if (tokenVariants.has(wordVariant)) {
        value = Math.max(value, weights.exact)
        break
      }
    }

    if (
      value < weights.exact &&
      token.length >= MIN_FUZZY_TOKEN_LENGTH &&
      Math.abs(word.length - token.length) <= 1 &&
      isOneEditApart(word, token)
    ) {
      value = Math.max(value, weights.fuzzy)
    }

    if (value > best) best = value
    if (best === weights.exact) break
  }
  return best
}

function scoreEntry(
  entry: SearchCandidate,
  tokens: string[],
  phrase: string,
  tokenVariantSets: Set<string>[],
): { score: number; matched: number; best: number } {
  const words: Record<string, string[]> = {
    title: splitWords(entry.title),
    url: splitWords(entry.url.replace(/\//g, ' ')),
    category: splitWords(entry.category),
    text: splitWords(`${entry.text} ${entry.title}`),
  }

  let score = 0
  let matched = 0
  let best = 0

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    let tokenScore = 0
    for (const passage of PASSAGES) {
      tokenScore = Math.max(
        tokenScore,
        scoreTokenAgainst(words[passage.field], token, tokenVariantSets[i], passage),
      )
      if (tokenScore === passage.exact) break
    }
    if (tokenScore > 0) {
      matched++
      score += tokenScore
      if (tokenScore > best) best = tokenScore
    }
  }

  // The whole query as written. Covers a visitor who types a real phrase
  // ("school fees") over the individual words.
  if (phrase.length > 2 && `${entry.title} ${entry.text}`.toLowerCase().includes(phrase)) {
    score += 60
  }

  // A page row is the page itself, so it is the most likely destination and
  // outranks an equally-relevant section or subject row.
  //
  // Gated on `best`: without the gate a page whose body merely contains a
  // fuzzy match outscored the actual page, so the typo "admisson" led with an
  // unrelated page instead of admissions. `best >= STRONG_MATCH_SCORE` means a
  // heading or URL-level match, which is evidence about the page as a whole
  // rather than about one sentence in it.
  if (matched > 0 && best >= STRONG_MATCH_SCORE && entry.type === 'page') score += PAGE_BONUS

  return { score, matched, best }
}

export interface SearchOptions {
  /** Stopwords to drop. Defaults to the built-in English list. */
  stopwords?: Set<string>
  /** How many rows to return. Default 20, capped at 50. */
  limit?: number
  /** Rows per page before collapsing. Default 3. */
  maxRowsPerPage?: number
}

/**
 * Ranks candidates against a raw query string.
 *
 * Coverage is the multiplier that makes multi-word queries behave: an entry
 * matching every word of the query outranks one matching a single word, which
 * stops "school fees" from being answered by whichever page happens to contain
 * the word "school".
 */
export function searchCandidates(
  candidates: SearchCandidate[],
  rawQuery: string,
  options: SearchOptions = {},
): SearchResponse {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50)
  const maxRowsPerPage = options.maxRowsPerPage ?? 3
  const stopwords = options.stopwords ?? STOPWORDS

  const trimmed = rawQuery.trim()
  if (!trimmed) return { results: [], query: rawQuery, terms: [], total: 0 }

  const normalised = trimmed.toLowerCase().replace(/\s+/g, ' ')
  const words = splitWords(normalised)
  const tokens = [...new Set(words.filter((w) => !stopwords.has(w)))]

  // A query made entirely of filler words is not a search. Falling back to the
  // stopwords themselves — which is what this did first — makes "the of and"
  // match a third of the index.
  if (tokens.length === 0) return { results: [], query: trimmed, terms: [], total: 0 }

  const tokenVariantSets = tokens.map((token) => new Set(variants(token)))

  const scored: ScoredCandidate[] = []
  for (const candidate of candidates) {
    const { score, matched, best } = scoreEntry(
      candidate,
      tokens,
      normalised,
      tokenVariantSets,
    )
    if (score <= 0 || matched === 0) continue

    const coverage = matched / tokens.length
    scored.push({
      ...candidate,
      score: Math.round(score * (0.4 + coverage) * 100) / 100,
      matched,
      best,
      rank: 0,
    })
  }

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))

  /*
   * Group by page so one page with twenty matching subjects cannot flood the
   * list and push every other page out of view. Three rows per page is enough
   * to show variety — "mathematics" still surfaces the subject on academics,
   * preschool and primary school as three distinct pages — while `matched` in
   * the response reports how many entries matched in total.
   */
  const perPage = new Map<string, ScoredCandidate[]>()
  for (const result of scored) {
    const bucket = perPage.get(result.url)
    if (bucket) bucket.push(result)
    else perPage.set(result.url, [result])
  }

  const results = [...perPage.values()]
    .flatMap((all) => all.slice(0, maxRowsPerPage))
    .slice(0, limit)
    .map((result, index) => ({ ...result, rank: index }))

  return {
    results,
    query: trimmed,
    terms: tokens,
    total: results.length,
  }
}
