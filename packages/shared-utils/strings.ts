export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

/**
 * A URL-safe slug: lowercase, hyphen-separated, no accents.
 *
 * Accents are TRANSLITERATED, not deleted, and the order of the two steps is what
 * makes that possible. `\p{Diacritic}` can only match a combining mark, and an
 * accented letter is only a base character plus one once the string has been
 * decomposed — so NFD first, strip second. `Ünïcodé Ñame` becomes
 * `unicode-name`, where it used to become `ncod-ame`.
 *
 * Deleting rather than transliterating was not cosmetic. `[^\w\s-]` without the
 * `u` flag is ASCII-only, so every non-ASCII letter was removed outright, and the
 * result was a *different string* rather than a mangled one: two different names
 * could land on the same slug with nothing to tell them apart. Ghanaian names are
 * overwhelmingly ASCII so this is rare in practice, but the function is exported
 * and any accented display name reaches it.
 *
 * `\p{L}`/`\p{N}` in the stripping step rather than `\w`, so letters and digits
 * outside ASCII survive instead of vanishing — "Καλημέρα" keeps its letters and
 * loses only its accent, rather than collapsing to the empty string the ASCII
 * class produced. `_` stays in the allowed set so the `[\s_-]+` collapse below
 * still treats it as a separator; leaving it out turned `--a__b--` into `ab`.
 *
 * A handful of letters have no canonical decomposition — `ø`, `ł`, `ß`, `æ`, `đ`
 * — so transliteration has nothing to decompose and they are preserved as
 * themselves: `Bjørn` -> `bjørn`, `Łódź` -> `łodz`. Inventing `ø` -> `o` would be
 * a guess about someone's name, and the output is still a valid URL path segment
 * once percent-encoded. Note that `é` and `ü` ARE decomposed, so `Größe` becomes
 * `große` and `Münster` becomes `munster`; the rule is what Unicode can decompose,
 * and it is deliberately not "whatever looks like an ASCII letter".
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// --- Deep Clone ---

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// --- Debounce ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- debounce requires any[] for generic function args
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

// --- Retry ---

export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay * attempt))
      }
    }
  }
  throw lastError!
}

// ============================================================================
// Class position / ranking
// ============================================================================

/**
 * A student eligible for ranking.
 *
 * `displayName` is optional but recommended for the deterministic tie-break
 * that keeps the output idempotent across runs. When absent, the tie-break
 * falls back to `studentId` alone.
 */
