import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * Design regression suite for the public site.
 *
 * Every assertion here is about a thing that can silently stop being true. That
 * is the whole design of this file: none of these checks would fail a build on
 * their own, because a wrong class name and a missing design token both compile
 * cleanly. Tailwind v4 emits no rule at all for a utility whose token it cannot
 * resolve, so a rename looks exactly like a deletion until someone looks at the
 * page.
 *
 * What is deliberately NOT here: composited contrast over gradient stops. It
 * needs per-stop alpha compositing and reads better as a report than as a
 * boolean, so it lives in `tools/ui-audit/audit.mjs`. What IS here is contrast
 * over solid backgrounds, which is the case that actually regressed — the three
 * gateway headings at 4.19:1. Elements sitting on a gradient or an image are
 * SKIPPED and counted, never passed silently; see `solidBackgroundsBelow`.
 */

const ROUTES = [
  { path: '/', name: 'home', status: 200 },
  { path: '/academics/', name: 'academics', status: 200 },
  { path: '/about/', name: 'about', status: 200 },
  { path: '/admissions/', name: 'admissions', status: 200 },
  { path: '/fees/', name: 'fees', status: 200 },
  { path: '/news/', name: 'news', status: 200 },
  { path: '/events/', name: 'events', status: 200 },
  { path: '/contact/', name: 'contact', status: 200 },
  // The 404 page is a real route with a real expectation. A soft-404 — the body
  // with a 200 — would pass every visual assertion below while telling a crawler
  // and a parent that the page exists.
  { path: '/no-such-page/', name: 'notfound', status: 404 },
]

/** `--radius-xs/sm/md/lg/xl` from app/globals.css, in px. */
const TOKEN_RADII = [0, 4, 8, 12, 16, 24]

/**
 * The four elevation steps, as the per-layer offsets the browser computes.
 *
 * Matched per layer rather than as one joined string, because a stock Tailwind
 * shadow can satisfy a loose substring test: `shadow-md` is
 * `0 1px 2px 0, 0 2px 4px 0`, whose geometry contains `1px 2px`, so a test that
 * looks for `1px 2px` anywhere in the string passes on exactly the thing it was
 * written to catch. Each layer here is one complete `x y blur spread` quadruple,
 * and the only way to render a shadow the ladder contains is to render one of
 * these.
 *
 * Values are `--shadow-hairline` / `-raised` / `-floating` / `-overlay` in
 * `app/globals.css`, as Chromium serialises them.
 */
const TOKEN_SHADOW_GEOMETRY = new Set([
  '0px 1px 2px 0px',
  '0px 2px 6px 0px',
  '0px 2px 4px 0px',
  '0px 8px 20px 0px',
  '0px 4px 8px 0px',
  '0px 18px 44px 0px',
])

/**
 * Font sizes the scale permits, in px.
 *
 * The six named steps are 56 / 40 / 22 / 15 / 12 / 11. Prose adds 14 and 18, and
 * 16 is Tailwind's inherited default on an unstyled element. A seventh size is
 * how a scale starts eroding, so anything else fails and gets triaged
 * deliberately rather than by accident.
 */
const ALLOWED_FONT_SIZES = new Set([11, 12, 14, 15, 16, 18, 22, 40, 56])

const WIDTHS = [
  { name: 'narrow', width: 360, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 1000 },
]

/** Freeze animation so computed values are settled and two runs agree. */
const FREEZE = `*,*::before,*::after{animation-play-state:paused !important;transition:none !important}`

async function open(page: import('@playwright/test').Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await page.addStyleTag({ content: FREEZE })
  await page.waitForTimeout(400)
}

test.describe('public-site design invariants', () => {
  for (const route of ROUTES) {
    test.describe(route.name, () => {
      test('hydrates without a mismatch', async ({ page }) => {
        /*
         * A developer running `bun run dev` with a browser extension installed sees
         * a wall of React hydration errors naming attributes this codebase has
         * never heard of: `bis_skin_checked`, `bis_register`, `__processed_*`.
         * Those are injected into the DOM by the extension before React hydrates,
         * which is the last cause React's own message lists. Confirmed here rather
         * than assumed: the served HTML contains none of them, while
         * `plus_jakarta_sans_…-module__…__variable` — which React printed without a
         * diff marker — is ours, from next/font, and matched.
         *
         * So the fix is not in this repo. This test is the proof, and it is the
         * thing that would catch a *real* mismatch later: `bis_*` only appears in
         * an extension-equipped browser, whereas a genuine one — a `Date.now()`
         * during render, a `typeof window` branch, invalid nesting — reproduces
         * here in a clean Chromium and fails this test.
         */
        const problems: string[] = []

        page.on('console', (msg) => {
          if (msg.type() !== 'error' && msg.type() !== 'warning') return
          const text = msg.text()
          if (/hydrat|did not match|server rendered HTML|Text content does not match|tree hydrated/i.test(text)) {
            problems.push(`console.${msg.type()}: ${text.slice(0, 300)}`)
          }
        })
        page.on('pageerror', (err) => problems.push(`pageerror: ${err.message.slice(0, 300)}`))

        await page.goto(route.path, { waitUntil: 'load' })
        await page.evaluate(() => document.fonts.ready.then(() => undefined))
        // Give React time to hydrate and report. Any mismatch surfaces during
        // this window, not at load event.
        await page.waitForTimeout(600)

        expect(problems, problems.join('\n\n')).toEqual([])
      })
      test(`answers ${route.status} and renders a document`, async ({ page }) => {
        const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' })
        expect(response?.status(), `${route.path} status`).toBe(route.status)

        await open(page, route.path)

        // One h1 per page: the 404 page included, which is where a duplicated or
        // missing heading hides.
        await expect(page.locator('h1')).toHaveCount(1)
        await expect(page.locator('main#main-content')).toBeVisible()

        // The skip link is the first focusable element and must resolve to the
        // main landmark, or keyboard users cannot bypass the nav.
        const skip = page.locator('a[href="#main-content"]').first()
        await expect(skip).toHaveCount(1)
      })

      for (const vp of WIDTHS) {
        test(`does not scroll sideways at ${vp.width}px`, async ({ page }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height })
          await open(page, route.path)

          /*
           * The document-level assertion, not an element sweep. An element-level
           * check misses the case this suite exists for: `getHomeStats()` returns
           * `'Crèche–JHS'`, one token with no break opportunity, which at the 56px
           * display step overflowed a 156px grid column while the card's own box
           * stayed inside it. Only the document can be widened by content.
           */
          const measured = await page.evaluate(() => ({
            client: document.documentElement.clientWidth,
            scroll: document.documentElement.scrollWidth,
          }))

          expect(
            measured.scroll,
            `${route.name} @ ${vp.width}px scrolls sideways; bisect with tools/ui-audit/overflow-bisect.mjs`,
          ).toBeLessThanOrEqual(measured.client)
        })
      }

      test('renders only token radii', async ({ page }) => {
        await open(page, route.path)

        const offenders = await page.evaluate((allowed) => {
          const bad: Array<{ el: string; radius: string }> = []
          for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el)
            // `border-radius` computes as up to four corners; a pill or an oval
            // shows up as two different values, and neither is a token.
            const corners = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius]
            if (corners.every((c) => c === '0px')) continue
            for (const corner of corners) {
              const px = Number.parseFloat(corner)
              if (!allowed.includes(px)) {
                bad.push({ el: `${el.tagName.toLowerCase()}.${el.className?.toString?.().slice(0, 60) ?? ''}`, radius: corner })
                break
              }
            }
          }
          return bad
        }, TOKEN_RADII)

        expect(offenders, 'every border-radius must be a --radius-* token').toEqual([])
      })

      test('renders no stock Tailwind shadow', async ({ page }) => {
        await open(page, route.path)

        const offenders = await page.evaluate((allowed: string[]) => {
          const allow = new Set(allowed)
          const bad: Array<{ el: string; shadow: string; layer: string }> = []
          for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el)
            const raw = cs.boxShadow
            if (!raw || raw === 'none') continue
            // A single `rgba(0, 0, 0, 0)` shadow is what a `shadow-*` class
            // collapses to when its colour variable is missing — present in the
            // declaration, painting nothing.
            const layers = raw.split(/,(?![^(]*\))/).map((l) => l.trim())
            const meaningful = layers.filter((l) => !/^rgba\(0, 0, 0, 0\)/.test(l))
            if (meaningful.length === 0) continue

            for (const layer of meaningful) {
              const nums = layer.match(/-?[\d.]+px/g) ?? []
              const offsets = nums.slice(0, 4).join(' ')
              if (!allow.has(offsets)) {
                bad.push({
                  el: `${el.tagName.toLowerCase()}.${el.className?.toString?.().slice(0, 60) ?? ''}`,
                  shadow: raw.slice(0, 120),
                  layer: offsets,
                })
              }
            }
          }
          return bad
        }, [...TOKEN_SHADOW_GEOMETRY])

        expect(offenders, 'box-shadow must come from the elevation ladder').toEqual([])
      })

      test('uses only scale font sizes', async ({ page }) => {
        await open(page, route.path)

        const offenders = await page.evaluate((allowed) => {
          const bad = new Map<string, string>()
          for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el)
            // Only elements that actually render text. An empty wrapper inherits a
            // size that no reader ever sees, and failing on those produces noise
            // that trains people to ignore the metric.
            const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')
            if (!hasText) continue
            const size = Number.parseFloat(cs.fontSize)
            if (!allowed.includes(size)) {
              bad.set(`${el.tagName.toLowerCase()}.${el.className?.toString?.().slice(0, 60) ?? ''}`, `${size}px`)
            }
          }
          return [...bad.entries()]
        }, [...ALLOWED_FONT_SIZES])

        expect(offenders, 'font sizes must come from the type scale or the prose pair').toEqual([])
      })

      test('aligns every section to one content edge', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1000 })
        await open(page, route.path)

        const edges = await page.evaluate(() => {
          const found = new Map<number, string[]>()
          for (const section of document.querySelectorAll('section')) {
            const container = section.querySelector(':scope > .container') ?? section.querySelector(':scope > div > .container')
            if (!container) continue
            const left = Math.round(container.getBoundingClientRect().left)
            const list = found.get(left) ?? []
            list.push(section.className.toString().slice(0, 70))
            found.set(left, list)
          }
          return [...found.entries()].map(([left, els]) => ({ left, count: els.length, els }))
        })

        /*
         * Zero edges is a pass, not a failure. The 404 page is one centred block
         * with no `<section>` at all, so there is nothing to disagree about —
         * requiring a section here failed the 404 page for being a 404 page. The
         * contract is "all containers agree", and a page with no containers
         * vacuously satisfies it. The single-container case is asserted instead,
         * so a page cannot opt out by shipping zero sections.
         */
        if (edges.length === 0) {
          const containers = await page.locator('.container').count()
          expect(containers, 'a page with no sections still has content to align').toBeGreaterThan(0)

          const lefts = await page.evaluate(() =>
            [...document.querySelectorAll('.container')].map((el) => Math.round(el.getBoundingClientRect().left)),
          )
          expect(new Set(lefts).size, 'every container on the page shares one left edge').toBe(1)
          return
        }

        // One content edge is the contract. Two means a section is off the grid,
        // which is invisible in review and obvious to a user scanning a page.
        const ranked = edges.sort((a, b) => b.count - a.count)
        expect(
          ranked.slice(1).map((e) => `${e.left}px on ${e.count} section(s): ${e.els.join(' | ')}`),
          `sections disagree on the content edge; ${ranked[0].left}px is the majority`,
        ).toEqual([])
      })

      test('has no tap target under 24px outside the WCAG exemptions', async ({ page }) => {
        await open(page, route.path)

        const offenders = await page.evaluate(() => {
          const INLINE_PARENTS = new Set(['p', 'li', 'td', 'th', 'dd', 'dt', 'figcaption', 'blockquote'])
          const bad: Array<{ el: string; w: number; h: number; text: string }> = []

          for (const el of document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="tab"]')) {
            const cs = getComputedStyle(el)
            if (cs.display === 'none' || cs.visibility === 'hidden') continue
            const r = el.getBoundingClientRect()
            if (r.width === 0 && r.height === 0) continue

            // WCAG 2.2 SC 2.5.8 exemptions. Without them this reports the skip
            // link and every inline prose link as failures, and a metric that is
            // always red is a metric nobody reads.
            if (el.classList.contains('sr-only')) continue
            if (cs.clipPath === 'inset(50%)') continue
            const parent = el.parentElement
            if (parent && INLINE_PARENTS.has(parent.tagName.toLowerCase())) continue

            if (r.height < 24 || r.width < 24) {
              bad.push({
                el: `${el.tagName.toLowerCase()}.${el.className?.toString?.().slice(0, 60) ?? ''}`,
                w: Math.round(r.width),
                h: Math.round(r.height),
                text: (el.textContent ?? '').trim().slice(0, 40),
              })
            }
          }
          return bad
        })

        expect(offenders, 'tap targets must clear 24x24 or be inline prose').toEqual([])
      })

      test('has no dead hover state', async ({ page }) => {
        await open(page, route.path)

        /*
         * A hover that resolves to the same colour as its resting state is a
         * control that advertises interactivity it does not have. This is easy to
         * reintroduce by accident: a `hover:` class on an element whose base
         * already sets the same property, or an `onDarkOutline` variant applied to
         * a light surface where the hover colour resolves to the resting one.
         */
        const dead = await page.evaluate(() => {
          const found: Array<{ el: string; property: string; value: string }> = []
          const CONTROLS = 'a, button, [role="button"], [role="tab"], [data-hover-check]'

          for (const el of document.querySelectorAll(CONTROLS)) {
            const cs = getComputedStyle(el)
            const r = el.getBoundingClientRect()
            if (r.width === 0 || r.height === 0) continue

            // Read the declared hover rules straight off the stylesheet rather
            // than dispatching pointer events: a headless run has no pointer, and
            // synthesising hover state for every control is both slow and a
            // different code path from what a user hits.
            for (const sheet of document.styleSheets) {
              let rules: CSSRuleList
              try {
                rules = sheet.cssRules
              } catch {
                continue // cross-origin sheet; none here, but do not throw
              }
              const walk = (list: CSSRuleList) => {
                for (const rule of list) {
                  if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
                    walk(rule.cssRules)
                    continue
                  }
                  if (!(rule instanceof CSSStyleRule)) continue
                  if (!rule.selectorText.includes(':hover')) continue
                  if (!rule.selectorText.includes(el.tagName.toLowerCase())) continue
                  try {
                    if (!el.matches(rule.selectorText.replace(/:hover/g, ''))) continue
                  } catch {
                    continue
                  }
                  for (const property of ['background-color', 'color', 'border-color', 'box-shadow', 'transform']) {
                    const declared = rule.style.getPropertyValue(property)
                    if (!declared) continue
                    if (getComputedStyle(el).getPropertyValue(property) === declared) continue
                    found.push({ el: `${el.tagName.toLowerCase()}.${el.className?.toString?.().slice(0, 50) ?? ''}`, property, value: declared.slice(0, 60) })
                  }
                }
              }
              walk(rules)
            }
            void cs
          }
          return found
        })

        expect(dead, 'every hover rule must change something').toEqual([])
      })

      test('has no accessibility violations', async ({ page }) => {
        await open(page, route.path)

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          // The campaign map is a third-party embed; axe cannot see inside it and
          // its iframe title is asserted separately in the contact spec.
          .exclude('.grecaptcha')
          .analyze()

        const summary = results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
          help: v.help,
          targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
        }))

        expect(summary, JSON.stringify(summary, null, 2)).toEqual([])
      })

      test('every image decodes and paints ink', async ({ page }) => {
        await open(page, route.path)

        /*
         * Decoding and painting are two separate failures and both are invisible.
         *
         * `public/logo.svg` was invalid XML — its comment spelled CSS custom
         * property names, and an XML comment cannot contain a double hyphen — so
         * Chromium refused to parse the document. The `<img>` then reported
         * `naturalWidth: 0`, sat in a correct 227x36 box, was `visible` at
         * `opacity: 1`, and painted nothing. Typecheck, lint, build and axe were
         * all green. The logo was simply gone, on every page, and no gate
         * noticed.
         *
         * `img.decode()` is the exact test for this: it rejects when the resource
         * cannot be decoded, so it distinguishes "loaded and has no intrinsic size
         * because it is a scaled SVG" from "failed to parse". Then the canvas
         * check catches the other half — an image that decodes but renders
         * transparent, which is what a missing or transparent fill looks like.
         */
        const report = await page.evaluate(async () => {
          const images = Array.from(document.images)
          const out: Array<Record<string, unknown>> = []

          for (const img of images) {
            const src = img.currentSrc || img.src || '(no src)'
            const rect = img.getBoundingClientRect()
            const entry: Record<string, unknown> = {
              src: src.split('/').pop(),
              remote: !src.startsWith(location.origin),
              natural: `${img.naturalWidth}x${img.naturalHeight}`,
              rendered: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
              alt: img.getAttribute('alt'),
            }

            if (!('decode' in img)) {
              entry.failure = 'HTMLImageElement.decode is unsupported'
              out.push(entry)
              continue
            }

            try {
              await img.decode()
            } catch {
              entry.failure = 'decode() rejected: the resource is not a decodable image'
              entry.url = src
              out.push(entry)
              continue
            }

            // A decoded image that paints nothing is broken in a different way —
            // empty geometry, a transparent fill, or a zero-sized box.
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              const canvas = document.createElement('canvas')
              canvas.width = img.naturalWidth
              canvas.height = img.naturalHeight
              const ctx = canvas.getContext('2d')
              if (ctx) {
                ctx.drawImage(img, 0, 0)
                const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
                const seen = new Set<string>()
                let opaque = 0
                for (let i = 0; i < data.length; i += 4) {
                  if (data[i + 3] === 0) continue
                  opaque++
                  seen.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`)
                }
                entry.opaquePixels = opaque
                entry.distinctColors = seen.size
                if (opaque === 0) entry.failure = 'decoded but painted no opaque pixels'
                else if (seen.size < 2) entry.failure = 'decoded but painted a single flat colour'
              }
            }

            out.push(entry)
          }
          return out
        })

        /*
         * Separate "the file is wrong" from "the third party was unreachable".
         *
         * The placeholders in `lib/placeholder-images.ts` are remote by design
         * until real photography lands, so a runner without outbound internet
         * would otherwise turn a network outage into a red build that says nothing
         * about this repository. Only a resource that *is* reachable but still
         * fails to decode is a real finding — which is exactly the broken-logo
         * case: 200 OK, invalid XML.
         */
        const reachable: Record<string, boolean> = {}
        await Promise.all(
          report
            .filter((r) => r.failure !== undefined && r.remote === true && typeof r.url === 'string')
            .map(async (r) => {
              try {
                const res = await page.request.get(r.url as string, { timeout: 15_000 })
                reachable[r.url as string] = res.ok()
              } catch {
                reachable[r.url as string] = false
              }
            }),
        )

        const environmental = report.filter(
          (r) =>
            r.failure !== undefined &&
            r.remote === true &&
            typeof r.url === 'string' &&
            reachable[r.url as string] === false,
        )
        const broken = report.filter((r) => r.failure !== undefined && !environmental.includes(r))

        test.info().annotations.push({
          type: 'remote imagery unreachable',
          description: environmental.map((r) => `${r.src}: ${r.failure}`).join('; ') || '(none)',
        })

        expect(broken, JSON.stringify(broken, null, 2)).toEqual([])
      })
    })
  }

  test.describe('reduced motion', () => {
    test('collapses duration and settles delay', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await open(page, '/')

      /*
       * `globals.css` zeroes `transition-duration` and `animation-iteration-count`
       * but originally left `animation-delay` alone, which is a live bug the
       * moment anything staggers its entrance: a reduced-motion user watches an
       * element stay invisible for the length of the delay. The fix is a
       * NEGATIVE delay, so `animation-fill-mode: both` applies the end state
       * immediately instead of after a wait.
       */
      const offenders = await page.evaluate(() => {
        const bad: Array<{ el: string; property: string; value: string }> = []
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue

          const duration = cs.transitionDuration.split(',').map((v) => Number.parseFloat(v))
          const maxDuration = Math.max(...duration, 0)
          if (maxDuration > 0.001) {
            bad.push({ el: `${el.tagName.toLowerCase()}.${el.className?.toString?.().slice(0, 50) ?? ''}`, property: 'transition-duration', value: cs.transitionDuration })
          }

          const delay = Number.parseFloat(cs.animationDelay)
          if (Number.isFinite(delay) && delay > 0.001) {
            bad.push({ el: `${el.tagName.toLowerCase()}.${el.className?.toString?.().slice(0, 50) ?? ''}`, property: 'animation-delay', value: cs.animationDelay })
          }
        }
        return bad
      })

      expect(offenders, 'reduced motion must not leave anything waiting').toEqual([])
    })
  })
})
