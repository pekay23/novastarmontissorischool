/*
 * The hero's stacked planes.
 *
 * There is no photography of this school in this repository, so the depth the
 * brief asks for is built from CSS and inline SVG rather than from images. Four
 * planes, back to front:
 *
 *   0  Field      a warm smoke gradient, the volume itself
 *   1  Contour    wide radial arcs, very low contrast, gives the field a horizon
 *   2  Medallion  a botanical-and-bead motif, the focal object
 *   3  Grain      feTurbulence, dithers the gradient so it does not band
 *
 * Each plane is an absolutely-positioned layer at its own parallax rate, driven by
 * `--px`/`--py` (see `components/hero-parallax.tsx`). Because the rates live in
 * `@utility hero-plane-*` and the default is 0, the composition with no JavaScript
 * and the composition with JavaScript are the same composition at rest.
 *
 * The motif is a peace-lily leaf wreath around a strand of Montessori golden
 * beads: a botanical form that reads as pedagogy rather than as a stock
 * illustration, and the bead strand is the school's own material. It is drawn in
 * `currentColor` strokes at low opacity so it sits *in* the field rather than on
 * top of it.
 */

export function HeroField() {
  return (
    <>
      {/* Plane 0 — the volume. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(168deg, #fbf9f6 0%, #f3ede4 44%, #e6ddce 100%)',
        }}
        aria-hidden="true"
      />

      {/* Plane 1 — contour. Two wide arcs that read as a horizon and a falloff. */}
      <svg
        className="hero-plane hero-plane-back absolute inset-0 h-full w-full"
        viewBox="0 0 400 520"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <radialGradient id="hero-glow" cx="30%" cy="18%" r="78%">
            <stop offset="0%" stopColor="#fffdfa" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#fffdfa" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="520" fill="url(#hero-glow)" />
        {[210, 268, 326, 384, 442].map((r, i) => (
          <circle
            key={r}
            cx="200"
            cy="300"
            r={r}
            fill="none"
            stroke="#c9bfb0"
            strokeWidth="1"
            opacity={0.5 - i * 0.07}
          />
        ))}
      </svg>

      {/* Plane 2 — the medallion. */}
      <div className="hero-plane hero-plane-mid absolute inset-0 grid place-items-center">
        <svg
          viewBox="0 0 240 240"
          className="h-[62%] w-[62%] max-h-[15rem] max-w-[15rem] text-[#a89684]"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.9"
        >
          {/* Leaf wreath: eight peace-lily leaves around the centre. */}
          {Array.from({ length: 8 }, (_, i) => {
            const angle = (i * 360) / 8
            return (
              <g key={angle} transform={`rotate(${angle} 120 120)`}>
                <path d="M120 44 C 132 62, 134 82, 120 96 C 106 82, 108 62, 120 44 Z" />
                <path d="M120 96 L120 40" strokeWidth="0.9" opacity="0.55" />
              </g>
            )
          })}

          {/* Inner ring. */}
          <circle cx="120" cy="120" r="70" opacity="0.5" />

          {/* Golden-bead strand: units, tens, hundreds, thousands. Four strands,
              graduated, the concrete material the arithmetic is built from. */}
          <g opacity="0.85">
            {[0, 1, 2, 3].map((row) =>
              [0, 1, 2, 3].map((col) => (
                <circle
                  key={`${row}-${col}`}
                  cx={86 + col * 22 + row * 5}
                  cy={100 + row * 14}
                  r={7 - row * 0.9}
                  opacity={0.9 - row * 0.12}
                />
              )),
            )}
          </g>

          {/* Baseline the beads stand on. */}
          <path d="M78 152 L162 152" strokeWidth="1" opacity="0.45" />
        </svg>
      </div>

      {/* Plane 3 — grain. Its job is dithering, not texture: the field is a very
          low-chroma gradient and at this lightness an 8-bit panel bands it. */}
      <div className="hero-plane hero-plane-front grain absolute inset-0 opacity-[0.045]" aria-hidden="true" />
    </>
  )
}
