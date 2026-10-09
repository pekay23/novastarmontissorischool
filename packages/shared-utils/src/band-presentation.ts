// --- Band Presentation ---

/**
 * Readable text colour for a band the school picked.
 *
 * A band's `color` is whatever hex the head teacher chose, so it can be near
 * white. Colouring a badge by magnitude instead — green above 70, red below 40 —
 * is not available: bands are school-configured and the JHS default runs the
 * other way (grade 9 is the worst result and is coloured like every other worst
 * result). The badge therefore takes the school's own colour and this decides
 * only whether the text on top of it is dark or light.
 *
 * Relative luminance per WCAG 2.x, computed on the sRGB channels.
 *
 * Total on purpose. It is the function a bad colour is supposed to survive, so a
 * value that is not a string at all is a fallback like any other unparseable one:
 * `GradingLevel.color` is `NOT NULL` today, so `contrastTextColor(null)` is
 * unreachable from a stored row, but the call that crashed on it was inside a
 * render — the one place that cannot afford a `TypeError` — and this is the
 * documented safe fallback for input it cannot parse, so it must be.
 *
 * Unparseable input falls back to dark text, which is the safe default on the
 * light report card. The boundary is what makes that fallback rare rather than
 * routine: `GradingLevel.color` is constrained to `#rrggbb` on create and on
 * update, so a named colour that would render at 4.26:1 on dark text ('red') or
 * as a colourless badge ('transparent') cannot be stored in the first place.
 */
export function contrastTextColor(hex: string | null | undefined): '#0f172a' | '#ffffff' {
  const match =
    typeof hex === 'string' ? /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim()) : null
  if (!match) return '#0f172a'
  const body = match[1]!
  const full =
    body.length === 3
      ? body
          .split('')
          .map((char) => char + char)
          .join('')
      : body
  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(full.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const luminance =
    0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  return luminance > 0.179 ? '#0f172a' : '#ffffff'
}

