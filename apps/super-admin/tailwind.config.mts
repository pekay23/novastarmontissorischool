/**
 * Tailwind CSS v4 in JS-config compatibility mode, loaded from
 * `app/globals.css` via `@config`. Dark mode is declared there with
 * `@custom-variant dark` rather than through the legacy `darkMode` option.
 *
 * The token values below are raw HSL triplets consumed as
 * `hsl(var(--token))`, which is what `@novastar/shared-ui` expects. Changing a
 * name here without changing the `:root` block in `app/globals.css` yields an
 * unresolved colour, and Tailwind v4 drops such a utility silently rather than
 * failing the build.
 *
 * The `content` globs are what pull `@novastar/shared-ui`'s classes into the
 * build. Without them every shared-ui component renders unstyled.
 */
const config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx}',
    '../../packages/shared-ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: 'var(--font-sans), ui-sans-serif, system-ui, sans-serif',
        heading: 'var(--font-heading), ui-serif, Georgia, serif',
        mono: 'var(--font-mono), ui-monospace, Menlo, Monaco, monospace',
      },
    },
  },
  plugins: [],
}

export default config
