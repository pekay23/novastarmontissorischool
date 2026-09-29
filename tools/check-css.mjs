// Throwaway harness: run the Tailwind v4 PostCSS plugin over an app's
// globals.css and report which utilities actually got generated.
// Usage: node tools/check-css.mjs apps/portal
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const appDir = path.resolve(process.argv[2] ?? 'apps/portal')
const appRequire = createRequire(path.join(appDir, 'package.json'))

const postcss = appRequire('postcss')
const tailwind = appRequire('@tailwindcss/postcss')

const cssPath = path.join(appDir, 'app', 'globals.css')
const css = fs.readFileSync(cssPath, 'utf8')

const result = await postcss([tailwind.default ? tailwind.default() : tailwind()]).process(css, {
  from: cssPath,
})

const out = result.css
const outPath = path.join(appDir, '.css-check.css')
fs.writeFileSync(outPath, out)

console.log('input bytes :', css.length)
console.log('output bytes:', out.length)
console.log('warnings    :', result.warnings().map((w) => w.text).join(' | ') || '(none)')

const probes = [
  '.bg-primary',
  '.text-primary-foreground',
  '.bg-background',
  '.text-foreground',
  '.text-muted-foreground',
  '.border-border',
  '.bg-popover',
  '.text-popover-foreground',
  '.text-destructive',
  '.bg-card',
  '.font-heading',
  '.container',
  '.flex',
  '.rounded-md',
]
for (const p of probes) {
  console.log(String(out.includes(p)).padEnd(6), p)
}
console.log('\nwrote', outPath)
