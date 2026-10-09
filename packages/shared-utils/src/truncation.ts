// --- Truncation ---

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

