import { describe, expect, test } from 'bun:test'

import { searchCandidates, variants, isOneEditApart, type SearchCandidate } from '../lib/search-match'

const CANDIDATES: SearchCandidate[] = [
  { url: '/fees', title: 'Fee Structure', text: 'Tuition Fee (per term), PTA Dues, Admission Fee (one-time).', type: 'page', category: 'Fees' },
  { url: '/fees', title: 'Junior High School fees', text: 'Junior High School (JHS 1 - 3): Tuition Fee ₵ 2,000, Books and Stationery ₵ 700.', type: 'program', category: 'Fees' },
  { url: '/admissions', title: 'Admissions', text: 'How to apply to Novastar Montessori School. Application process and requirements.', type: 'page', category: 'Admissions' },
  { url: '/admissions', title: 'Admission Process heading', text: 'Admission Process — Simple 4-step process to get your child enrolled.', type: 'section', category: 'Admissions' },
  { url: '/primary-school', title: 'Five Great Lessons intro', text: 'Cosmic Education. The Five Great Lessons open the primary curriculum.', type: 'section', category: 'Primary' },
  { url: '/primary-school', title: 'Ghanaian Language Twi', text: 'Fluency in Twi and appreciation of local literature and cultural context.', type: 'subject', category: 'Primary' },
  { url: '/policies', title: 'Policy 9: Collecting Your Child by a Third Party', text: 'Written consent and admission contact details are required before release.', type: 'policy', category: 'About' },
]

function urlsFor(query: string, limit = 20): string[] {
  return searchCandidates(CANDIDATES, query, { limit }).results.map((r) => r.url)
}

describe('the failure the owner reported', () => {
  test('a multi-word phrase matches on words, not on the whole string', () => {
    // "school fees" is not a substring of any single field, which is exactly why
    // the old substring search returned nothing.
    expect(urlsFor('school fees')).toContain('/fees')
    expect(urlsFor('school fees').length).toBeGreaterThan(0)
  })

  test('the fee page is the destination for a fee query', () => {
    const results = searchCandidates(CANDIDATES, 'school fees').results
    // The first row is a fee *row* on the fee page, which is both the more
    // specific answer and the correct destination; the page's own row must
    // still be among the results rather than crowded out by its children.
    expect(results[0].url).toBe('/fees')
    expect(results.map((r) => r.title)).toContain('Fee Structure')
  })

  test('a real page is found by its own name', () => {
    expect(urlsFor('admissions')).toContain('/admissions')
    expect(urlsFor('fees')).toContain('/fees')
    expect(urlsFor('great lessons')).toContain('/primary-school')
  })
})

describe('typos and partial words', () => {
  test('one edit away still finds the page', () => {
    expect(urlsFor('admisson')).toContain('/admissions')
  })

  test('the typo does not promote an unrelated page', () => {
    // The gate on the page-level bonus exists for this: the policy above merely
    // contains the word "admission" in its body, and without the gate that page
    // outscored the admissions page for the typo.
    const top = searchCandidates(CANDIDATES, 'admisson', { limit: 1 }).results[0]
    expect(top?.title).toBe('Admission Process heading')
  })

  test('an incomplete word resolves', () => {
    expect(urlsFor('admiss')).toContain('/admissions')
  })
})

describe('plurals and stems', () => {
  test('variants fold the endings English actually inflects', () => {
    expect(variants('fees')).toContain('fee')
    expect(variants('programmes')).toContain('programme')
    expect(variants('schools')).toContain('school')
    expect(variants('class')).toEqual(['class']) // never loses its s
    expect(variants('twi')).toEqual(['twi']) // too short to fold
  })

  test('a singular query finds a plural entry', () => {
    expect(urlsFor('fee')).toContain('/fees')
  })

  test('a plural query finds a singular entry', () => {
    const plural: SearchCandidate[] = [
      { url: '/x', title: 'Class Room', text: 'A classroom environment.', type: 'page', category: 'Primary' },
    ]
    const found = searchCandidates(plural, 'classes').results
    expect(found.length).toBe(1)
  })
})

describe('isOneEditApart', () => {
  test('accepts a substitution', () => {
    expect(isOneEditApart('admission', 'admisson')).toBe(true)
  })

  test('accepts one insert or one delete', () => {
    // "admissons" is "admissions" with the i deleted, so this is one edit,
    // not two — the pair below is the two-edit case.
    expect(isOneEditApart('admissions', 'admissons')).toBe(true)
    expect(isOneEditApart('fe', 'fee')).toBe(true)
    expect(isOneEditApart('fees', 'fee')).toBe(true)
  })

  test('rejects two edits', () => {
    expect(isOneEditApart('admission', 'admissons')).toBe(false)
    expect(isOneEditApart('montessori', 'montessarix')).toBe(false)
  })
})

describe('stopwords', () => {
  test('filler words do not make everything match', () => {
    expect(urlsFor('the of and')).toEqual([])
  })

  test('a question still finds the page behind it', () => {
    expect(urlsFor('how do I apply')).toContain('/admissions')
  })
})

describe('ranking', () => {
  test('an entry matching every word outranks one matching one word', () => {
    const results = searchCandidates(CANDIDATES, 'school fees').results
    const both = results.find((r) => r.title === 'Junior High School fees')
    const one = results.find((r) => r.title === 'Admissions')
    expect(both).toBeDefined()
    expect(one).toBeDefined()
    expect(both!.score).toBeGreaterThan(one!.score)
  })

  test('matched and coverage are reported per result', () => {
    const [top] = searchCandidates(CANDIDATES, 'school fees').results
    expect(top.matched).toBe(2)
  })

  test('nonsense returns nothing rather than everything', () => {
    expect(urlsFor('zzzzz')).toEqual([])
  })

  test('rows are capped per page and the rest are still counted', () => {
    const many: SearchCandidate[] = Array.from({ length: 12 }, (_, i) => ({
      url: '/academics',
      title: `Subject ${i}`,
      text: 'A subject in the curriculum.',
      type: 'subject',
      category: 'Academics',
    }))
    const results = searchCandidates(many, 'subject').results
    expect(results.length).toBeLessThanOrEqual(3)
    expect(results.every((r) => r.url === '/academics')).toBe(true)
  })
})

describe('empty input', () => {
  test('an empty query returns an empty response', () => {
    const response = searchCandidates(CANDIDATES, '   ')
    expect(response.results).toEqual([])
    expect(response.terms).toEqual([])
  })
})
