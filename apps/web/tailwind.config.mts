/**
 * Tailwind CSS v4 runs in JS-config compatibility mode, loaded from
 * the section stylesheets via `@config` (see app/portal.css and
 * app/admin.css). Dark mode is declared there with
 * `@custom-variant dark` instead of the legacy `darkMode` option.
 *
 * The `theme.extend.colors` mappings are what let the portal and the
 * console consume their HSL design tokens through utilities such as
 * `bg-primary` and `text-foreground` — `hsl(var(--token))`, which
 * is what `@novastar/shared-ui` expects. The marketing stylesheet
 * (app/globals.css) deliberately does NOT load this file: it defines
 * its own tokens in `@theme` and has no use for the HSL layer.
 *
 * The `content` globs are vestigial in v4 (the `@source` directives
 * in each stylesheet do that work) but are kept accurate so the file
 * still describes what it can reach.
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
