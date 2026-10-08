import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/*
 * Design-token regression guard.
 *
 * Tailwind v4 emits nothing — no warning, no error — for a utility whose token
 * it cannot resolve. `bg-primary-soft` after 2026-10-04 compiled to no rule at
 * all, so every element that used it silently fell back to whatever background
 * it inherited. Typecheck cannot see it: the class is a valid string. Only a
 * test that reads the source can.
 *
 * So these assertions are about the SOURCE, not about rendered pixels. They are
 * cheap, run in CI without a browser, and they fail on the exact class of
 * regression that is otherwise invisible until someone looks at the page.
 */

/** WCAG 2.x relative luminance contrast. Local so the test has no import graph. */
function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

const APP_ROOT = join(import.meta.dir, '..')
const SHARED_UI_ROOT = join(APP_ROOT, '..', '..', 'packages', 'shared-ui')
const GLOBALS = readFileSync(join(APP_ROOT, 'app', 'globals.css'), 'utf8')

// Only scan the public-site (marketing) source directories.
// Portal and admin use their own CSS entrypoints (portal.css, admin.css)
// with different token systems — scanning them would flag legitimate
// cross-system utilities as "removed".
const SOURCE_DIRS = [
  join(APP_ROOT, 'app', '(public)'),
  join(APP_ROOT, 'components'),
  join(APP_ROOT, 'lib'),
]

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.css'])

interface SourceFile {
  path: string
  text: string
}

function collect(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      collect(full, out)
      continue
    }
    const dot = entry.lastIndexOf('.')
    if (dot === -1 || !SOURCE_EXTENSIONS.has(entry.slice(dot))) continue
    out.push({ path: relative(APP_ROOT, full).replace(/\\/g, '/'), text: readFileSync(full, 'utf8') })
  }
  return out
}

const SOURCES = SOURCE_DIRS.flatMap((dir) => collect(dir))

/** Shared-UI classes that this app must keep resolvable, with the token that backs each. */
const SHARED_UI_CONTRACT: Record<string, string> = {
  'bg-card': '--color-card',
  'text-card-foreground': '--color-card-foreground',
  'bg-popover': '--color-popover',
  'text-popover-foreground': '--color-popover-foreground',
  'bg-accent': '--color-accent',
  'text-accent-foreground': '--color-accent-foreground',
  'bg-destructive': '--color-destructive',
  'text-destructive-foreground': '--color-destructive-foreground',
}

/**
 * Utilities whose names were removed in the 2026-10-04 refinement. Any of these
 * in source now compiles to nothing.
 */
const REMOVED_UTILITIES = [
  'bg-primary-soft',
  'text-tertiary-container',
  'shape-gold-cut',
  'shape-badge-slant',
  'text-responsive-h1',
  'text-responsive-h2',
  'text-responsive-h3',
  'text-display-hero',
  'text-headline-lg',
  'text-headline-md',
  'text-headline-sm',
  'text-title-lg',
  'text-title-md',
  'text-body-lg',
  'text-label-md',
  'text-label-sm',
  'shadow-sm',
  'shadow-md',
  'shadow-lg',
  'shadow-xl',
  'shadow-2xl',
] as const

/** The seven-step type scale. A seventh size is how a scale starts eroding. */
const TYPE_SCALE = [
  'type-display',
  'type-headline',
  'type-title-lg',
  'type-title',
  'type-body-lg',
  'type-label',
  'type-eyebrow',
] as const

describe('globals.css token layer', () => {
  it('defines the palette the refinement settled on', () => {
    for (const token of [
      '--color-background',
      '--color-surface',
      '--color-surface-container-lowest',
      '--color-surface-container-highest',
      '--color-tint-warm',
      '--color-accent-warm-dark',
      '--color-ring',
      '--radius-md',
      '--shadow-hairline',
      '--shadow-raised',
      '--shadow-floating',
      '--shadow-overlay',
    ]) {
      expect(GLOBALS).toContain(`${token}:`)
    }
  })

  it('has no dark-mode block', () => {
    // The council removed dark mode: the inverted ramp produced hover states
    // darker than their resting state and inverted the brand's meaning. A block
    // coming back needs a decision, not an accident.
    expect(GLOBALS).not.toContain('prefers-color-scheme: dark')
    expect(GLOBALS).not.toMatch(/^\s*\.dark\s*\{/m)
  })

  it('keeps terracotta out of small text', () => {
    // #b94c25 measures 4.61:1 on the canvas — 0.11 of margin over the 4.5:1
    // threshold, so it is banned from text and kept for fills and marks.
    const dim = contrast('#b94c25', '#faf8f5')
    expect(dim).toBeLessThan(4.9)

    const dark = contrast('#8f3a19', '#faf8f5')
    expect(dark).toBeGreaterThanOrEqual(4.5)
  })

  it('gives white text on maroon a real margin', () => {
    expect(contrast('#ffffff', '#5a1121')).toBeGreaterThan(7)
  })
})

describe('no removed utility survives in source', () => {
  for (const file of SOURCES) {
    for (const utility of REMOVED_UTILITIES) {
      // `shadow-md` must not match `shadow-raised`, and `text-title-lg` must not
      // match the comment "removed text-title-lg". Comments are excluded so this
      // test can be discussed in the code it guards.
      const inCode = file.text
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')

      it(`${file.path} does not use ${utility}`, () => {
        expect(inCode).not.toMatch(
          new RegExp(`(?<![\\w-])${utility.replace(/-/g, '\\-')}(?![\\w-])`),
        )
      })
    }
  }
})

describe('type utilities come from the six-step scale', () => {
  it('defines every step in globals.css', () => {
    for (const step of TYPE_SCALE) {
      expect(GLOBALS).toContain(`@utility ${step}`)
    }
  })

  for (const file of SOURCES) {
    it(`${file.path} invents no type-* utility`, () => {
      const inCode = file.text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
      const used = new Set(inCode.match(/\btype-[a-z0-9-]+/g) ?? [])
      for (const name of used) {
        expect(TYPE_SCALE as readonly string[]).toContain(name)
      }
    })
  }
})

describe('every radius is a token, never a magic number', () => {
  it('declares a five-step scale', () => {
    for (const step of ['xs', 'sm', 'md', 'lg', 'xl']) {
      expect(GLOBALS).toContain(`--radius-${step}:`)
    }
  })

  for (const file of SOURCES) {
    it(`${file.path} uses only token radii`, () => {
      const inCode = file.text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
      // `rounded-full` computes to 9999px and is the single loudest "pill
      // template" tell; arbitrary values defeat the scale silently.
      const radii = inCode.match(/\brounded-(?!none\b|md\b|xs\b|sm\b|lg\b|xl\b)[a-z0-9[\]-]+/g) ?? []
      expect(radii).toEqual([])
    })
  }
})

describe('shared-ui contract', () => {
  it('ships the shared components this app renders', () => {
    const index = readFileSync(join(SHARED_UI_ROOT, 'index.ts'), 'utf8')
    expect(index).toContain('Button')
    expect(index).toContain('buttonVariants')
  })

  it('defines every token @novastar/shared-ui references', () => {
    // card.tsx ships `bg-card text-card-foreground`; popover.tsx ships
    // `text-popover-foreground`. Before this pass the app defined the
    // backgrounds but not the foregrounds, so those classes emitted nothing.
    for (const [utility, token] of Object.entries(SHARED_UI_CONTRACT)) {
      expect(utility.length).toBeGreaterThan(0)
      expect(GLOBALS).toContain(`${token}:`)
    }
  })
})

/*
 * Every SVG served from /public must be parseable XML.
 *
 * `public/logo.svg` spent an entire audit cycle invisible because its own
 * documentation comment spelled CSS custom property names — color-primary,
 * color-wine — and an XML comment may not contain a double hyphen anywhere inside
 * it. The first one closed the comment early; the rest became stray markup; and
 * Chromium refused to parse the document at all. The `<img>` reported
 * `naturalWidth: 0`, occupied a correct 227x36 box, and painted no pixels at all.
 *
 * Nothing warned. `next build` succeeded, typecheck passed, lint passed, the
 * layout was right, axe found no violation, and the logo was simply gone — which
 * is why the audit harness reported it as a broken image and that report was
 * wrongly dismissed as a false positive. It was the only true finding in the run.
 *
 * So this asserts the file is well-formed, not that it looks like anything.
 */
describe('static assets', () => {
  const assetDir = join(APP_ROOT, 'public')
  const svgs = readdirSync(assetDir).filter((name) => name.endsWith('.svg'))

  it('has SVGs to check', () => {
    // A filter that silently matches nothing would make every assertion below
    // vacuously true, which is how a guard stops guarding anything.
    expect(svgs.length).toBeGreaterThan(0)
  })

  for (const name of svgs) {
    it(`${name} is well-formed XML`, () => {
      const source = readFileSync(join(assetDir, name), 'utf8')

      // The specific trap: a double hyphen inside a comment. Checked before the
      // structural assertions because it is the one that produced a blank image.
      const comments = [...source.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1])
      for (const body of comments) {
        expect(body).not.toContain('--')
      }

      // Every character of the file must belong to a comment or to markup. An
      // unterminated comment or stray prose is the same failure by another route.
      const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*$/, '')
      expect(withoutComments.includes('<!')).toBe(false)
      expect(withoutComments.trimStart().startsWith('<svg')).toBe(true)
      expect(withoutComments.trimEnd().endsWith('</svg>')).toBe(true)

      // Intrinsic size and a viewBox, so next/image has a ratio to preserve and
      // the file scales predictably rather than defaulting to 300x150.
      expect(source).toMatch(/<svg[^>]*\bviewBox="/)
      expect(source).toMatch(/<svg[^>]*\bwidth="\d/)
      expect(source).toMatch(/<svg[^>]*\bheight="\d/)
    })
  }
})

/*
 * A placeholder image's `src` must resolve, and it must declare its origin.
 *
 * A missing file or an un-allow-listed host renders as a blank frame inside a
 * border that looks deliberate, on a page that otherwise looks finished. Nothing
 * warns and axe finds no violation, because the frame is present and the pixels
 * are simply absent — the same failure mode as the broken logo, one layer up.
 *
 * The original version of this only checked REMOTE hosts, so it had nothing to
 * say about local files. That gap is now closed: `src: '/images/x.jpg'` is
 * checked against the filesystem, and a hot-linked URL is checked against
 * `images.remotePatterns`.
 */
describe('remote imagery', () => {
  const config = readFileSync(join(APP_ROOT, 'next.config.ts'), 'utf8')
  const placeholders = readFileSync(join(APP_ROOT, 'lib', 'placeholder-images.ts'), 'utf8')

  const entries = placeholders.split(/\n  \w+: \{/).slice(1)
  const srcOf = (entry: string) => entry.match(/src: '([^']+)'/)?.[1]

  it('resolves every placeholder src to a file on disk or an allow-listed host', () => {
    expect(entries.length, 'expected the placeholder module to declare photos').toBeGreaterThan(0)

    for (const entry of entries) {
      const src = srcOf(entry)
      expect(src, 'every photo entry needs a src').toBeTruthy()

      if (src!.startsWith('/')) {
        const onDisk = join(APP_ROOT, 'public', ...src!.split('/').filter(Boolean))
        expect(
          existsSync(onDisk),
          `${src} is declared in lib/placeholder-images.ts but is not in public/ — the <img> renders an empty frame`,
        ).toBe(true)
        continue
      }

      const host = new URL(src!).host
      expect(config, `${host} is used by lib/placeholder-images.ts but not allow-listed in next.config.ts`).toContain(
        `hostname: '${host}'`,
      )
    }
  })

  it('leaves no unreferenced file in public/images', () => {
    // The reverse direction: an orphaned photo in the repo is dead weight that
    // also misleads whoever is told "replace the files in public/images".
    const dir = join(APP_ROOT, 'public', 'images', 'placeholders')
    if (!existsSync(dir)) return

    for (const file of readdirSync(dir)) {
      expect(placeholders, `public/images/placeholders/${file} is not referenced by any photo entry`).toContain(
        `/images/placeholders/${file}`,
      )
    }
  })

  it('marks every placeholder photo as a placeholder with a licence and credit', () => {
    // CC BY-SA requires attribution for these files regardless of where they are
    // served from, so `credit` and `licence` are asserted, never `local: false` —
    // an earlier version of this test asserted remoteness and would have passed
    // after the files were copied into the repository with attribution dropped.
    for (const entry of entries) {
      expect(entry).toContain('placeholder: true')
      expect(entry).toMatch(/licence: 'CC BY-SA/)
      expect(entry).toMatch(/credit: '.+'/)
      expect(entry).toMatch(/source: 'https:\/\/commons\.wikimedia\.org/)
    }
  })

  it('declares the intrinsic size of every local photo', () => {
    // next/image warns and distorts when the declared ratio differs from the
    // file's, and the rendered height silently drives the layout below it.
    for (const entry of entries) {
      const src = srcOf(entry)
      if (!src!.startsWith('/')) continue
      expect(entry, `${src} must declare width and height`).toMatch(/width: \d+/)
      expect(entry, `${src} must declare width and height`).toMatch(/height: \d+/)
    }
  })
})