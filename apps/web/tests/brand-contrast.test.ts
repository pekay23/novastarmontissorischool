import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const stylesheet = readFileSync(
  join(import.meta.dir, '../app/globals.css'),
  'utf8',
)
function color(token: string): string {
  const match = stylesheet.match(
    new RegExp(`--color-${token}:\\s*(#[0-9a-fA-F]{6})`),
  )
  if (!match) throw new Error(`Missing color token: ${token}`)
  return match[1]
}
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    )
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}
function ratio(first: string, second: string): number {
  const a = luminance(first),
    b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('brand text contrast', () => {
  for (const token of ['primary', 'secondary', 'success', 'destructive']) {
    it(`${token} controls have readable foreground text`, () => {
      expect(
        ratio(color(token), color(`${token}-foreground`)),
      ).toBeGreaterThanOrEqual(4.5)
    })
  }
  for (const token of [
    'secondary-dark',
    'accent-warm-dark',
    'muted-foreground',
  ]) {
    it(`${token} text is readable on the neutral surface`, () => {
      expect(
        ratio(color(token), color('surface-container')),
      ).toBeGreaterThanOrEqual(4.5)
    })
  }
})
