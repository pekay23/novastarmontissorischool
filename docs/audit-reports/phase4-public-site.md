# Phase 4 Audit — Public Marketing Site (`apps/public-site`)

**Audit date:** 2026-09-28
**Scope:** `apps/public-site/app/`, `components/`, `lib/`, `messages/`, `config/`, `next.config.ts`, `tailwind.config.ts`, plus the actual build artifact in `apps/public-site/out/`
**Method:** Static source review cross-checked against the committed production build output (`next build` → `output: 'export'`). Findings marked **[verified]** were confirmed against the emitted HTML/CSS, not inferred from source alone.

**Stack:** Next.js 16.3.3 (App Router, Turbopack), React 19.2.8, Tailwind CSS 4.3.3, next-intl 4.3.0, TypeScript 5.7.3, Prisma, date-fns 4.4.0, lucide-react 1.8.0

---

## 1. Executive Summary

The public site is **not releasable**. It builds without errors, and the build log is clean — but the artifact that ships is broken in three independent, ship-blocking ways that no type-checker or linter can catch:

1. **The site renders essentially unstyled.** The entire brand palette, all spacing, all responsive breakpoints, and Tailwind's preflight reset are missing from the shipped CSS. The compiled stylesheet is **8.4 KB** and contains no `bg-primary`, no `text-primary`, no `p-*`, no `md:`/`sm:`/`lg:` variants, and no base reset. Headings, buttons, and brand colors are unstyled. Root cause: `app/globals.css:1-3` uses Tailwind **v3** `@tailwind` directives against a **v4** toolchain, and the v4 `@theme` block at `globals.css:5-24` defines unprefixed custom properties (`--primary`) that v4 does not map to utilities. The v3 config at `tailwind.config.ts` is never loaded. **[verified]**

2. **The primary navigation displays raw translation keys.** Users see the literal strings `navigation.home`, `navigation.about`, `navigation.academics`… in the header, on every page. The nav array stores i18n *keys* but is never passed through `useTranslations`. **[verified]**

3. **The site ships with no SEO metadata whatsoever.** `lib/metadata.ts` exports a well-formed `Metadata` object, but nothing re-exports it. None of the 8 content pages emit **any `<title>` tag, meta description, Open Graph tags, Twitter card, canonical URL, or robots directives** — and there is no favicon. (The only `<title>` in the build output is Next.js's own hardcoded "404: This page could not be found." on the three generated 404 documents, which is framework boilerplate, not page metadata.) For a site whose entire purpose is search discovery for a school competing for Kumasi parents, this is fatal. **[verified]**

Beneath those, two further structural problems: **i18n is configured but entirely non-functional** (next-intl installed, plugin absent, no locale routing, no provider, zero calls to `useTranslations` — the entire translation file pair is dead code, and the Twi file is 61% incomplete regardless), and **the content layer is 100% hardcoded placeholder data** while the database fetchers written to populate it sit unused.

The underlying issue is one of **outcome**: the site was scaffolded for an intended architecture and never converged on it. Four parallel, mutually inconsistent implementations of the same four concerns (header/footer, i18n, data, theming) coexist in the codebase, and the one that actually ships is the least complete of each. The `components/header.tsx` and `components/footer.tsx` files are better in isolation than the versions actually mounted in `layout.tsx`, and both are dead.

**Overall readiness: ~25%.** The information architecture, page set, and copy quality are genuinely good and worth keeping. Everything that turns that content into a working, discoverable, styled, localized website is missing.

### Severity Distribution

Every finding in this report carries an explicit `Severity:` label. Counting all 42 across the Critical (C), High (H), Medium (M), Accessibility (A), and Design (D) series:

| Severity | Count | Finding IDs |
|---|---|---|
| **Critical** (site-breaking, ships broken) | 8 | C1–C6, D1, D3 |
| **High** (feature entirely absent / user-facing failure) | 11 | H1–H9, A1, A2 |
| **Medium** (quality, maintainability, correctness) | 18 | M1–M11, A3–A6, D2, D4, D5 |
| **Low** (polish) | 5 | A7–A9, D6, D7 |
| **Total** | **42** | |

D1 and D3 are explicitly labelled *"(symptom of C1)"* — they are the user-visible expression of the single broken-stylesheet root cause, not independent defects. Counting unique root causes rather than symptoms, the effective figure is **8 Critical** (6 independent) and **40 total findings** (38 independent).

---

## 2. Critical Findings

### C1 — The entire Tailwind stylesheet fails to build correctly: site is unstyled
**Severity: CRITICAL** · `app/globals.css:1-3`, `app/globals.css:5-24`, `tailwind.config.ts:1-66` · **[verified against build artifact]**

`globals.css` opens with the Tailwind **v3** directives:
```css
@tailwind base;      /* globals.css:1 */
@tailwind components; /* globals.css:2 */
@tailwind utilities;  /* globals.css:3 */
```
The project is on Tailwind **v4.3.3** (`package.json:31,42`), which requires `@import "tailwindcss"`. Because the v4 entrypoint is never imported, Tailwind's automatic source detection — which is driven by the imported file's location — never registers the app's source files. The result is a stylesheet containing only the utilities Tailwind could infer with no scan context.

Measured against the shipped `out/_next/static/chunks/0wniwnvi__q-t.css` (8,397 bytes), the complete set of generated selectors is:

```
absolute, antialiased, aspect-4-3, aspect-square, aspect-video, bg-gradient-to-b,
bg-gradient-to-br, bg-gradient-to-r, border, border-b, border-t, container, dark,
flex, flex-1, flex-col, focus:outline-none:focus, focus:ring-2:focus, font-heading,
font-sans, grid, grid-cols-1, grid-cols-2, h-full, hidden, inline-block, items-center,
items-start, justify-between, justify-center, min-h-screen, mx-auto, outline,
overflow-hidden, relative, rounded-full, shrink-0, static, sticky, text-center, text-left,
text-responsive-h1, text-responsive-h2, text-responsive-h3, text-right, text-shadow,
to-transparent, transform, transition-colors, transition-transform, via-transparent,
w-auto, w-full, z-10, z-50
```

**Concretely absent and used in production markup:**
- **Brand colors:** `bg-primary`, `text-primary`, `bg-secondary`, `text-secondary`, `bg-accent` — 0 occurrences. The Novastar emerald/teal/amber identity does not exist in the output.
- **All spacing:** `p-6`, `px-4`, `py-2`, `mb-4`, `mb-8`, `gap-6`, `space-y-2` — 0 occurrences.
- **All responsive variants:** zero `sm:`, `md:`, or `lg:` rules. Every `md:grid-cols-4`, `sm:px-6`, `lg:grid-cols-3` in the JSX is a no-op. **The site renders as a single-column desktop layout on every device.**
- **No preflight:** no margin reset on `h1`–`h4`, `p`, `ul`; no `box-sizing: border-box`. The raw CSS opens directly into `@layer properties`, confirming no base layer was emitted.
- Also missing: `rounded-lg`, `shadow-sm`, `text-sm`/`text-lg`/`text-xl`/`text-2xl`/`text-3xl`/`text-4xl`, `text-center`-adjacent typography, `border-border`, `bg-card`, `bg-muted`, `w-8`/`w-10`/`w-12`/`h-8`/`h-10`/`h-12`/`h-14`/`min-h-*`, `text-primary-foreground`.

The `@theme` block at `globals.css:5-24` is a second, independent bug: Tailwind v4 only maps custom properties to utilities when they are namespaced `--color-*`. These are declared as bare `--primary`, `--secondary`, `--background` etc. Even with a correct `@import "tailwindcss"`, `bg-primary` would still not be generated. The `@layer base { :root { --primary: ... } }` block at `globals.css:26-50` repeats the same variables, so the values are declared twice under two different strategies and consumed by neither.

`tailwind.config.ts` — 66 lines defining `colors`, `fontFamily`, `animation`, `keyframes`, `darkMode: 'class'` — is **entirely dead**. Tailwind v4 does not auto-load `tailwind.config.ts`; it requires an explicit `@config "../../tailwind.config.ts";` directive in the CSS. That directive is absent. This is the source of the false confidence in the source tree: the config looks correct and matches the portal's conventions, but nothing reads it.

**Recommendation:**
```css
/* app/globals.css — replace lines 1-3 */
@import "tailwindcss";

/* Then delete the duplicate @layer base { :root {...} } block (lines 26-50) and
   namespace the @theme variables: */
@theme {
  --color-primary: oklch(from hsl(107 91% 18%) l c h); /* or keep HSL channels */
  --color-primary-foreground: hsl(0 0% 100%);
  --color-secondary: hsl(191 71% 50%);
  /* ... */
}
```
The correct HSL-channel form that v4 understands for use with `hsl(var(--color-x))`:
```css
@theme {
  --color-primary: 107 91% 18%;
}
/* then use bg-[hsl(var(--color-primary))] */
```
Cleaner: define `--color-primary: oklch(...)` directly and use `bg-primary` natively.

Either way, **delete `tailwind.config.ts`** and migrate its animation keyframes into `@theme`/`@keyframes` in CSS. Do not keep two config systems.

**Add a build-artifact assertion so this can never silently regress:** a test that greps `out/_next/static/**/*.css` for a sentinel class (e.g. `.bg-primary`) and fails the build if absent. This class of bug is invisible to `tsc` and `eslint` and will otherwise recur on every framework bump.

---

### C2 — Primary navigation renders raw i18n keys as user-facing text
**Severity: CRITICAL** · `app/layout.tsx:13-22, 62-75, 107-121, 167-173` · **[verified against build artifact]**

```tsx
// app/layout.tsx:13-22
const NAV_KEYS = [
  { label: 'navigation.home', href: '/' },
  { label: 'navigation.about', href: '/about' },
  ...
]
```
`label` is an i18n key, but the render sites output `item.label` verbatim:
```tsx
// app/layout.tsx:73
{item.label}
```
No `useTranslations('navigation')` is ever called. The comment on `layout.tsx:12` — `// Navigation will come from messages (i18n)` — describes intent that was never implemented.

**[verified]** Regex search of `out/about/index.html` returns the literal strings `navigation.home`, `navigation.about`, `navigation.academics`, `navigation.admissions`, `navigation.contact`, `navigation.events`, `navigation.fees`, `navigation.news` in the rendered document — eight occurrences, matching the eight nav items, in both the desktop `<nav>` and the mobile menu.

Every page's header and footer therefore shows internal message identifiers instead of "Home", "About Us", "Admissions". This is the first thing any visitor sees.

**Recommendation:** Split the client boundary. Make the root layout a server component, extract `Header` into `components/header.tsx` as a client component, and call `useTranslations('navigation')` there:
```tsx
const t = useTranslations('navigation')
const NAV = [
  { key: 'home', href: '/' },
  { key: 'about', href: '/about' },
  ...
]
// then {t(item.key)}
```
See H1 for the full layout restructure this requires.

---

### C3 — No SEO metadata ships: no title, description, OG, Twitter, or canonical
**Severity: CRITICAL** · `lib/metadata.ts:3-52` (orphaned), `app/layout.tsx:24-40`

`lib/metadata.ts` contains a genuinely good `Metadata` object — title template, description, 12 keywords, OG with 1200×630 image, Twitter `summary_large_image`, `formatDetection`, canonical. **None of it is used.** A Next.js `Metadata` object only takes effect when exported from a `layout.tsx` or `page.tsx` module. `app/layout.tsx` imports nothing from `lib/metadata`.

**[verified]** Complete inventory of the built `out/index.html` document head:
```
<title>            → ABSENT (no <title> element anywhere in this document)
<meta>             → 1 total: <meta name="viewport" content="width=device-width, initial-scale=1"/>
<link>              → 2 total: 1 stylesheet, 1 modulepreload
```
There is no meta description, no `og:*`, no `twitter:*`, no `robots`, no `rel=canonical`, no favicon, no manifest, no `theme-color`.

Every one of the 8 pages shares this defect. No page has a unique `<title>` — search engines will synthesize titles from on-page text, and social shares will render as bare links.

**[verified]** Caveat on measuring this: a raw `Select-String -Pattern "<title"` across `out/` returns **3** hits, not 0. All three are Next.js's own static 404 documents (`out/404.html`, `out/404/index.html`, `out/_not-found/index.html`), which the framework hardcodes to `<title>404: This page could not be found.</title>` with `<meta name="robots" content="noindex"/>`. They are boilerplate, not page metadata, and must not be mistaken for a working title. The signal that matters is 0 titles across the **8 real content pages**.

**Compounding:** `output: 'export'` (`next.config.ts:10`) means there is no server to compute metadata at request time, so there is no fallback. And there is **no `public/` directory in the app at all**, so `/og-image.jpg` (`lib/metadata.ts:33`) and `/logo.svg` (`components/header.tsx:55`) and `/news/*.jpg` (`app/news/page.tsx:14,23,32`) all resolve to 404 even once metadata is wired.

**Recommendation:**
1. `export { metadata as default }` semantics aside — in `app/layout.tsx`, `import { metadata } from '@/lib/metadata'` and re-export it: `export { metadata }`. Rename the source constant to `baseMetadata` to avoid confusion.
2. Add per-page `generateMetadata` to all 7 sub-pages with unique title/description/OG.
3. Create `apps/public-site/public/` with `favicon.ico`, `logo.svg`, `og-image.jpg` (1200×630), `icon.png`, `apple-touch-icon.png`.
4. Once wired, verify with a build-artifact assertion: assert `out/index.html` contains a non-empty `<title>` and a `meta[name=description]`.

---

### C4 — No sitemap, no robots.txt
**Severity: CRITICAL** · absent from app root

Neither `app/sitemap.ts` nor `app/robots.ts` exists. With `output: 'export'`, both must be static-exported — Next.js supports `sitemap.ts` / `robots.ts` generating static files under `output: 'export'`, provided they do not use dynamic APIs.

**Recommendation:**
```ts
// app/sitemap.ts
import type { MetadataRoute } from 'next'
import { SCHOOL_INFO } from '@/lib/metadata'

const routes = ['', '/about', '/academics', '/admissions',
                '/fees', '/news', '/events', '/contact']

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((r) => ({
    url: `${SCHOOL_INFO.website}${r}`,
    lastModified: new Date(),
    changeFrequency: 'monthly',
    priority: r === '' ? 1 : 0.8,
  }))
}
```
```ts
// app/robots.ts
import type { MetadataRoute } from 'next'
import { SCHOOL_INFO } from '@/lib/metadata'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${SCHOOL_INFO.website}/sitemap.xml`,
  }
}
```
Also add `app/not-found.tsx` — the 404 page is currently Next.js's unbranded default (16.9 KB of default markup in `out/404.html`), which is a poor experience for a school site and a lost conversion opportunity on mistyped URLs.

---

### C5 — next-intl is installed and configured but completely non-functional
**Severity: CRITICAL** · `lib/i18n.ts`, `config/i18n.ts`, `messages/*.json`, `next.config.ts`

The i18n stack is present in every layer *except the one layer that connects them*. A full inventory of next-intl usage across the app:

| Requirement | Status |
|---|---|
| `next-intl` dependency | ✅ `package.json:24` |
| `getRequestConfig` | ✅ `lib/i18n.ts:3,6` |
| `createNextIntlPlugin` in `next.config.ts` | ❌ absent |
| `app/[locale]/` route segment | ❌ absent — no locale routing exists |
| `NextIntlClientProvider` | ❌ absent |
| `useTranslations` / `getTranslations` calls | ❌ **zero** across all 8 pages and 3 components |
| `generateStaticParams` for locales | ❌ absent |
| `alternates.languages` hreflang | ❌ absent |
| Language switcher that works | ❌ the "Twi" button (`layout.tsx:80-83, 125-128`) is a `<Button>` with no `onClick` |

**[verified]** A grep for `next-intl|useTranslations|NextIntl|getTranslations` across `apps/public-site` returns exactly **one** match: `lib/i18n.ts:3`. The file is never imported by anything. `messages/en.json` and `messages/tw.json` are dead files (4,071 bytes total: 3,122 + 949).

Consequences:
- `<html lang="en">` is hardcoded at `layout.tsx:30` and never changes.
- `config/i18n.ts:6` declares `localePrefix: 'always'`, but `/en/...` and `/tw/...` routes do not exist — the declaration is inert.
- `config/i18n.ts:14-27` `navigationKeys` references `facilities` and `gallery` keys, but no `/facilities` or `/gallery` page exists and `NAV_KEYS` in `layout.tsx:13-22` omits both.
- `lib/i18n.ts:8` falls back to `process.env.DEFAULT_LOCALE`, which is not in `.env.example` — if ever wired without that variable, the fallback is `undefined` and the dynamic `import()` at line 10 throws.

**Recommendation:** Pick one of two paths and execute fully.

**Path A — Ship bilingual (recommended for a Ghanaian school with a Twi-speaking community).** The infrastructure cost is low and the message files already exist. Steps:
1. `next.config.ts` → wrap with `createNextIntlPlugin('./lib/i18n.ts')`.
2. Move `app/*` into `app/[locale]/*`; add `app/[locale]/layout.tsx` with `<html lang={locale}>` and `<NextIntlClientProvider messages={messages}>`.
3. Add `generateStaticParams` returning `locales`; with `output: 'export'` and `trailingSlash: true` this produces `/en/about/` and `/tw/about/`.
4. Implement the language switcher in `components/header.tsx` using `usePathname` + `useRouter` to swap the locale segment, or `next-intl`'s `createNavigation` helpers.
5. Add `alternates.languages` to metadata so Google indexes both.
6. Fix the 38 missing Twi strings (see §6).

**Path B — Drop the pretense.** Remove `next-intl`, `lib/i18n.ts`, `config/i18n.ts`, and `messages/`. Delete the non-functional "Twi" button. This is a legitimate option for a monolingual site, but it should be a *decision*, not the current accidental state. **Do not leave it as-is** — the Twi button is visible to every user and does nothing, which is worse than either alternative.

**RTL:** Not required. Twi is a left-to-right language using Latin script. The absence of RTL handling is **correct** and should not be "fixed."

---

### C6 — Content is 100% hardcoded placeholder; every database fetcher is dead code
**Severity: CRITICAL** · `app/news/page.tsx:6-34`, `app/events/page.tsx:5-42`, `app/fees/page.tsx:21-67`, `lib/data.ts:35-68, 231-254`

`lib/data.ts` provides 12 well-written Prisma fetchers. Only 5 are called. The rest exist to serve content that is instead hardcoded in the page:

| Fetcher | Consumers | Reality |
|---|---|---|
| `getBranding` | `app/page.tsx:8` | ✅ used |
| `getHomeStats` | `app/page.tsx:9` | ✅ used (returns fallbacks — see below) |
| `getHeroContent` | `app/page.tsx:10` | ✅ used |
| `getFeatures` | `app/page.tsx:11` | ✅ used |
| `getTestimonials` | `app/page.tsx:12` | ✅ used |
| `getCTAContent` | `app/page.tsx:13` | ✅ used |
| `getAcademicPrograms` | `app/page.tsx:14`, `academics:5` | ✅ used |
| `getPublishedNews` | **none** | ❌ `news/page.tsx:6-34` hardcodes 3 items |
| `getPublishedEvents` | **none** | ❌ `events/page.tsx:5-42` hardcodes 4 events |
| `getContactInfo` | **none** | ❌ `layout.tsx:149-159` hardcodes address/phone/email |
| `getFeeCategories` | **none** | ❌ `fees/page.tsx:21-67` hardcodes 4 fee tables |
| `getPaymentMethods` | **none** | ❌ `fees/page.tsx:81-95` hardcodes 3 methods |

**Compounding factor — the build has no database.** `apps/public-site/next.config.ts` does **not** include the `loadRootEnv()` helper that `apps/portal/next.config.ts:18-47` implements, with its explanatory comment about exactly this failure mode. So `DATABASE_URL` is undefined at build time, `safeFetch` short-circuits at `lib/data.ts:11-13` for every call, and **all five "used" fetchers return their fallback arrays**. The shipped homepage shows `500+ / 40+ / 5 / 10+` (`lib/data.ts:167-172`) regardless of the real database. A visitor is shown fabricated enrollment numbers. For a school, publishing invented statistics is a trust and legal problem, not just a data problem.

`safeFetch`'s `console.warn` at `lib/data.ts:16` is the only signal, and only for genuine query errors — the `DATABASE_URL` guard returns silently with no warning at all.

**Recommendation:**
1. Port `loadRootEnv()` from `apps/portal/next.config.ts:18-47` into `apps/public-site/next.config.ts`. Extract it to a shared module so the two configs cannot drift.
2. Make the missing-database case **fail the build loudly** rather than silently fabricate. Distinguish "DB unavailable" (build-time dev convenience) from "content unavailable" (production failure). At minimum, `console.warn` on the `DATABASE_URL` guard, and never ship invented enrollment figures — return `null` and let the UI omit the stat, or show an em-dash.
3. Wire `getPublishedNews`, `getPublishedEvents`, `getFeeCategories`, `getPaymentMethods`, and `getContactInfo` to their pages. Delete the hardcoded arrays.
4. Note the build-time-vs-runtime tension: `output: 'export'` means news and events go stale until the next build. If freshness matters, move the news/events routes to on-demand revalidation (requires dropping `output: 'export'` or using a hybrid host) or publish a `revalidate` webhook trigger. Document whichever trade-off is chosen.

---

## 3. High-Severity Findings

### H1 — Root layout is `'use client'`, forcing the entire site to hydrate
**Severity: HIGH** · `app/layout.tsx:1, 24-40, 42-135, 137-210`

`app/layout.tsx:1` declares `'use client'` at the root. In the App Router this marks the whole layout subtree — every page — as client-rendered. The only reason is `useState` for the mobile menu (`layout.tsx:44`); the `Header` and `Footer` functions are defined inline in the same file, so `'use client'` has to be at the top.

Consequences: every page's server components are shipped as client components; `app/page.tsx:6`'s `async` data fetching and `app/academics/page.tsx:4`'s `await` now run in the browser bundle; `prisma` and `@novastar/database` risk being pulled into the client graph.

**Recommendation:** Delete `'use client'` from `layout.tsx`. Move `Header` to `components/header.tsx` with `'use client'` on that file only. Keep `Footer` as a server component (it has no interactivity — see H6). This also unblocks the C5 fix, since a server layout is required to read the locale.

### H2 — `components/header.tsx` and `components/footer.tsx` are dead code, and diverge from what ships
**Severity: HIGH** · `components/header.tsx:1-141`, `components/footer.tsx:1-94`

Neither file is imported anywhere. The site mounts the inline versions in `layout.tsx:42-210`.

The divergence is material — the dead files are *better*:
- `components/header.tsx:54-61` uses `next/image` with `alt`, `width`, `height`, `priority`; the shipped `layout.tsx:52-54` uses a CSS gradient `<div>` with the text "Nova" and no image.
- `components/footer.tsx:38-55` labels its links ("About Us", "Academic Programs", "Fee Structure") rather than emitting keys.
- `components/footer.tsx:50-54` links to `/academics/creche`, `/academics/kindergarten`, … — five 404 routes that do not exist. The live `layout.tsx:181-185` correctly uses `/academics#creche` anchors, but `app/academics/page.tsx` **never renders those IDs** — see H4.

`components/footer.tsx:86-88` uses raw `<a href>` instead of `next/link`, forfeiting client-side navigation on five footer links.

**Recommendation:** Delete the dead files and consolidate into the `layout.tsx` versions, OR adopt the dead versions after fixing their issues. Do not maintain two header/footer implementations. Add the missing `id` anchors (H4) and switch `footer.tsx:86-88` to `next/link`.

### H3 — Every CTA button on the site is inert
**Severity: HIGH** · `app/page.tsx:39-44, 127-129`, `app/layout.tsx:84-86, 124, 199`, `components/program-card.tsx:41-43`, `app/about/page.tsx:79-81`, `app/fees/page.tsx:110`

"Apply Now" is the primary conversion action for a school admissions site. It is a `<Button>` with **no `href`, no `onClick`, no form** at every occurrence:
- Header CTA: `layout.tsx:84-86` and `layout.tsx:124` (mobile)
- Hero CTA + secondary: `page.tsx:39-44`
- Closing CTA: `page.tsx:127-129`
- Program cards: `program-card.tsx:41-43` (×5 on the homepage)
- "Get Directions via Google Maps": `about/page.tsx:79-81`
- "Download Full Fee Schedule (PDF)": `fees/page.tsx:110`

None of these navigates or acts. The header CTA should link to `/admissions/`. The map button should link to a Maps URL. The PDF button should be an `<a download>`.

**Recommendation:** Wrap in `next/link` where `Button` supports `asChild`/render-prop; otherwise use `<Button asChild><Link href="/admissions">Apply Now</Link></Button>`. Verify the shared-ui `Button` supports this before wiring, and add it if not.

### H4 — Footer program anchors point at IDs that do not exist
**Severity: HIGH** · `app/layout.tsx:181-185` vs `app/academics/page.tsx:24-26`

The footer links to `/academics#creche`, `#kindergarten`, `#lower-primary`, `#upper-primary`, `#jhs`. `ProgramSection` (`academics/page.tsx:73-74`) renders `<div className="border border-border rounded-lg p-4 md:p-6">` with **no `id` attribute**, and renders program sections from `getAcademicPrograms()`, whose `id` values are Prisma `ClassLevel` records — not the slug-style `creche`/`jhs` values the footer assumes. All five links land on the page top.

**Recommendation:** Add `id={program.id}` to the `ProgramSection` root and ensure the DB slugs match the footer hrefs, or map slugs explicitly. Add a unit test asserting every internal `href` in the site resolves to an existing route + anchor.

### H5 — Both forms are non-functional; the admissions form silently discards applications
**Severity: HIGH** · `app/admissions/page.tsx:120, 255`, `app/contact/page.tsx:68, 77`

**Admissions** (`app/admissions/page.tsx:120`):
```tsx
<form onSubmit={(e: FormEvent<HTMLFormElement>) => e.preventDefault()} className="space-y-6">
```
The "Submit Application" button (`admissions/page.tsx:255`) calls `preventDefault()` and does nothing else. There is no `fetch`, no server action, no API route. **Every application a parent submits is silently discarded with zero feedback.** A parent believes they have applied; nothing was recorded. This is the most consequential functional defect in the app after the styling failure.

**Contact** (`app/contact/page.tsx:68, 77`): the form has no `action` and no `onSubmit`. A server component cannot handle submission, so submitting performs a full-page `GET` navigation to the current URL, discarding all entered data. Six fields of parent contact information, thrown away.

**Recommendation:**
1. Convert `app/contact/page.tsx` to a client component with a real submit handler hitting a route handler, or an email dispatch via Resend (`RESEND_API_KEY` is already in `.env.example:21`).
2. For admissions, add a `POST` route handler persisting to the `Application` model, or forward to the portal. Wrap in `useActionState` for pending/error/success states.
3. **Add a visible confirmation state to both.** A form that fails silently is worse than one that errors.
4. Add client-side validation: `type="email"` is present but no error messaging; `parentPhone` has no pattern validation despite `validateGhanaPhone` existing in `packages/shared-utils/index.ts:110-114`.

### H6 — Footer newsletter form has no action, no label, and no state
**Severity: HIGH** · `app/layout.tsx:193-200`

```tsx
<form className="space-y-2">
  <input type="email" placeholder="Enter your email" className="..." />
  <Button size="sm" className="w-full">Subscribe</Button>
</form>
```
No `action`, no `onSubmit`, no `name`, no `id`, no `<label>`, no `aria-label`. Submitting reloads the page and discards the address. The input is invisible to screen readers (placeholder is not a label — see A4).

**Recommendation:** Add a real endpoint, a visible `<label>` (or `aria-label`), `name="email"`, and success/error feedback.

### H7 — Zero font loading; `next/font` never used
**Severity: HIGH** · `app/globals.css:6-8, 28-30`, `package.json`

`--font-sans: Inter` and `--font-heading: Poppins` are declared by name only. No `@font-face`, no `<link>` to Google Fonts, no `next/font/google` import. Neither Inter nor Poppins is loaded anywhere in the app. The site renders in `ui-sans, system-ui, sans-serif` and `ui-serif, Georgia, serif` — the declared brand typography does not exist.

This is compounded by C1: `font-heading` survives in the built CSS but resolves to `var(--font-heading)`, which the unused `tailwind.config.ts:44` would have wired — and that config is never loaded, so the `font-heading` utility in the output is unresolved.

**Recommendation:** Use `next/font/google` in the server layout:
```tsx
import { Inter, Poppins } from 'next/font/google'
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const poppins = Poppins({ subsets: ['latin'], weight: ['600','700'], variable: '--font-poppins', display: 'swap' })
// <html className={`${inter.variable} ${poppins.variable}`}>
```
`next/font` self-hosts, inlines the `@font-face`, adds the preconnect, and eliminates the render-blocking third-party request. Note: Twi diacritics (ɛ, ɔ, ɩ) must be verified in the subset — if the site ships Path A from C5, Twi content is a blocking requirement here.

### H8 — No image handling anywhere; all media are text placeholders
**Severity: HIGH** · `app/news/page.tsx:67-71`, `app/about/page.tsx:73-77`, `app/contact/page.tsx:59-63`, `app/page.tsx:149`, `components/program-card.tsx:29-31`, `app/fees/page.tsx:172`

No `<img>` or `next/image` in any page (verified: `<img` count = 0 in `out/about/index.html`). The `next/image` import at `components/header.tsx:4` is in a dead file.

The placeholders:
- News cards: a grey box reading "Image" (`news/page.tsx:67-71`) — while the data declares real `image: '/news/bece-success.jpg'` paths (`news/page.tsx:14,23,32`) that are never used *and* have no backing files
- Maps: "Map will be embedded here" (`about/page.tsx:75`), "Interactive map will be embedded here" (`contact/page.tsx:61`)
- Feature icons: `<div>★</div>` (`page.tsx:149`)
- Payment method icons: `<div>★</div>` (`fees/page.tsx:172`)
- Program card art: `text-4xl text-primary/40">★` (`program-card.tsx:30`)
- Testimonial stars: `'★'.repeat(5)` (`page.tsx:169`)

`lucide-react` is a declared dependency and is imported in `layout.tsx:8` and `contact/page.tsx:3` (where `MapPin`, `Phone`, `Mail`, `Clock` render correctly), yet every `icon` field in the data model — `'book-open'`, `'graduation-cap'`, `'award'`, `'baby-carriage'`, `'smartphone'`, `'bank'`, `'banknote'` (`lib/metadata.ts:73-102`, `lib/data.ts:183-193`, `fees/page.tsx:84-94`) — is **discarded and replaced with `★`**. The mechanism to render them exists and is unused.

Note also: `FeatureCard` destructures `icon: _icon` and ignores it (`page.tsx:145`), and `PaymentMethodCard` does the same (`fees/page.tsx:164`).

**Recommendation:** Add `apps/public-site/public/`, populate real imagery, and render all `icon` fields through a `lucide-react` icon map. Replace the two map placeholders with a real Google Maps embed (`<iframe>` with `loading="lazy"`, `title` attribute, and `referrerPolicy="no-referrer-when-downgrade"`). Use `next/image` with explicit `width`/`height` and meaningful `alt`.

### H9 — Bundled dependencies exceed what a static marketing site needs
**Severity: HIGH** · `package.json:19-21, 27` · **[measured from build artifact]**

Shipped JS: **933,499 bytes raw / 274.8 KB gzipped**, across 9 chunks, for a 7-page static site with no interactive data tables.

The largest declared dependencies are unused anywhere in `app/`, `components/`, or `lib/`:
- `@radix-ui/react-accordion` (`package.json:19`) — no accordion in the app; the mobile menu is a conditional `<div>` (`layout.tsx:104`), not a Radix disclosure
- `@radix-ui/react-dropdown-menu` (`package.json:20`) — no dropdown; the mobile menu is a conditional `<div>`
- `react-day-picker` (`package.json:27`) — no date picker; admissions uses a native `<input type="date">` (`admissions/page.tsx:139`)

These three are typically 40-60 KB gzipped together with their dependencies. `lucide-react` is tree-shaken correctly (imports are named), so it is not the concern.

**Recommendation:** Remove all three unused dependencies. Replace the mobile menu with `@radix-ui/react-accordion` (which would simultaneously fix the accessibility gaps in A5) or a native `<details>`/`<dialog>`, rather than maintaining a bespoke implementation that lacks focus management.

---

## 4. Medium-Severity Findings

### M1 — `en.json` contains a duplicate JSON key that silently destroys content
**Severity: MEDIUM** · `messages/en.json:18-29`

```json
"features": {
  "montessori": { "title": "Montessori Method", "desc": "..." },   /* line 18 */
  "ges":       { "title": "GES Curriculum", "desc": "..." },        /* line 22 */
  "montessori": { "title": "Qualified Staff", "desc": "..." }       /* line 26 — DUPLICATE */
}
```
`home.features.montessori` is declared twice. JSON parsers keep the **last** occurrence, so `"Montessori Method"` is silently discarded and both readers and any future `useTranslations('home.features.montessori')` call will return "Qualified Staff". **[verified]** by parsing: the flattened key resolves to "Qualified Staff".

**Recommendation:** Rename the third entry to `staff`. Add a CI check rejecting duplicate keys in message files (`json-parse` with a duplicate-key-detecting parser, or a small script) — a locale file with a silent data-loss bug will recur.

### M2 — Twi translations are unedited English and one value is left-to-right
**Severity: MEDIUM** · `messages/tw.json:26, 36, 11, 8, 17, 20`

Translation quality issues in the shipped Twi file:
- `tw.json:26` — `"languageToggle": "Switches to English"`. The Twi label for the toggle reads in English. The English equivalent is "Switch to Twi" (`en.json:44`); the Twi file was not translated.
- `tw.json:36` — `"contact.hours": "Mon-Fri: 7:30 AM - 5:30 PM"` — identical to English.
- `tw.json:11` — `"years": " Ɔda a wɔ wɔ nsa mu"` — a leading space inside the string.
- `tw.json:8` — `"students": "Obi nsa a wɔ su sɛn"` — grammatically malformed; "sɛn" (to reach) makes this read "students who reached". Likely intended "Obi nsa a wɔ hɔ" or "Obi a wɔ sukuu nsa".
- `tw.json:17, 20` — `academics: "Nsa"` and `facilities: "Nsa"` are **the same string**, so Academics and Facilities are indistinguishable in the nav.

**Recommendation:** Engage a fluent Twi speaker to review all 24 existing strings and translate the 38 missing ones. Do not ship machine-translated parent-facing copy on a school site. Add the leading-space fix now.

### M3 — `news` and `events` pages import `date-fns` directly instead of the shared locale-aware helpers
**Severity: MEDIUM** · `app/news/page.tsx:3`, `app/events/page.tsx:1, 84-85`

`app/news/page.tsx:3` calls `formatDate(item.date)` from `@novastar/shared-utils` — correct, and locale-aware via the `LocaleType` param (`packages/shared-utils/index.ts:47-54`). But `app/events/page.tsx:1` imports `format, parseISO` from `date-fns` directly and hardcodes English patterns:
```tsx
format(startDate, 'EEEE, MMMM d, yyyy')                        // events/page.tsx:84
`${format(startDate, 'MMM d')} – ${format(endDate, 'MMM d, yyyy')}` // events/page.tsx:85
```
No `locale` option, no shared helper. The two pages will disagree the moment either is translated.

Related: the `tw` date-fns locale at `packages/shared-utils/index.ts:12-15` is `{...enUS, code: 'tw'}` — English formatting with a Twi label. Passing `'tw'` produces English dates. The code comments acknowledge this ("Falls back to English formatting until full Twi locale data is provided") but the API presents `LocaleType = 'en' | 'tw'` as if both are real.

**Recommendation:** Use `formatDateRange` / `formatDate` from `shared-utils` in `events/page.tsx`, and thread the active locale through. Source real `ak`/`tw` date-fns locale data rather than aliasing `enUS`, or narrow the type to `'en'` until the data exists so callers are not misled.

### M4 — Data layer fails silently on any query error
**Severity: MEDIUM** · `lib/data.ts:8-19`

```ts
async function safeFetch<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    if (!process.env.DATABASE_URL) return fallback
    return await fn()
  } catch (error) {
    console.warn(`Data fetch failed, using fallback:`, error)
    return fallback
  }
}
```
Every database failure is swallowed and replaced with fallback content. A schema mismatch, a dropped connection, or a bad query ships a page of plausible-looking placeholder data with no error surfaced. The `DATABASE_URL` guard returns without even logging.

`getHeroContent` (`lib/data.ts:125-147`) and `getCTAContent` (`lib/data.ts:219-228`) are also misnomers — both ignore their `safeFetch` callback's return entirely (`async () => null` / `async () => ({...})` results are discarded, and the fallback `null` is always returned). They are pure constant functions wearing a database costume.

`getFeatures` (`lib/data.ts:177-202`) is worse: its callback returns a hardcoded array **identical** to its fallback, and `getTestimonials` (`lib/data.ts:205-216`) is the same. Neither can ever return different data. Both should be deleted in favour of the constant they already are.

**Recommendation:** Fail the build on a database error in CI; log loudly and render an explicit empty/error state at runtime. Delete `getHeroContent`/`getCTAContent`/`getFeatures`/`getTestimonials` or make them real queries. The current shape creates the *appearance* of a data layer with none of the guarantees.

### M5 — Student ages are labelled "months" regardless of unit
**Severity: MEDIUM** · `components/program-card.tsx:14-16`, `app/academics/page.tsx:82`

```tsx
`${program.ageMin}-${program.ageMax} months`   // program-card.tsx:15
`${program.ageMin}-${program.ageMax} months`   // academics/page.tsx:82
```
Applied unconditionally. A `ClassLevel` with `ageMin: 6, ageMax: 36` renders "6-36 months" (correct for Crèche), but B4–B6 at `ageMin: 108, ageMax: 132` renders "108-132 months" — which should read "9-11 years". The correct copy already exists in `lib/metadata.ts:71-102` and `messages/en.json:56-77` ("9-11 years (B4, B5, B6)") and is ignored. A parent evaluating Upper Primary sees "108-132 months".

Both sites also silently drop the age entirely when either bound is null, printing "All ages" — a BECE-focused JHS program described as "All ages" is a content bug.

**Recommendation:** Add a unit field to `ClassLevel` (or derive from the level) and format with a shared helper. Never print a unit the value does not have.

### M6 — `FeeCategoryCard` total does not equal the sum of its line items
**Severity: MEDIUM** · `app/fees/page.tsx:21-67, 138`

Kindergarten: line items total ₵1,700 (850+200+400+250) but the card displays `total="₵ 850/term"` (`fees/page.tsx:30`). The value shown is the tuition fee alone, labelled "Total". Same pattern for all four cards. Parents comparing the per-term figure against the itemised list will conclude the school is overcharging, or that the list is wrong.

**Recommendation:** Either rename the field to "Tuition" and drop the "Total" label, or compute the total from the items. Confirm the intended semantics with the school before shipping either — this is a published price list.

### M7 — Tailwind animation utilities are defined but never used, and the config that defines them is dead
**Severity: MEDIUM** · `tailwind.config.ts:47-60`

`animate-fade-in` and `animate-slide-up` with `fadeIn`/`slideUp` keyframes are defined. Zero usages across `app/`, `components/`, and `lib/` (verified: `animate-fade-in` appears 0 times in the built CSS). Combined with C1, they are doubly dead — the config is not loaded *and* nothing uses them.

This is worth noting positively for the animation-performance criterion: **the site currently has no JavaScript-driven animation at all.** No layout thrashing, no scroll-linked effects, no `will-change` misuse, no long task on the main thread from animation. The only transition utilities that do render are `transition-colors` and `transition-transform` (both confirmed present in the built CSS), used for hover states — which are compositor-safe. The one CSS-level concern is `backdrop-blur` on the sticky header (`layout.tsx:47`), which is paint-expensive and repaints on scroll; with `border-b` and a 95% opaque background, dropping `backdrop-blur` would be visually near-identical and materially cheaper on the low-end Android devices common in the target market.

**Recommendation:** Delete the unused keyframes. Either ship the animations (with `prefers-reduced-motion` guards) or remove the definitions. Reduce `backdrop-blur` to a solid background.

### M8 — `next.config.ts` carries stale, dead, and dangerous settings
**Severity: MEDIUM** · `next.config.ts:12-19, 23-25`

- **`images.unoptimized: true` + `images.formats` + `images.qualities` + `images.minimumCacheTTL`** (`next.config.ts:13-16`) — the last three are inert when `unoptimized: true`. This is required by `output: 'export'`, but the adjacent options are misleading dead configuration.
- **`typedRoutes: true`** (`next.config.ts:19`) is active and worth keeping.
- **`allowedDevOrigins`** hardcodes four specific LAN IPs (`next.config.ts:4-9`). These belong in a local, gitignored config, not committed.
- **`// Multi-tenant: generate static paths for each tenant`** (`next.config.ts:23-25`) is a comment with no implementation, and is contradicted by `lib/data.ts` hardcoding `tenant: { code: 'novastar' }` in **all 12 fetchers**. Multi-tenancy is aspirational, not real.
- **No security headers.** `apps/portal/next.config.ts:79-98` sets `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `X-XSS-Protection` for every route. `public-site` sets none. Note that `headers()` is a no-op under `output: 'export'`, so this must be configured at the static host or Cloudflare — but the omission should be a deliberate, documented decision, not an oversight.
- **No `trailingSlash` verification against anchors.** `trailingSlash: true` (`next.config.ts:11`) is correct and verified working (output contains `/about/`), but interacts with H4's anchors.

**Recommendation:** Clean out the dead image options and the dev-origin IPs. Extract `loadRootEnv()` into a shared module with the portal. Document the static-host header policy alongside the deployment.

### M9 — No tests, despite a test script
**Severity: MEDIUM** · `package.json:11-12`

`"test": "bun test"` and `"test:ui": "bun test --ui"` are declared. There are **zero test files** in the app. Combined with the fact that every one of the six Critical findings would have been caught by a trivial assertion test, this is a structural gap.

**Recommendation:** Minimum viable suite:
1. `metadata.test.ts` — assert `out/index.html` contains a non-empty `<title>` and `meta[name=description]` (catches C3 in CI).
2. `styles.test.ts` — assert the built CSS contains a sentinel utility like `.bg-primary` (catches C1 in CI).
3. `messages.test.ts` — assert `tw.json` keys ⊇ `en.json` keys, and reject duplicate keys in either (catches M1).
4. `links.test.ts` — assert every internal `href` resolves to a route that exists in the build manifest, and every `#anchor` exists in the target page's HTML (catches H4 and the `/academics/creche` 404s in `components/footer.tsx:50-54`).

### M10 — Placeholder data is presented as fact
**Severity: MEDIUM** · `lib/data.ts:167-172`, `lib/metadata.ts:107-119`, `app/news/page.tsx:6-34`, `app/fees/page.tsx`

`lib/metadata.ts:107` comments `// Testimonials (placeholder until real ones provided)` and then ships them to production. `lib/data.ts:168-171` ships `500+` students, `40+` teachers, `10+` years. `getHomeStats` computes "Years of Excellence" from `tenant.createdAt` (`lib/data.ts:159`) which yields 10 only because the tenant record is absent.

The news page's most prominent item is dated `2021-08-15` (five years stale) and the fee page hardcodes 2026 dates. Meanwhile `app/about/page.tsx:58-59` and `app/academics/page.tsx:54-56` present "100% Grade 1 in BECE Science (2021)" as a current differentiator.

**Recommendation:** Either wire the real data (see C6) or gate placeholder content behind an explicit preview flag that cannot be enabled in production. Never ship invented enrollment figures on a school website.

### M11 — `layout.tsx` computes `new Date()` in a client component
**Severity: MEDIUM** · `app/layout.tsx:138`

```tsx
const currentYear = new Date().getFullYear()
```
Inside the `'use client'` layout. This runs on both server and client, producing a hydration-mismatch risk at the New Year boundary, and it re-evaluates in the browser for no benefit. The `suppressHydrationWarning` at `layout.tsx:30` masks symptoms rather than addressing them.

**Recommendation:** Move the footer to a server component (H1) and compute the year there, or pass it as a prop from a server parent.

---

## 5. Accessibility Findings

### A1 — All form labels are unassociated with their inputs
**Severity: HIGH** · `app/admissions/page.tsx:290-291, 311-312, 331, 360-361`, `app/contact/page.tsx:90-91, 102-103`

```tsx
// admissions/page.tsx:290-291
<label className="text-sm font-medium">{label}{required && '*'}</label>
<input type={type || 'text'} ... />
```
The `<label>` has **no `htmlFor`**, and the `<input>` has **no `id`**. A `<label>` without `for` wrapping its control provides no accessible name. Every field in both forms — first name, last name, DOB, gender, parent name, phone, email, address, program, results (admissions) and all six contact fields — is announced to screen readers as an unlabelled edit field.

This is a WCAG 2.1 **1.3.1 Info and Relationships (A)** failure and a 3.3.2 **Labels or Instructions (A)** failure. Six of the site's most important conversion fields are affected.

**Recommendation:** Generate stable ids and wire them:
```tsx
const id = React.useId()
<label htmlFor={id} className="text-sm font-medium">{label}{required && '*'}</label>
<input id={id} name={name} ... aria-required={required} />
```
`useId()` avoids collisions with the multi-step form, where the same `Input` component is mounted conditionally across steps.

### A2 — `RadioGroup` has a fieldset/group with no accessible name binding
**Severity: HIGH** · `app/admissions/page.tsx:329-348`

```tsx
<div className="space-y-1">
  <label className="text-sm font-medium">{label}</label>   {/* labels nothing */}
  <div className="flex gap-4">
    {options.map(opt => (
      <label key={opt.value} className="flex items-center gap-2">
        <input type="radio" name={label} ... />
        {opt.label}
      </label>
    ))}
  </div>
</div>
```
The group label is not associated. The options *are* correctly wrapped (implicit labelling works), but there is no `<fieldset>`/`<legend>`, so a screen reader announces three unlabelled radio buttons. Using the label text as the `name` attribute (`name={label}`, line 337) makes the form field name depend on a user-visible string — a brittle coupling that breaks on translation and violates the "name is an identifier, not a display string" rule.

**Recommendation:**
```tsx
<fieldset>
  <legend className="text-sm font-medium">{label}</legend>
  ...
  <input type="radio" name="gender" value={opt.value} id={`gender-${opt.value}`} />
  <label htmlFor={`gender-${opt.value}`}>{opt.label}</label>
</fieldset>
```

### A3 — `formatDetection: { telephone: false }` suppresses tap-to-call on mobile
**Severity: MEDIUM** · `lib/metadata.ts:45-48`

```ts
formatDetection: { email: false, telephone: false }
```
Intentional and deliberate — but for a Ghanaian school targeting parents on mobile, suppressing `tel:` auto-detection is counterproductive. The phone number is displayed three times (`layout.tsx:152`, `contact/page.tsx:36`, `lib/metadata.ts:58`) and is not a `<a href="tel:">` anywhere, so it is not tappable regardless. The metadata setting only suppresses iOS's automatic number detection, which would otherwise have provided a tap target.

**Recommendation:** Remove `telephone: false` and wrap the phone numbers in `<a href="tel:+233244935251">`. Same for the email address — `<a href="mailto:info@novastarmontissorischool.com">` — and the address as a `geo:` or Maps link (H3).

### A4 — Newsletter input has no accessible name
**Severity: MEDIUM** · `app/layout.tsx:194-198`

Placeholder `"Enter your email"` is not a label. Verified: `<label>` count = 0 on the about page, and the footer input has neither `aria-label` nor `id`. A placeholder also disappears on focus, removing the only visible affordance for users who need it.

**Recommendation:** Add `<label htmlFor="newsletter-email" className="sr-only">Email address</label>` and `id`.

### A5 — Mobile menu lacks keyboard and screen-reader affordances
**Severity: MEDIUM** · `app/layout.tsx:87-99, 104-131`

The disclosure button has an `aria-label` (`layout.tsx:92`) but is missing:
- `aria-expanded={mobileMenuOpen}` — the state is not exposed
- `aria-controls` pointing at the panel
- Escape-key handling to close
- Focus management on open/close
- Focus trapping within the open panel
- Return of focus to the trigger on close

The panel is a bare `<div>` (`layout.tsx:105`) with no `id`, no `role`, and no `aria-label`. When it is open it is a set of links in the tab order immediately after the header — operable, but with no announced state. Because it is a conditional render rather than a Radix primitive (see H9), every one of these is hand-rolled and missing.

**Recommendation:** Replace with `@radix-ui/react-accordion` (already a declared dependency) or a `<details>`/`<dialog>` element. At minimum add `aria-expanded`, `aria-controls`, `id` on the panel, and an Escape handler.

### A6 — No skip-to-content link
**Severity: MEDIUM** · `app/layout.tsx:32-36`

The header contains 8 nav links plus 3 buttons before `<main>`. Keyboard users must Tab through 11 focusable elements on every page load to reach the content. The `<main>` element exists (`layout.tsx:34`) but has no `id`, so the skip link has no target.

**Recommendation:**
```tsx
<a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to content</a>
<main id="main-content" className="flex-1" tabIndex={-1}>
```

### A7 — Two `<nav>` elements with no distinguishing label
**Severity: LOW** · `app/layout.tsx:61` (desktop), `app/layout.tsx:106` (mobile), `app/layout.tsx:165` (footer quick links)

The footer "Quick Links" list (`layout.tsx:164-175`) is a `<ul>` inside a `<div>`, not a `<nav>`, so it is not exposed as a navigation landmark at all. The header has a desktop `<nav>` and a mobile `<nav>` with identical, unlabelled content — two landmarks with the same name and no way to distinguish them.

**Recommendation:** Wrap the footer list in `<nav aria-label="Footer">`; label the header navs `aria-label="Primary"` / `aria-label="Mobile"`.

### A8 — Footer heading levels invert the document outline
**Severity: LOW** · `app/layout.tsx:146, 165, 179, 191`

The footer school name is an `<h3>` (`layout.tsx:146`) and its subsections are `<h4>` (`layout.tsx:165, 179, 191`). These render after all of the page's `<h2>`s in DOM order, so a heading-outline reader sees the outline go `h1 → h2 → h2 → … → h3 → h4` correctly on About, but on pages where the last main-content heading is an `<h2>`, the footer's `<h3>` is a *sibling* at the same level as nothing — and there is no `<h2>` introducing the footer region.

More concretely, the footer's `h3` is being used to size a brand name, not to structure content.

**Recommendation:** Make the footer school name a `<p>` with strong styling, and its section headings `<h2>`, giving the footer a proper top-level region. Or use `role="presentation"` on the heading. This is low-impact but it distorts the outline for screen-reader users navigating by heading.

### A9 — Missing landmark labelling and heading skips
**Severity: LOW** · across all pages

Page structure is generally sound — verified on `out/about/index.html`: 1 `<header>`, 1 `<nav>`, 1 `<main>`, 1 `<footer>`, 4 `<section>`, and a single `<h1>`. Heading order on About is `h1 → h2 ×4 → h3 → h4 ×3`, which is valid.

Two gaps: no `<section>` carries an `aria-label` or `aria-labelledby`, so each of the four unnamed `<section>` elements is an unlabelled generic region in the accessibility tree; and there is no `role="banner"`/`role="contentinfo"` consideration for the header/footer (implicit roles are correct in modern AT, so this is informational).

**Recommendation:** Give each `<section>` an `aria-labelledby` pointing at its heading, or change `<section>` to `<div>` where it is purely a layout wrapper — the latter is usually correct here, since these sections have no distinguishing content beyond a heading that is already in the outline.

---

## 6. i18n Completeness Check

### 6.1 Message file diff (`en.json` vs `tw.json`)

**[verified]** Flattened leaf-key comparison:

| Metric | Value |
|---|---|
| English leaf keys | **62** |
| Twi leaf keys | **24** |
| Missing in Twi | **38 (61.3%)** |
| Orphan keys in Twi | 0 |

### 6.2 Top-level section coverage

| Section | `en.json` | `tw.json` | Status |
|---|---|---|---|
| `home` | ✅ | ⚠️ partial | Missing `features` (6), `hero.cta`, `hero.secondaryCta` (2) |
| `navigation` | ✅ 12 keys | ✅ 12 keys | Complete, but 2 quality defects (M2) |
| `about` | ✅ 5 keys | ⚠️ 4 keys | Missing `subtitle` |
| `academics` | ✅ 12 keys | ❌ **absent** | Entire section missing |
| `admissions` | ✅ 7 keys | ❌ **absent** | Entire section missing |
| `fees` | ✅ 7 keys | ❌ **absent** | Entire section missing |
| `contact` | ✅ 5 keys | ⚠️ 2 keys | Missing `address`, `phone`, `email` |

### 6.3 Complete list of missing Twi keys

```
about.subtitle
academics.title
academics.subtitle
academics.programs.creche.{title,age}
academics.programs.kindergarten.{title,age}
academics.programs.lowerPrimary.{title,age}
academics.programs.upperPrimary.{title,age}
academics.programs.jhs.{title,age}
admissions.title
admissions.subtitle
admissions.requirements
admissions.form
admissions.process.step1
admissions.process.step2
admissions.process.step3
admissions.process.step4
contact.address
contact.email
contact.phone
fees.title
fees.subtitle
fees.payment
fees.momo
fees.bank
fees.cash
home.features.title
home.features.subtitle
home.features.montessori.{title,desc}
home.features.ges.{title,desc}
home.hero.cta
home.hero.secondaryCta
```

### 6.4 Functional i18n status

| Check | Status |
|---|---|
| Message files present | ✅ |
| Message files used by any component | ❌ **0 call sites** |
| `createNextIntlPlugin` registered | ❌ |
| Locale-based routing (`app/[locale]/`) | ❌ |
| `NextIntlClientProvider` | ❌ |
| `<html lang>` reflects active locale | ❌ hardcoded `"en"` (`layout.tsx:30`) |
| Language switcher functional | ❌ `<Button>` with no handler (`layout.tsx:80-83`) |
| hreflang alternates | ❌ |
| Date formatting locale-aware | ⚠️ helper supports it (`shared-utils:47`), callers don't pass it |
| Number/currency locale-aware | ⚠️ `formatGHS` hardcodes `'en-US'` (`shared-utils:22`) |
| RTL support | ✅ **N/A** — Twi is LTR Latin script. Correctly absent. |
| Twi font diacritic coverage (ɛ ɔ ɩ) | ❌ unverified — no font is loaded at all (H7) |
| Duplicate-key integrity | ❌ `home.features.montessori` duplicated (M1) |

**Bottom line:** effective Twi coverage of the live site is **0%**, not 39%. The 24 translated strings are never read. Even after wiring next-intl, Twi would cover 39% of content and require a native-speaker review of all 62 strings.

---

## 7. SEO Scorecard

| # | Check | Status | Notes |
|---|---|---|---|
| 1 | `<title>` per page | ❌ **0/8** | No `<title>` element in any built page **[verified]** |
| 2 | Meta description | ❌ **0/8** | Only `<meta viewport>` present **[verified]** |
| 3 | Title template (`%s \| Site`) | ❌ | Exists at `metadata.ts:6`, never exported |
| 4 | Open Graph tags | ❌ **0/8** | `title`, `description`, `url`, `siteName`, `images` all absent **[verified]** |
| 5 | OG image | ❌ | Declared `/og-image.jpg` (`metadata.ts:33`); file absent — no `public/` dir |
| 6 | Twitter card | ❌ **0/8** | `summary_large_image` never applied |
| 7 | Canonical URL | ❌ **0/8** | Declared at `metadata.ts:50`, never applied |
| 8 | `hreflang` alternates | ❌ | No locale routing to alternate between |
| 9 | `sitemap.xml` | ❌ | No `app/sitemap.ts` |
| 10 | `robots.txt` | ❌ | No `app/robots.ts`, no static file |
| 11 | Favicon / app icons | ❌ | No `public/` directory exists |
| 12 | JSON-LD structured data | ❌ | None anywhere. **`School` + `EducationalOrganization` is the single highest-value missing item** — it is the schema type Google uses for school rich results (knowledge panel, sitelinks, tuition). Also missing: `BreadcrumbList` (all 8 pages), `Article` (news), `Event` (events — with `startDate`/`location`), `Course`/`Offer` (fees) |
| 13 | Semantic HTML | ⚠️ partial | Good landmarks (A7), but sections unlabelled (A9) |
| 14 | Single `<h1>` per page | ✅ **8/8** | Verified |
| 15 | Heading hierarchy | ⚠️ | Valid on About; footer inverts levels (A8) |
| 16 | Descriptive URL slugs | ✅ | Clean, semantic, hyphenated, `trailingSlash` working |
| 17 | Internal linking | ⚠️ | 5× `/academics/creche` → 404 (`components/footer.tsx:50-54`); 5 anchors → no target (H4) |
| 18 | `lang` attribute | ⚠️ | Present but hardcoded `en`; never changes |
| 19 | Indexable content depth | ❌ | Thin. ~150-250 words/page. No blog routing, no `/news/[slug]`, no facilities or gallery pages despite `en.json` declaring both |
| 20 | Local SEO signals | ❌ | No `LocalBusiness`/`Place` schema, no geo coordinates, no Google Business integration, no `areaServed` |
| 21 | Security headers | ❌ | None (vs. portal's 4) (M8) |
| 22 | Performance (Core Web Vitals) | ⚠️ | 274.8 KB gzipped JS, no fonts, no images — see below |

### SEO score: **6 / 100**

Every one of the 12 objective, machine-checkable criteria (1-11, 12) scores zero. The six points reflect sound URL structure, correct single-`<h1>` usage, and valid landmark semantics — the foundations are right, but not one of them is emitted into the document.

**Highest-leverage single change:** wiring `lib/metadata.ts` into `app/layout.tsx` (5 minutes) moves criteria 1-7 to ✅ and is worth more than every other item combined. **Highest-leverage second change:** adding `School` JSON-LD (C1 fix is independent).

---

## 8. Design & UX Findings

### D1 — Visual consistency: the brand does not exist in the output
**Severity: CRITICAL** (symptom of C1) · `app/globals.css:5-24`

The brand system is well-specified and coherent in source: emerald-900 primary, teal-600 secondary, amber-600 accent (`globals.css:33-38`), with heading/body/mono families. The `tailwind.config.ts` maps them correctly to HSL-channel utilities. **None of it reaches the browser.** **[verified]** — `bg-primary`, `text-primary`, `bg-secondary`, `--color-primary`: 0 occurrences in the built CSS.

Consequence: every `<h1>`/`<h2>` (`text-primary`), every `Button` (inherits `bg-primary` from shared-ui), every footer link hover, and the entire hero gradient (`from-primary/20 via-transparent to-accent/20`, `page.tsx:30`) and CTA band (`from-primary to-secondary`, `page.tsx:119`) render as unstyled or default-colored. The `Star` glyphs at 40% opacity (`program-card.tsx:30`) are the only brand-adjacent visual left.

### D2 — Component reuse: `shared-ui` is used, but inconsistently and with local duplicates
**Severity: MEDIUM** · `app/admissions/page.tsx:280-374`, `app/contact/page.tsx:87-110`, `app/page.tsx:136-180`

`shared-ui` exports `Button`, `Card`, `CardContent`, `CardHeader`, `CardTitle`, and `cn` — all correctly imported and used (`page.tsx:3`, `academics/page.tsx:2`, `news/page.tsx:2`, `events/page.tsx:2`, `admissions/page.tsx:5-6`).

Against that, both pages that need form controls **reimplemented them locally**:
- `app/admissions/page.tsx:280-374` defines `Input`, `Textarea`, `RadioGroup`, `Select`, `ReviewItem`
- `app/contact/page.tsx:87-110` defines `Input`, `Textarea` — a **near-duplicate** of the admissions versions, differing only in that it is uncontrolled

Two independent `Input` components with subtly different APIs, neither accessible (A1), neither in `shared-ui`, both bypassing the design system. Meanwhile `shared-ui` is a workspace package the site depends on and could extend.

Local card components follow the same pattern: `StatCard`, `FeatureCard`, `TestimonialCard` (`page.tsx:136-180`), `NewsCard` (`news/page.tsx:63`), `EventCard` (`events/page.tsx:71`), `FeeCategoryCard`, `PaymentMethodCard` (`fees/page.tsx:118-177`) — all defined inline in their page files, several of them near-identical (`StatCard` and `ProcessStep` at `admissions/page.tsx:268-278` are the same component with different props).

**Recommendation:** Promote `Input`/`Textarea`/`Select`/`RadioGroup` into `shared-ui` with proper label association (fixing A1 and A2 permanently, for the portal too). Deduplicate the stat/step card. Keep genuinely page-specific components page-local.

### D3 — Mobile responsiveness: the site is single-column at every viewport
**Severity: CRITICAL** (symptom of C1) · all pages · **[verified]**

Every responsive utility in the codebase is inert (C1). Concretely, the intended breakpoints that do not exist:

| Page | Intended | Actual |
|---|---|---|
| `page.tsx:52` stats | `grid-cols-2 md:grid-cols-4` | 2 columns always |
| `page.tsx:73` programs | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` | 1 column always |
| `page.tsx:93` features | `grid-cols-1 md:grid-cols-3` | 1 column always |
| `news/page.tsx:52` | `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` | 1 column always |
| `admissions/page.tsx:78` | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` | 1 column always |
| `fees/page.tsx:80` | `grid-cols-1 md:grid-cols-3` | 1 column always |
| `contact/page.tsx:21` | `grid-cols-1 lg:grid-cols-2` | 1 column always |
| `layout.tsx:61` nav | `hidden md:flex` | **desktop nav shown on mobile** |
| `layout.tsx:90` menu btn | `md:hidden` | **hidden on mobile — menu unreachable** |
| `layout.tsx:48` container | `px-4 sm:px-6 lg:px-8` | `px-4` always |

The last three are the damaging ones. `hidden` and `md:hidden` are the **only** classes in that pair that resolve (both are in the built CSS), so the behaviour inverts: the desktop nav renders on phones — 8 links plus 3 buttons in a 14-unit-tall row — while the hamburger button, which is `md:hidden` and therefore hidden, is the only way to reach the mobile menu. **The navigation is unusable on mobile.** For a school whose target audience is Kumasi parents on phones, this is the second most damaging defect after the styling failure.

### D4 — Content hierarchy
**Severity: MEDIUM** · across pages

The information architecture is genuinely good: clear page purposes, sensible section ordering (hero → context → detail → CTA), consistent `container mx-auto px-4 sm:px-6 lg:px-8` wrapper (8 occurrences), and a consistent `bg-gradient-to-b from-primary/10 to-transparent` hero pattern on all 7 sub-pages. This is the strongest part of the implementation and should be preserved.

Weaknesses:
- **Homepage hero is `min-h-screen`** (`page.tsx:29`) with no image. A full-viewport text-only hero with a decorative gradient is the weakest possible use of the LCP slot.
- **No `BreadcrumbList`** on any sub-page — 7 pages with no navigational context.
- **The homepage duplicates `layout.tsx:163-175`'s "Quick Links"** conceptually with its programs section, without adding navigational value.
- **The homepage "Why Choose Novastar?" section** (`page.tsx:85-91`) presents three generic feature blurbs identical to `lib/data.ts:180-195`, i.e. the same three strings as the testimonials section's framing. Weak differentiation.
- **`page.tsx:63-70` and `academics/page.tsx:13-16` carry the identical hero subtitle.** A parent reading both sees the same sentence twice.

**Recommendation:** Replace the hero text block with a real photograph of students (this is also the single biggest LCP and emotional-impact win). Add breadcrumbs. Differentiate the homepage hero subtitle from the Academics hero subtitle.

### D5 — Typography scale is inconsistent between the custom and utility scales
**Severity: MEDIUM** · `app/globals.css:64-73, 116-124`

`globals.css:64-73` defines `--font-size-sm` … `--font-size-2xl` inside a `@media (max-width: 639px)` block, but Tailwind's `text-sm`/`text-lg` etc. read from the theme scale, **not** from these variables. They are referenced nowhere. Dead code that looks like a responsive type system.

`globals.css:116-124` defines `.text-responsive-h1/h2/h3` using `clamp()` — these **do** work (verified present in the built CSS) and are used consistently on all 8 page `<h1>`s and section `<h2>`s. This part is correct and is a genuinely good responsive-type implementation. But the body copy uses the fixed Tailwind scale (`text-lg`, `text-sm`, `text-base`) which is unverified, creating a mismatch between fluid headings and non-fluid body text.

**Recommendation:** Delete the dead `--font-size-*` block. Consider making the body scale fluid too, or accept the fixed scale and remove the implied responsiveness.

### D6 — Testimonial stars use string repetition instead of an icon
**Severity: LOW** · `app/page.tsx:169-173`

```tsx
{'★'.repeat(5).split('').map((star, i) => (
  <span key={i} className="text-yellow-400">{star}</span>
))}
```
Five separate `<span>` elements, each announced to screen readers as the character "★", producing "black star, black star, black star, black star, black star" on every testimonial. `lucide-react` is already a dependency and exports `Star`.

**Recommendation:** `<Star className="w-4 h-4 fill-yellow-400 text-yellow-400" aria-hidden="true" />` inside a container with `aria-label="Rated 5 out of 5"`. Same for the `★` glyphs at `page.tsx:149`, `program-card.tsx:30`, `fees/page.tsx:172`, `academics/page.tsx:77` — all should be real `lucide-react` icons selected from the `icon` field the data already provides (H8).

### D7 — `dark:` variants are present throughout but can never activate
**Severity: LOW** · `page.tsx:138, 147, 167`, `fees/page.tsx:171`, `admissions/page.tsx:270`, `globals.css:52-61`

Nine `dark:bg-card` / `dark:bg-gray-700` usages exist. `globals.css:52-61` defines a `.dark` block, and `tailwind.config.ts:10` sets `darkMode: 'class'` — but that config is never loaded (C1), and nothing ever adds a `dark` class to `<html>`. There is no theme provider, no toggle, no `prefers-color-scheme` media query. **[verified]** — zero `dark:` rules in the built CSS, and the built `<html>` is a bare `<html lang="en">`.

The dark theme is fully designed and entirely unreachable.

**Recommendation:** Decide: ship `prefers-color-scheme` support (`@custom-variant dark (&:where(.dark, .dark *));` in v4 plus a `ThemeProvider`), or delete the `dark:` classes and the `.dark` block. Note the `.dark` block is itself incomplete — it omits `--primary`, `--secondary`, `--accent`, and `--ring` (compare `globals.css:52-61` to `globals.css:41-49`), so even if enabled the brand colors would stay light while backgrounds darkened, producing a light-on-dark contrast failure.

---

## 9. Performance Assessment

### 9.1 Rendering strategy
**Severity: MEDIUM** (currently a net positive, strategically fragile)

All 8 routes prerender as static HTML — **[verified]** in `.turbo/turbo-build.log`:
```
Route (app)          ┌ /            ○ (Static)
                     ├ /about       ○ (Static)
                     ... all 10 routes (Static)
○  (Static)  prerendered as static content
```
This is optimal for a marketing site: CDN-served HTML, no server compute, immune to database latency. `output: 'export'` (`next.config.ts:10`) is a sound choice for free static hosting.

The fragility: static export means **content updates require a rebuild**. News and events (`getPublishedNews`, `getPublishedEvents`) go stale indefinitely. `safeFetch` hides this — a stale build and a fresh build look identical. A school posting a news item waits for the next deploy. If news freshness is a business requirement, this decision needs revisiting, and it should be a documented trade-off rather than an accident of the config.

### 9.2 Bundle size
**Severity: HIGH** (partly H9)

| Metric | Value |
|---|---|
| Raw JS (9 chunks) | **933,499 B (911 KB)** |
| Gzipped JS | **274.8 KB** |
| Largest chunk | 329 KB raw |
| CSS (shipped) | **8,397 B** — 8.4 KB, because it is broken (C1) |
| LCP element | The `<h1>` text (`page.tsx:32`) — text-only hero |

274.8 KB gzipped is heavy for a 7-page static site. Removing the three unused dependencies (H9) should recover a meaningful fraction.

### 9.3 Fonts
**Severity: HIGH** (H7)

No font is loaded. This is a **performance accident that happens to be a small win**: no webfont request, no FOIT, no layout shift from font swap. But the *intended* design (Poppins headings, Inter body) is absent, and the eventual `next/font` fix must account for the Twi diacritic set, which will likely require a larger subset than `latin` alone.

### 9.4 Images
**Severity: HIGH** (H8)

Zero images. No `next/image` usage, no `<img>`, no LCP image, no `width`/`height` attributes to reserve space. The `images.unoptimized: true` config exists for a static export that has no images to optimize.

**This is the largest unrealized performance opportunity.** An image-optimized hero photograph would be the intended LCP element; instead the LCP element is unstyled body text. Fixing C1 is a prerequisite — a photo on an unstyled page is a regression, not an improvement. Fix H7 (fonts) and C1 before adding images.

### 9.5 Core Web Vitals — projected, not measured

**This audit did not run Lighthouse or any field/lab measurement.** The following is a projection from the build artifact and source, and must not be reported as a measured score:

| Metric | Projection | Basis |
|---|---|---|
| **LCP** | Likely **poor** now; potentially good after remediation | Text-only hero (`page.tsx:32-37`) inside a `min-h-screen` flex-centered section. Unstyled text with no font, no image, minimal CSS actually *helps* paint time today. Adding a hero image is the intended LCP element but the image pipeline does not exist. |
| **CLS** | Uncertain | Zero images means zero image-driven CLS. But no fonts are loaded (H7), so the site currently cannot exhibit font-swap CLS. The moment `next/font` lands without `size-adjust` metrics, heading CLS will appear. The `min-h-screen` hero (`page.tsx:29`) is height-driven by viewport, not content, so it is stable. |
| **INP** | Likely **good** | The only interactivity is a mobile menu toggle (`layout.tsx:91`) and multi-step form state. No long tasks, no heavy computation, no `useEffect` chains. The `'use client'` root (H1) inflates the bundle and therefore TTI, but the work at interaction time is trivial. |
| **TTFB** | Likely **excellent** | Static export; served from CDN with no server work. |

**Required next step:** run Lighthouse against a built-and-served `out/` directory and record real LCP/CLS/INP/TTFB per route, before and after the C1 fix. Do not treat the projections above as scores.

### 9.6 Animation performance
**Severity: LOW** (M7)

No JS-driven animation, no scroll-linked effects, no `will-change`, no `requestAnimationFrame` loops. The only motion is `transition-colors` / `transition-transform` on hover, plus `backdrop-blur` on the sticky header (`layout.tsx:47`) — a paint-expensive effect that repaints on every scroll frame, on a component present on all 8 pages. On the low-end Android devices common in Kumasi, this is the one measurable paint cost in the app.

No `prefers-reduced-motion` handling exists, which is correct given there is no motion to reduce.

---

## 10. Prioritized Remediation Plan

### Wave 1 — Ship-blocking (do first; the site is not launchable without these)

| # | Task | Ref | Effort |
|---|---|---|---|
| 1 | Fix Tailwind: `@import "tailwindcss"`, namespace `--color-*` in `@theme`, delete the duplicate `:root` block, delete `tailwind.config.ts` | C1 | 1-2 h |
| 2 | **Add a CI assertion that `out/**/*.css` contains `.bg-primary` and a media query** | C1 | 30 min |
| 3 | Wire `lib/metadata.ts` into `app/layout.tsx`; add per-page `generateMetadata` to all 7 sub-pages | C3 | 2-3 h |
| 4 | Add `app/sitemap.ts` and `app/robots.ts` | C4 | 30 min |
| 5 | Create `public/` with `favicon.ico`, `logo.svg`, `og-image.jpg` (1200×630), touch icons | C3, H8 | 1 h |
| 6 | Fix the nav: move `Header` to a server layout + `components/header.tsx` client island; pass translated labels | C2, H1 | 1-2 h |
| 7 | **Add a CI assertion that `out/index.html` contains a non-empty `<title>` and `meta[name=description]`** | C3 | 30 min |
| 8 | Delete `components/header.tsx` and `components/footer.tsx`; consolidate into one implementation | H2 | 30 min |
| 9 | Make the admissions form actually submit, with success/error state | H5 | 4-6 h |
| 10 | Make the contact form actually submit, with success/error state | H5 | 2-3 h |
| 11 | Wire all CTAs to real destinations (`/admissions`, Maps, fee PDF) | H3 | 1 h |
| 12 | Port `loadRootEnv()` from the portal config so the build reaches the database | C6 | 1 h |

**Wave 1 gate:** no launch until 1-7 are done and verified against a fresh build. Items 9-12 can follow immediately but must land before the site is used for real admissions.

### Wave 2 — Correctness and trust

| # | Task | Ref | Effort |
|---|---|---|---|
| 13 | Decide bilingual vs. monolingual and execute fully (C5 Path A recommended) | C5 | 1-2 d |
| 14 | Wire `getPublishedNews` / `getPublishedEvents` / `getFeeCategories` / `getPaymentMethods` / `getContactInfo`; delete hardcoded arrays | C6 | 1 d |
| 15 | Make `safeFetch` fail loudly; delete the four fake fetchers | M4 | 2 h |
| 16 | Stop publishing fabricated enrollment figures | M10 | 1 h |
| 17 | Fix all form label associations with `useId` + `htmlFor`; add `<fieldset>`/`<legend>` to `RadioGroup` | A1, A2 | 2 h |
| 18 | Fix "months" age formatting | M5 | 2 h |
| 19 | Reconcile the fee "Total" figures | M6 | 1 h (needs school sign-off) |
| 20 | Add `id` anchors for `/academics#creche` etc.; fix the 5 `/academics/{slug}` 404s in the footer | H4 | 1 h |
| 21 | Add `skip to content` + `aria-expanded`/`aria-controls`/Escape on the mobile menu | A5, A6 | 2 h |
| 22 | Add `School` + `EducationalOrganization` + `BreadcrumbList` JSON-LD | SEO #12 | 3 h |

### Wave 3 — Quality, design, performance

| # | Task | Ref | Effort |
|---|---|---|---|
| 23 | Remove `@radix-ui/react-accordion`, `@radix-ui/react-dropdown-menu`, `react-day-picker` | H9 | 30 min |
| 24 | Load fonts via `next/font/google` with Twi diacritic coverage | H7 | 2 h |
| 25 | Add real imagery; render all `icon` fields via `lucide-react`; embed Maps | H8, D6 | 1-2 d |
| 26 | Promote accessible `Input`/`Textarea`/`Select`/`RadioGroup` into `shared-ui`; dedupe cards | D2 | 4 h |
| 27 | Add `app/not-found.tsx` (branded 404) | C4 | 1 h |
| 28 | Add the four CI tests (metadata, styles, messages, links) | M9 | 4 h |
| 29 | Fix the duplicate `home.features.montessori` key; add a duplicate-key CI check | M1 | 1 h |
| 30 | Repair or delete the Twi strings; source real `tw` date-fns locale | M2, M3 | 1 d + native review |
| 31 | Clean `next.config.ts`: dead image options, dev IPs, document the host header policy | M8 | 1 h |
| 32 | Drop `backdrop-blur`; delete unused keyframes; delete the dead `--font-size-*` block | M7, D5 | 1 h |
| 33 | Decide dark mode: implement `prefers-color-scheme` (and complete the `.dark` token block) or delete all `dark:` classes | D7 | 2 h |
| 34 | Add `tel:` / `mailto:` links; drop `formatDetection.telephone: false` | A3 | 1 h |
| 35 | **Run Lighthouse before/after Wave 1; record real LCP/CLS/INP per route** | §9.5 | 2 h |
| 36 | Add nav/footer landmarks; fix footer heading levels; label or un-nest `<section>` | A7-A9 | 1 h |

---

## 11. What's Working Well

Worth preserving through remediation — the audit should not read as uniformly negative:

- **Information architecture and copy.** Eight pages, clear purposes, well-ordered sections, a genuinely strong hero subtitle (`page.tsx:19`), and confident, parent-facing admissions messaging (`admissions/page.tsx:72-82`). The mission/vision/history structure on About is well proportioned.
- **URL and routing structure.** Clean semantic slugs, `trailingSlash: true` correctly applied and verified in the output (`/about/`, `/academics/`), `typedRoutes: true` enabled.
- **Static export strategy.** All 10 routes prerender. Correct choice for the hosting budget and the content model.
- **Semantic HTML foundations.** One `<h1>` per page (8/8), proper `<header>`/`<nav>`/`<main>`/`<footer>` landmarks, real `<section>` elements, real `<table>` for the fee breakdown (`fees/page.tsx:141-156`) with `<thead>`/`<th scope>`-appropriate structure. Better than most marketing-site codebases.
- **The data layer's *intent*.** `lib/data.ts` demonstrates correct tenant scoping (`tenant: { code: 'novastar' }` on every query), correct publication filtering (`status: 'PUBLISHED'`, `publishedAt: { lte: new Date() }`), sensible ordering, and a build-time fallback pattern. The design is right; only the wiring is missing.
- **`shared-utils` is well built.** Ghana-aware `formatGHS` and `formatPhone`, correct `parseISO` usage, a real `validateGhanaPhone` (`shared-utils:110`), and a documented honest fallback for the missing Twi date locale. It is simply not being used by this app.
- **The multi-step admissions form UX** (`admissions/page.tsx:97-117, 231-257`) is a good pattern — progress indicator, back/next, a review step, and use of `formatPhone` on the review. It needs a real submit and accessible labels, but the interaction design is right.
- **No animation performance debt.** Zero JS-driven animation, zero `will-change` abuse, zero layout thrashing (§9.6).
- **The build is clean.** TypeScript passes with `ignoreBuildErrors: false` (`next.config.ts:21`), and the build log shows zero errors and zero warnings. The bugs here are invisible to the toolchain — which is precisely why the CI assertions in Wave 1 are the highest-value follow-up.

---

## Appendix A — File Inventory

| File | Lines | Status | Primary Issues |
|---|---|---|---|
| `app/layout.tsx` | 210 | 🔴 Active | C2, H1, H3, H7, M11, A5, A6, A7, A8 |
| `app/page.tsx` | 180 | 🔴 Active | H3, H8, D4, D6 |
| `app/about/page.tsx` | 88 | 🔴 Active | H3, H8, D4 |
| `app/academics/page.tsx` | 107 | 🔴 Active | H4, M5, H8 |
| `app/admissions/page.tsx` | 383 | 🔴 Active | **H5 (silent data loss)**, A1, A2, D2 |
| `app/contact/page.tsx` | 111 | 🔴 Active | H5, A1, D2 |
| `app/fees/page.tsx` | 177 | 🔴 Active | M6, H8, D6 |
| `app/news/page.tsx` | 90 | 🔴 Active | C6, H8, D4 |
| `app/events/page.tsx` | 99 | 🔴 Active | C6, M3 |
| `app/globals.css` | 129 | 🔴 Active | **C1 (site-breaking)**, D1, D5, D7 |
| `components/header.tsx` | 141 | ⚫ Dead | H2 |
| `components/footer.tsx` | 94 | ⚫ Dead | H2 (5× 404 links, raw `<a>`) |
| `components/program-card.tsx` | 47 | 🔴 Active | M5, H8, D6 |
| `lib/data.ts` | 254 | ⚠️ 5/12 used | C6, M4, M10 |
| `lib/metadata.ts` | 119 | ⚫ **Orphaned** | **C3 (no metadata ships)**, H8 |
| `lib/i18n.ts` | 18 | ⚫ Dead | C5 |
| `config/i18n.ts` | 27 | ⚫ Dead | C5 |
| `messages/en.json` | 106 | ⚫ Dead | M1 (duplicate key) |
| `messages/tw.json` | 38 | ⚫ Dead | **61% incomplete**, M2 |
| `next.config.ts` | 27 | 🔴 Active | C6 (no env loading), M8 |
| `tailwind.config.ts` | 66 | ⚫ Dead | **C1** |
| `tsconfig.json` | 51 | ✅ | Clean |
| `postcss.config.cjs` | 5 | ✅ | Correct plugin |
| `package.json` | 45 | ⚠️ | H9 (3 unused deps), M9 (no tests) |
| `public/` | — | 🔴 **Missing** | C3, H8 |

**Totals:** 21 active files, 7 dead files (~500 lines of non-executing code), 0 test files, 0 JSON-LD blocks, 0 `<title>` tags across the 8 content pages, 0 metadata exports wired, 38 untranslated message keys, 1 broken stylesheet.

---

## Appendix B — Verification Commands

```powershell
# 1. Confirm no metadata ships.
# Expect 0 on content pages. A raw count over all of out\ returns 3, which are
# Next.js's own 404 boilerplate -- exclude the 404 docs to get the true signal.
Select-String -Path "apps\public-site\out\*.html","apps\public-site\out\*\*\*.html" `
  -Pattern "<title" | Where-Object { $_.Path -notmatch "404|_not-found" } |
  Measure-Object | Select-Object -ExpandProperty Count

# 2. Confirm brand CSS missing (expect >0 hits after C1 fix)
Select-String -Path "apps\public-site\out\_next\static\chunks\*.css" `
  -Pattern "\.bg-primary" | Measure-Object | Select-Object -ExpandProperty Count

# 3. Confirm raw i18n keys still rendered (expect 0 hits after C2 fix)
Select-String -Path "apps\public-site\out\about\index.html" -Pattern "navigation\."

# 4. Rebuild and re-verify
cd apps\public-site; bun run build
```

---

*Report generated 2026-09-28. Findings marked **[verified]** were confirmed against the committed production build artifact in `apps/public-site/out/` and `.turbo/turbo-build.log`; all others are source-level analysis. Core Web Vitals figures in §9.5 are projections and require a Lighthouse run to substantiate.*
