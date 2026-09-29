# Phase 5 Audit — Shared Packages

**Repo:** Novastar Montessori School monorepo (`C:\Projects\novastarmontissorischool`)
**Date:** 2026-09-28
**Scope:** All 12 packages under `packages/` plus the plugin surface
**Method:** Static read of every source file, plus live verification via `bun run typecheck`, `bun run lint`, ESLint config resolution probes, Tailwind CSS compilation inspection, and dependency-usage greps.

---

## 0. Executive summary

The monorepo **typechecks and lints clean** (11/11 and 12/12 turbo tasks pass). That result is misleading. The audit found **5 Critical, 21 High, 24 Medium, 17 Low** findings, and the headline is a single sentence:

> **Of the 12 packages in scope, only 3 are actually used by an application. Eight are unconsumed scaffolding, one is an empty file, and three do not exist.**

The most severe problems are not stylistic:

- `packages/auth` does **not** contain NextAuth, a credentials provider, a Prisma adapter, or any session logic. It declares `next-auth` and `bcryptjs` as dependencies and imports neither. The real auth config lives in `apps/portal/lib/auth.ts`. The package's actual subject — RBAC and permission delegation — contains a **privilege-escalation path** and two **cross-tenant IDOR** paths.
- `packages/plugin-registry/` and all six `packages/plugins/*` directories are **empty**. There is no plugin system. `packages/reports/index.ts` is a 2-line stub. `packages/sync-engine/index.ts` is a stub whose only implemented method returns a value it never persists.
- `packages/shared-ui` — the highest-priority package — has **no theme tokens that resolve**, a **broken build** (`main` points at a file that is never emitted), a **circular self-import**, a **Calendar built against the wrong major version of react-day-picker**, and **no focus ring on any primary form control**.
- `packages/shared-types` ships a "single source of truth" entity registry whose outer object is `as`-cast (so nothing validates it) and which **references 5 entity types the type enum forbids** while leaving 9 enum members undefined.

**Remediation posture:** the four Critical items are individually cheap to fix. The systemic item — 8 unconsumed packages — is a decision that must be made, not a bug that can be patched.

---

## 1. Inventory and ground truth

| Package | Files (src) | LOC (approx) | Consumed by an app? | Test script | Typechecked by turbo | Notes |
|---|---|---|---|---|---|---|
| `shared-ui` | 34 | ~4,300 | **Yes** (portal, public-site) | none | yes | Only package with a build script; build is broken |
| `shared-types` | 2 | ~900 | **Yes** (portal) | none | yes | Two source files only |
| `shared-utils` | 1 | ~230 | **Yes** (portal, public-site) | none | yes | |
| `auth` | 1 | ~370 | No | none | yes | Not auth — it's RBAC/delegation |
| `notifications` | 1 | ~290 | No | none | yes | |
| `payments` | 1 | ~390 | No | none | yes | |
| `ghana-education` | 1 | ~390 | No | none | yes | |
| `reports` | 1 | **2** | No | none | yes | Stub: `export const reports = {}` |
| `sync-engine` | 1 | ~75 | No | `bun test` (0 tests) | **no** | No `typecheck` script |
| `plugin-registry` | **0** | 0 | No | — | n/a | Empty directory |
| `plugins/*` (6) | **0** | 0 | No | — | n/a | All six empty directories |
| `testing` | **0** | 0 | No | — | n/a | Empty directory |

**Verification of the "consumed?" column** — `grep` for `from '@novastar/<pkg>'` across `apps/**/*.ts{,x}` returned 44 matches: 30 to `shared-ui`, 9 to `shared-types`, 5 to `shared-utils`, and **zero** for `auth`, `payments`, `notifications`, `ghana-education`, `reports`, `sync-engine`, `plugin-registry`, `plugins`, `testing`.

Note that `apps/portal/package.json` nonetheless declares `@novastar/auth`, `@novastar/ghana-education`, `@novastar/notifications`, `@novastar/payments`, and `@novastar/sync-engine` as `workspace:*` dependencies. Five dead dependency edges in the app manifest.

**Excluded from this report's scope but load-bearing:** `packages/database` and `tools/db-mirror`. `database` is analyzed only where a sibling package's contract depends on it (§9).

---

## 2. Cross-package dependency graph

Solid = declared. Dashed = imported but **not** declared.

```
                              ┌─────────────────┐
                              │  shared-types   │  (zod; devDep only, used at runtime)
                              └────────┬────────┘
                     ┌─────────────────┼──────────────────┐
                     │  (Phase)        │ (DEFAULT_ENTITY_  │
                     ▼                 │  REGISTRY)        │
        ┌────────────────────────┐    └──────────────────┘
        │  ghana-education       │◄── ⚠ missing from its package.json
        │  date-fns only        │    (works only via workspace hoisting)
        └────────────────────────┘

        ┌────────────────────────┐
        │    shared-utils       │  date-fns
        │  peerDep: zod ⚠       │  ⚠ zod is a peerDependency and is
        │  ⚠ zod never imported  │    never imported
        └────────────────────────┘

        ┌────────────────────────┐
        │    shared-ui          │  17 radix + cva/clsx/tailwind-merge
        │  ⚠ self-referential   │──┐  + zod(unused) + date-fns + rdp + rhf
        │    circular import    │  │  + @tanstack/react-{table,virtual}
        └────────────────────────┘  │
                                     │  use-confirm.tsx imports
                                     │  '@novastar/shared-ui'
                                     └──► back into the barrel

   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
   │    auth      │    │notifications │    │   payments   │
   │ peer: db,    │    │ peer: db,    │    │ peer: db,    │
   │      s-types │    │      s-types │    │      notifs  │
   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
          │                   │                   │
          └───────────────────┴───────────────────┘
                              │ import { prisma } from '@novastar/database'
                              ▼
                   ┌────────────────────┐
                   │     database       │  ⚠ prisma Proxy returns [] for
                   │  ⚠ silent mock DB  │    every query when DATABASE_URL
                   └────────────────────┘    is missing

   ┌────────────────────┐
   │    sync-engine     │  deps: idb ⚠ (never imported), database, s-types
   │  ⚠ 100% stub       │  ⚠ NO typecheck script
   └────────────────────┘

   ┌────────────────────┐
   │     reports        │  deps: @react-pdf/renderer, csv-string, zod,
   │  ⚠ 2-line stub     │        @novastar/database — ALL UNUSED
   └────────────────────┘

   ┌──────────────────────────────────────────┐
   │  plugin-registry   ◉ empty directory     │  ⚠ tsconfig.base.json declares a
   │  plugins/{alumni,analytics,canteen,      │    paths entry for a path that
   │           clinic,learning,library}       │    does not exist
   │           ◉ all six empty                │
   │  testing           ◉ empty               │
   └──────────────────────────────────────────┘

   ══ NOT WIRED AT ALL ══
   apps/portal/lib/auth.ts  ◄── the real NextAuth v4 config + Credentials
                              provider + PrismaAdapter lives HERE, not in
                              packages/auth. packages/auth declares
                              next-auth@^4.24.15 and imports it nowhere.
```

### Dependency hygiene issues (whole-tree)

| # | Issue | Severity |
|---|---|---|
| D1 | `ghana-education` imports `Phase` from `@novastar/shared-types` but does not declare it. Resolves only through hoisting; an isolated or `bun install --frozen-lockfile --production` install of the workspace graph can break. | High |
| D2 | `shared-types` imports `zod` at runtime but lists it under **`devDependencies`**. Any consumer that installs without dev deps gets a runtime resolution failure. | High |
| D3 | `ghana-education` declares `zod` as a devDependency and never imports it. | Low |
| D4 | `shared-utils` declares `zod` as a `peerDependency` and never imports it; it is not marked optional, so npm/bun emit unmet-peer warnings. | Low |
| D5 | `auth`, `notifications`, `payments` declare internal workspace packages as `peerDependencies` instead of `dependencies: { "workspace:*" }`. For packages that are never published, peers are the wrong relationship and produce unresolvable-peer warnings on install. | Medium |
| D6 | `reports` declares `@novastar/database` as a `dependencies` entry while every sibling declares it as a peer. Inconsistent and unprincipled — the package imports nothing. | Low |
| D7 | `auth` declares `@prisma/client` as a direct dependency but imports `prisma` exclusively from `@novastar/database`. Redundant edge that invites a second, unconfigured client instance. | Medium |
| D8 | `database` declares `pg`, `@prisma/adapter-pg`, and `dotenv` as dependencies; only `@prisma/adapter-neon` is used and `dotenv` is never imported. | Medium |
| D9 | `auth` pins `bcryptjs@^2.4.3`; root and portal both pin `^3.0.3`; portal also uses `@node-rs/argon2` **and** `argon2`. Four hashing paths across the tree, none of which the auth package uses. | High |
| D10 | `shared-ui` declares `zod`, `@radix-ui/react-context`, `@radix-ui/react-slider`, `@radix-ui/react-toast`, and `@tanstack/react-virtual` — **all five have zero imports** (verified by grep). Shipped to every consumer. | Medium |
| D11 | `tsconfig.base.json` maps only `@novastar/<pkg>/*` subpaths, never the bare `@novastar/<pkg>` specifier. Bare resolution depends entirely on the workspace symlink + `main: index.ts` convention. No `exports` map exists on any package, so deep imports (`@novastar/shared-ui/src/components/button`) remain reachable and bypass every barrel. | Medium |
| D12 | `shared-ui/tsconfig.json` maps `@novastar/*` → `../../packages/*/index.ts`. This resolves `@novastar/shared-types` only by the accident that `*` captures `shared-types` and appends `/index.ts`. It breaks for any subpath, e.g. `@novastar/shared-types/config-schema`. | Medium |

---

## 3. `packages/shared-ui` — Component Library (highest priority)

31 components + 3 lib files. The Radix composition skeletons are recognisably shadcn-derived and mostly well-formed. The failures are concentrated in three places: the build, the theme layer, and the three components that were hand-rolled instead of composed.

### 3.1 Build and packaging — Critical

| # | Finding | Evidence |
|---|---|---|
| UI-1 | **`main` and `module` point at files that are never produced.** `package.json` declares `"main": "./dist/index.js"`, `"module": "./dist/index.mjs"`. `dist/` contains exactly one file: `index.css`. The `build` script is `tsc --project tsconfig.json`, and that tsconfig sets `"noEmit": true` — so `tsc` emits nothing, ever. Any consumer that resolves `main` at runtime gets module-not-found. | `packages/shared-ui/package.json:3-5`; `tsconfig.json:9`; `ls dist/` → `index.css` only |
| UI-2 | **The design tokens are never compiled.** `scripts/build-css.js` reads `../src/index.css` — a 3-line file containing only `@tailwind base/components/utilities`. The file that actually holds every design token (`:root { --background: … }`, `.dark { … }`, the `@apply border-border` reset) lives at `packages/shared-ui/src/src/index.css` — a nonsensical double-nested path that nothing references. | `scripts/build-css.js:11`; `src/index.css` (3 lines) vs `src/src/index.css` (63 lines) |
| UI-3 | **Verified: the compiled stylesheet contains zero theme utilities.** `grep -c "bg-background" packages/shared-ui/dist/index.css` → **0**. `grep "bg-background\|--background\|\.dark"` → 0 matches. Every `bg-background`, `text-foreground`, `border-input`, `bg-primary`, `ring-ring` in all 31 components is a **no-op** as shipped. The library is not self-sufficient. | measured on the committed `dist/index.css` (11,286 bytes) |
| UI-4 | `src/index.css` uses Tailwind **v3** directives (`@tailwind base; @tailwind components; @tailwind utilities;`). The package pins `tailwindcss@^4.3.3`, whose canonical entry is `@import "tailwindcss"`. The build happens to emit something, but the file is on a legacy compatibility path. | `src/index.css:1-3` |
| UI-5 | `dist/index.css` is never consumed by anything. `apps/portal/app/globals.css` uses `@source "../../../packages/shared-ui/src"` and generates its own CSS with `@config "../tailwind.config.ts"` + `hsl(var(--token))`. The whole `build:css` pipeline is vestigial. | `apps/portal/app/globals.css:1-3` |
| UI-6 | `package.json` has no `sideEffects` field and no `exports` map. Bundlers cannot prove the package is side-effect free (it exports `ThemeProvider`, context providers, and cva calls), and deep imports bypass the barrel. | `packages/shared-ui/package.json` |
| UI-7 | `files: ["dist"]` on a `private: true` package — contradictory metadata. | `package.json:2,6` |
| UI-8 | Storybook is **declared but entirely absent**: `storybook` and `storybook:build` scripts exist, root has `@storybook/react@^10.5.10` and `@storybook/nextjs@^10.5.10`, but there is **no `.storybook/` directory anywhere in the repo and zero `*.stories.tsx` files**. Both scripts fail. | verified by directory scan and file glob |
| UI-9 | **Zero tests.** No test script, no test files, no `@testing-library` usage in the package, despite the root providing those deps. | verified |

### 3.2 Architecture and exports

| # | Finding | Severity | Evidence |
|---|---|---|---|
| UI-10 | **Circular self-import.** `index.ts` exports `ConfirmProvider, useConfirm` from `use-confirm.tsx`, and `use-confirm.tsx` imports `{ Dialog, DialogContent, …, Button }` from `'@novastar/shared-ui'` — the package's own barrel. This works only by ESM live-binding order accident and defeats bundler tree-shaking. | **High** | `src/components/use-confirm.tsx:7-14` |
| UI-11 | **Two competing toast systems.** `toast.tsx` (7 presentational components) is exported from the barrel, but `PortalToastProvider` in `use-toast.tsx` never uses it — it hand-rolls a `ToastItem` with raw `<div>`s. `@radix-ui/react-toast` is a declared dependency and is **never imported**. Consumers importing `Toast`, `ToastViewport`, `ToastAction` from the barrel get inert divs with no portal, no timers, no focus management, no swipe, no live region. | **High** | `toast.tsx` vs `use-toast.tsx`; grep: `@radix-ui/react-toast` → 0 imports |
| UI-12 | **`lib/constants.ts` is a copy-paste of `lib/utils.ts`.** It re-declares `cn` verbatim and then appends the colour constants. `utils.ts` does `export * from './constants'`, so `cn` is exported twice from the same module graph. `lib/index.ts` re-exports both. Dead code that will confuse the next reader. | Medium | `src/lib/constants.ts:1-7` |
| UI-13 | `DialogPortal` and `DialogOverlay` are defined in `dialog.tsx` but **not exported** from the barrel, so consumers cannot customise portal container or overlay. `Calendar` is likewise defined but not exported, so the date-picker's calendar is not customisable. | Medium | `index.ts` export list |
| UI-14 | `export { DataTabled }` — the typo `DataTabled` is baked into the **public API**. | Medium | `index.ts:44`, `data-table.tsx:19` |
| UI-15 | Mojibake in committed source. `// Design System â€” Exports` is a UTF-8 em-dash read as cp1252. Same corruption in `sync-engine/index.ts` and `eslint.config.mjs`. | Low | `index.ts:2` |
| UI-16 | `'use client'` distribution (21 of 31) is broadly correct, but `alert.tsx`, `badge.tsx`, `breadcrumb.tsx`, `table.tsx` spread arbitrary DOM props including possible event handlers while remaining Server Components — a server caller passing `onClick` fails at render with no in-library error message. | Low | component headers |

### 3.3 Accessibility

| # | Finding | Severity | WCAG | Evidence |
|---|---|---|---|---|
| UI-17 | **No focus ring on any primary form control.** `input.tsx`, `textarea.tsx`, and `select.tsx`'s trigger all use `focus-within:ring-*`. A form control can never *contain* focus, so `focus-within` never matches. Should be `focus-visible:ring-*`. Keyboard users get zero focus indication on inputs, textareas, and selects. | **High** | 2.4.7 | `input.tsx:16`, `textarea.tsx:14`, `select.tsx:20` |
| UI-18 | **`FormControl` renders a plain `<div>` instead of `Slot`.** Radix controls (`Checkbox`, `Switch`, `RadioGroupItem`, `SelectTrigger`) only receive their generated `id`/`aria-describedby`/`aria-labelledby` when the child forwards them. Wrapping in a `div` discards all of it, so the control is programmatically unlabelled. | **High** | 1.3.1, 4.1.2 | `form.tsx:78-85` |
| UI-19 | **`FormLabel` never sets `htmlFor`.** There is no `formItemId` anywhere in the module, so the label element is never associated with its control. Combined with UI-18, the entire form abstraction is unlabelled. | **High** | 1.3.1, 3.3.2 | `form.tsx:66-76` |
| UI-20 | **`FormMessage` never reads `fieldState.error`.** It renders `{children}` only. The consumer must thread the error manually, and the component name promises otherwise. | **High** | 3.3.1 | `form.tsx:87-100` |
| UI-21 | **`Progress` never forwards `value` to the Radix Root.** `value` is destructured out of props and only used for an inline `transform`. Radix therefore omits `aria-valuenow`, exposing the progress bar to assistive tech as indeterminate. | **High** | 4.1.2 | `progress.tsx:19-30` |
| UI-22 | **Toasts are never announced.** `Toaster`'s container has no `aria-live`, and the close button is an `X` icon with **no accessible name** (no `aria-label`, no `sr-only` text). | **High** | 4.1.2, 4.1.3 | `use-toast.tsx:129-166` |
| UI-23 | **`DataTabled` renders no header row at all.** There is no `<thead>` and `table.getHeaderGroups()` is never called, so every `ColumnDef.header` is discarded and the table has no column headers. | **High** | 1.3.1 | `data-table.tsx:29-52` |
| UI-24 | `toast.tsx`'s primitives carry no `role="status"` / `aria-live` / `aria-atomic`; `ToastViewport` is a bare `<div>`. | Medium | 4.1.3 | `toast.tsx:120-134` |
| UI-25 | `radio-group.tsx` uses `focus:outline-none` (not `focus-visible`) — suppresses the focus ring for pointer interaction too. | Medium | 2.4.7 | `radio-group.tsx:22` |
| UI-26 | `accordion.tsx` hardcodes `AccordionPrimitive.Header` with no `HeadingLevel`, so every trigger is an `<h3>` regardless of page hierarchy. shadcn exposes this as a prop. | Medium | 1.3.1 | `accordion.tsx:22` |
| UI-27 | `Breadcrumb` uses `aria-label="breadcrumb"` (lowercase slug) rather than a human-readable label. | Low | 2.4.6 | `breadcrumb.tsx:10` |
| UI-28 | `ToastVariant` is typed `VariantProps<…>['variant']`, i.e. it includes `null`/`undefined` from cva's optional variants — so `toastVariants({ variant: toast.variant })` is always called with a possibly-undefined value. Works by defaulting, but the public type is looser than intended. | Low | — | `use-toast.tsx:21` |

### 3.4 Component API and behaviour

| # | Finding | Severity | Evidence |
|---|---|---|---|
| UI-29 | **The `Switch` is visually inert.** The `Thumb` has no `data-[state=checked]:translate-x-4` and the `Root` has no `data-[state=checked]:bg-primary`. It looks identical in both states; only Radix's hidden `role="switch" aria-checked` conveys state to AT. | **High** | `switch.tsx:23-30` |
| UI-30 | **`Checkbox` Root has no `data-[state=checked]:` background** — only the `Check` glyph appears. The box itself never fills. | Medium | `checkbox.tsx:19-27` |
| UI-31 | **`Calendar` is written against the react-day-picker v8 API while the package pins v10.0.1.** v10's `ClassNames` is keyed by the `UI`/`SelectionState`/`DayFlag` union (`months`, `month`, `nav`, `button_previous`, `button_next`, `month_caption`, `caption_label`, `weekdays`, `weekday`, `week`, `weeks`, `day`, `today`, `outside`, `disabled`, `hidden`, `root`, …). The file supplies 11 v8-only keys — `nav_button`, `nav_button_previous`, `nav_button_next`, `head_row`, `head_cell`, `row`, `cell`, `button`, `button_selected`, `button_disabled` — and both objects are cast `as any`, so **TypeScript cannot catch it and all 11 silently no-op**. `DatePicker` renders a near-unstyled calendar. | **High** | `calendar.tsx:20-46`; installed version confirmed `10.0.1` |
| UI-32 | **`Button` does not wrap cva in `cn()`.** `cn(buttonVariants({ variant, size, className }))` — the inner `cn` has nothing to merge. shadcn's contract is `cn(buttonVariants({…}), className)` so `twMerge` can resolve conflicts. Here a consumer's `className="bg-red-500"` competes with `bg-primary` by **stylesheet order, not specificity**. | Medium | `button.tsx:44-47` |
| UI-33 | **`FormField` erases react-hook-form's generics.** `useFormContext()` is called with no type argument; `FormFieldProps<FieldValues, FieldPath<FieldValues>>` fixes `TFieldValues` to the base; and the render prop types `field`/`fieldState`/`formState` as `Record<string, unknown>`. The consumer gets **no typed `value`, `onChange`, or `error`**. This is the single largest type-safety regression in the library. | **High** | `form.tsx:18-46` |
| UI-34 | `FormField` is typed `forwardRef<HTMLFormElement, …>` but renders a `Controller` (not a form) and discards the ref as `_ref`. The ref type is a lie. | Medium | `form.tsx:35-46` |
| UI-35 | **`ThemeProvider` does not persist and does not react to OS changes.** No `localStorage` write, no `matchMedia` `change` listener, and the `attribute` prop is accepted and discarded (`attribute: _attribute = 'class'`). Theme resets to `system` on every reload. The class is applied in `useEffect`, so there is a flash of the wrong theme on every load. | **High** | `theme-provider.tsx:16-44` |
| UI-36 | **Two competing theme systems.** `ThemeProvider` is exported from the barrel, but the portal actually uses `next-themes@^0.4.6` — `globals.css` documents *"next-themes is mounted with attribute='class'"*. Both mutate the same `documentElement` class. Any app that imports both will fight. | **High** | `theme-provider.tsx` vs `apps/portal/app/globals.css:5-8`, portal deps |
| UI-37 | **`Skeleton`'s `animate-shimmer` is undefined.** Grep across both `globals.css` files, both `tailwind.config.ts` files, and both shared-ui CSS files: zero matches. The shimmer overlay is a static gradient that never animates. | Medium | `skeleton.tsx:15`; grep → 0 |
| UI-38 | **`toastVariants` success/warning/info are light-mode-only** — `bg-green-50 text-green-900`, `bg-amber-50 text-amber-900`, `bg-blue-50 text-blue-900` with no `dark:` variants. Unreadable in dark mode. | Medium | `use-toast.tsx:9-13` |
| UI-39 | `toastVariants` uses `data-[state=open]:animate-in`, `fade-out-0`, `slide-in-from-*` — these require `tailwindcss-animate` or `tw-animate-css`, neither of which is installed. All animation utilities are dead. | Medium | `use-toast.tsx:4` |
| UI-40 | `PortalToastProvider`'s auto-dismiss `setTimeout` is never cleared on unmount, and `duration: 0` means "never dismiss" with no programmatic dismiss path. | Medium | `use-toast.tsx:84-91` |
| UI-41 | **`BreadcrumbLink` declares `asChild?: boolean` and ignores it** — no `Slot` is used. The prop is a public API that silently does nothing. | Medium | `breadcrumb.tsx:33-45` |
| UI-42 | **`CardTitle` / `CardDescription` ref types are wrong.** Both are typed `HTMLParagraphElement` while rendering `<h3>` and `<p>` respectively. `CardTitle`'s props type is `React.HTMLAttributes<HTMLHeadingElement>` (correct) but its ref type is not — an inconsistent half-fix. | Medium | `card.tsx:44-63` |
| UI-43 | `DataTabled` re-implements the table instead of composing the library's own `Table`/`TableHead`/`TableBody` primitives. Two competing table implementations ship in the same barrel. No sorting, no filtering, no pagination, no row-selection wiring (yet it reads `row.getIsSelected()`), despite exporting `SortingState` and `VisibilityState` types. `@tanstack/react-virtual` is installed for none of it. | Medium | `data-table.tsx` |
| UI-44 | `use-confirm.tsx` does `React.createContext<ConfirmContext>(undefined as never)` — a deliberate type lie that makes `useConfirm()` compile while it will throw `Cannot read properties of undefined` outside a provider. The sibling `useTheme` and `useToast` both use the correct `createContext<T \| undefined>(undefined)` + throw pattern; this one does not. | Medium | `use-confirm.tsx:21` |
| UI-45 | `BreadcrumbSeparator` and `BreadcrumbEllipsis` are plain functions with no `forwardRef`, inconsistent with the 20 other components. | Low | `breadcrumb.tsx:57-71` |
| UI-46 | `input.tsx` / `textarea.tsx` declare `export interface XProps extends React.XxxHTMLAttributes<…> {}` — empty interfaces, and the `React` namespace is used **without importing it** (`button.tsx` does the same). It compiles only because `@types/react` declares a UMD global, which is a value-space hazard and a code smell. `@typescript-eslint/no-empty-object-type` is disabled repo-wide, so nothing catches it. | Low | `input.tsx:4-5`, `textarea.tsx:4-5`, `button.tsx:35` |
| UI-47 | `SelectContent` is aliased directly to `SelectPrimitive.Content` with **no Portal, no positioned wrapper, and no ScrollUp/ScrollDown affordances**; `SelectGroup`, `SelectLabel`, and `SelectSeparator` do not exist. Any real dropdown with grouped or scrollable options is unbuildable from this API. | Medium | `select.tsx:44-47` |
| UI-48 | cva is used in only 4 of 31 components (`button`, `badge`, `alert`, `use-toast`). The library's own bar is inconsistent: `card`, `input`, `dialog`, `tabs`, `toast`, `table`, `breadcrumb`, `skeleton` all hand-roll static class strings with no variant axis. | Low | all `src/components/*` |

### 3.5 What shared-ui gets right

Worth stating explicitly, because it is a real foundation:

- **`asChild` via `Slot` is correct and used properly** on `Button` — the one place the pattern matters most. `dialog.tsx`'s close button also correctly wraps a `<button>` in `Close asChild`.
- **Every Radix-wrapped component uses `React.ElementRef<typeof X>` + `React.ComponentPropsWithoutRef<typeof X>`** rather than hand-written prop interfaces. This is the modern, correct pattern and it is applied consistently across all 15 Radix components.
- **Every component sets `displayName`** — the single most common omission in component libraries is absent here.
- **`cn()` is a correct `twMerge(clsx(...))`** with `ClassValue` typing.
- **Focus rings are correctly `focus-visible:` on the Radix-based controls** (`button`, `checkbox`, `tabs`, `tooltip`, `dialog`) — the bug in UI-17 is confined to the three hand-rolled form controls.
- **`'use client'` is applied to every component that uses hooks, context, or Radix state**, and omitted from the 10 genuinely static ones.

---

## 4. `packages/shared-types` — Schemas and Types

Two files, 921 lines. The *pattern* is good; the *enforcement* is where it fails.

### 4.1 Validation quality

| # | Finding | Severity | Evidence |
|---|---|---|---|
| ST-1 | **`DEFAULT_ENTITY_REGISTRY` references 5 entity types that `EntityTypeSchema` forbids.** Verified by diffing the enum against the registry: `class`, `fee_line_item`, `staff`, `student`, `parent` appear in the registry but are absent from the 26-member `EntityTypeSchema`. This is invisible because the array is closed with `as EntityDefinition[]` (line 634), which **discards the guarantee that the `fields` validation was establishing**. | **High** | `config-schema.ts:24-51` (enum) vs `:468, :548, :566, :590, :614` (registry); `:634` (the cast) |
| ST-2 | **The same cast leaves 9 enum members with no field definition at all**: `class_subject`, `permission`, `delegation_rule`, `staff_role`, `report_template`, `attendance_rule`, `promotion_rule`, `attendance_taker`, `communication_template`. An admin UI that renders "every entity type" will show nine entries with zero fields. | Medium | diff of the two lists |
| ST-3 | **No cross-field validation anywhere.** `TermSchema` does not check `endDate > startDate`; `AcademicYearSchema` does not check `start < end`; `GradingLevelSchema` does not check `minScore <= maxScore`; `ClassLevelSchema` does not check `ageMin <= ageMax`. A grading level with `minScore: 80, maxScore: 40` passes validation, never matches in `determineGrade`, and silently falls through to the "closest below" path. For a grading system that prints report cards, this is the highest-consequence missing constraint. | **High** | `index.ts:73-100`, `:131-141` |
| ST-4 | **The permission key regex forbids wildcards the rest of the codebase depends on.** `PermissionSchema.key` is `/^[a-z]+:[a-z]+$/` — no digits, hyphens, underscores, or third segments. But `auth`'s `getDefaultDelegationRules` emits `'academic:*'`, `'finance:*'`, `'payment:*'`, `'fee:*'`, `'attendance:*'`. Every wildcard key the delegation system relies on is **rejected by its own permission schema**. | **High** | `index.ts:185` vs `auth/index.ts:286-300` |
| ST-5 | `NotificationType` is a **bare string union, not a Zod schema** — the only type in the file that is. Nothing can validate it, and it duplicates the Prisma `NotificationType` enum (which `database/index.ts:116` re-exports) with a **different member set**. Two competing sources of truth. | **High** | `index.ts:270` |
| ST-6 | **No branded types.** Every ID is `z.string().cuid()`, which infers to plain `string`. `tenantId`, `schoolId`, `userId`, `studentId`, and `invoiceId` are mutually assignable in every signature across all packages. For a system whose central invariant is tenant isolation, the type system enforces none of it. | **High** | `index.ts:32-67` and everywhere |
| ST-7 | **Base-schema adoption is inconsistent.** `ConfigEntityBaseSchema` is correctly `.extend`ed by 9 schemas, but `GradingLevelSchema`, `DelegationRuleSchema`, and `DelegationSchema` re-declare the same `id`/`tenantId`/`createdAt`/`updatedAt` fields by hand. Two places to change when the base evolves. | Medium | `index.ts:61-67, :131-141, :194-202, :213-228` |
| ST-8 | **Zod v4 legacy string methods.** `z.string().url()` and `z.string().email()` are the v3 spellings; v4 prefers top-level `z.url()` / `z.email()`. Functional, but on the deprecated path. | Low | `index.ts:36, :50, :185` |
| ST-9 | **`PaginatedResponseSchema` is a factory function with a schema-shaped name and no exported type.** Callers must re-derive `PaginatedResponse<T>` by hand. Its `meta` block carries `totalPages`, `hasNext`, and `hasPrev`, all derivable from `page`/`limit`/`total`, with no refinement guaranteeing consistency. (The portal route re-implements this exact block inline — see §10.) | Medium | `index.ts:18-29` |
| ST-10 | **`DEFAULT_ENTITY_REGISTRY` performs ~140 Zod parses at module load.** 22 entities × 3–10 fields, each run through `EntityFieldSchema.parse()` on every import of `@novastar/shared-types` — including in every server route and every client bundle that touches the registry. This is the package's only module-level side effect. | Medium | `config-schema.ts:276, :294, :307, …` |
| ST-11 | **Field `order` is never assigned.** Every `*Fields` array omits `order`, so all fields parse to `order: 0`. Any consumer that sorts by `order` gets an unstable, effectively arbitrary form field sequence. | Medium | `config-schema.ts:123-234` |
| ST-12 | `EntityFieldSchema.dependsOn` supports only strict string equality (`{ field, value }`). No boolean or enum support, which is the common case for conditional admin forms. | Low | `config-schema.ts:79-82` |
| ST-13 | **`ConfigurableEntitySchema` is a dead export** — defined at line 9, referenced nowhere in the repo (verified by grep across all packages and both apps). | Low | `config-schema.ts:9` |
| ST-14 | **Declaration ordering is broken.** `export type UserRole = z.infer<typeof UserRoleEnum>` appears at line 240, but `UserRoleEnum` is declared at line 272 — a 32-line forward type query. `NotificationType` at line 270 is indented two spaces deeper than every sibling, showing the file was appended to incrementally rather than composed. | Low | `index.ts:240, :270, :272` |
| ST-15 | `EntityTypeSchema` has 26 members but only 22 are defined in the registry (ST-1/ST-2). Neither list is derived from the other, and nothing validates the relationship. | — | — |

### 4.2 What shared-types gets right

- **`ConfigEntityBaseSchema` + `.extend()` is exactly the right composition pattern** for a config-driven domain, and it is applied to 9 schemas including the nested `GradingScaleSchema.levels` array.
- **`PaginatedResponseSchema` as a generic factory** is the correct shape for a reusable envelope.
- **`z.infer` throughout** — no hand-maintained duplicate interfaces for schema-bearing types.
- **Coercion is deliberate and correct** for query input: `z.coerce.number().int().positive().max(100)` correctly rejects `NaN` (from `?page=abc`), `0`, and `Infinity` in Zod v4.
- **The dual-language (En/Twi) field modelling** (`bodyEn`/`bodyTw`, `translatable: true`, `excerptEn`/`excerptTw`) is a thoughtful domain fit.

---

## 5. `packages/auth` — RBAC and Delegation

**Scope correction, stated up front:** this package does **not** contain NextAuth, a credentials provider, session handling, or a Prisma adapter. It contains dynamic RBAC plus permission delegation. The NextAuth configuration — `NextAuthOptions`, the `Credentials` provider, `PrismaAdapter`, the `jwt`/`session` callbacks — lives at `apps/portal/lib/auth.ts`. `packages/auth/package.json` declares `next-auth@^4.24.15` and `bcryptjs@^2.4.3` and **imports neither**; `next-auth` is not even installed in `packages/auth/node_modules` or the root.

### 5.1 Security findings

| # | Finding | Severity | Evidence |
|---|---|---|---|
| AU-1 | **Any user can delegate any permission to anyone — the delegation rules are never applied.** `getDelegationRules(roleId, tenantId)` fetches the role row, then discards it and looks the role up in `getDefaultDelegationRules()` **keyed by the role's `id` (a cuid)**, while the map is keyed by role *names* (`'HEADMASTER'`, `'ASSISTANT_HEAD'`, `'ACADEMIC_COORD'`, `'BURSAR'`). The lookup therefore **never matches**, every role falls through to the `|| ['*']` default, and `createDelegation`'s check `rule.permissions.includes(perm) || rule.permissions.includes('*')` passes for every permission. Net effect: any authenticated user can create a delegation granting themselves or anyone else any permission in the system. | **Critical** | `auth/index.ts:256-274` (the `role.id` lookup) vs `:279-302` (name-keyed map); the check at `:157-165` |
| AU-2 | **The caller controls their own approval requirement.** `createDelegation` sets `isActive: !input.requiresApproval` from the **caller-supplied** `input.requiresApproval` (defaulting to `true`), and the rule's own computed `requiresApproval` is **never read**. Passing `requiresApproval: false` — or omitting it — creates an immediately-active, fully-effective delegation. Combined with AU-1 this is unauthenticated privilege escalation. | **Critical** | `auth/index.ts:175, :178`; the computed value at `:271` is discarded |
| AU-3 | **`maxDurationDays` is never enforced.** Every rule declares one (30/60/90/365 days); `createDelegation` accepts a fully client-controlled `expiresAt` and never caps it, so a delegation can be created with no expiry — a permanent permission grant. | **High** | `auth/index.ts:176, :250, :272, :284, :289, :294, :299` |
| AU-4 | **Cross-tenant IDOR on approve and revoke.** `approveDelegation` and `revokeDelegation` accept a `tenantId` and use it **only for the audit log**; the mutation is `prisma.delegation.update({ where: { id: delegationId } })` with no tenant predicate. Anyone who obtains or guesses a delegation id can approve or revoke a delegation belonging to a different tenant. | **High** | `auth/index.ts:199-206`, `:228-231` | ✅ Resolved (2026-09-29) |
| AU-5 | **Cross-tenant permission resolution.** `getEffectivePermissions` does `prisma.user.findUnique({ where: { id: userId } })` with no tenant filter, then `resolveRolePermissions` similarly. A user id from tenant A resolves permissions from whatever role that id holds, regardless of the `tenantId` argument. | **High** | `auth/index.ts:20-25`, `:71-73` | ✅ Resolved (2026-09-29) |
| AU-6 | **`logAudit` lies to the compiler about optional fields.** `input.schoolId as string` and `input.userId as string` convert `string \| undefined` to `string`. Both are optional in `AuditInput` (`:308, :310`) but are passed to Prisma's required-typed fields. Runtime behaviour is a Prisma validation error, not a clean optional write. `oldData`/`newData` are `as any`. | Medium | `auth/index.ts:323-324, :328-331` |
| AU-7 | **N+1 and unbounded recursion in role resolution.** `resolveRolePermissions` issues one `findUnique` per role per inheritance level, and `visited` is a `Set` **shared across sibling branches** (`:66`, passed into the loop at `:82`), so a diamond inheritance graph silently drops the second branch's permissions. It is not memoised, and `getUserSession` calls it on every invocation with no cache despite the docblock claiming *"Caches results in Redis for performance"* — **there is no Redis anywhere in this package**. | Medium | `auth/index.ts:12, :62-88` |
| AU-8 | **No `server-only` boundary marker, no rate limiting, no input validation.** Every exported function takes raw strings and arrays; none of the inputs are validated by any Zod schema from `@novastar/shared-types` even though `CreateDelegationInputSchema` exists and is unused here (the package declares `shared-types` as a peer and only imports types from it). | Medium | `auth/index.ts:121-130` vs `shared-types/index.ts:230-234` |
| AU-9 | `getDefaultDelegationRules` hardcodes four role names (`ACADEMIC_COORD`, `BURSAR`) that **do not exist** in `UserRoleEnum` (which has `ACCOUNTANT`, `ASSISTANT_HEAD`, `HEADMASTER` but no `ACADEMIC_COORD` or `BURSAR`). Even after AU-1's keying is fixed, two of the four rules are dead. | Medium | `auth/index.ts:291, :296` vs `shared-types/index.ts:272-285` |
| AU-10 | `revokeDelegation` performs the update and the audit log as two independent awaits with no transaction, then re-reads with `findUniqueOrThrow` — a partial failure leaves an unaudited state change. | Low | `auth/index.ts:228-241` |
| AU-11 | The whole file has a visibly mangled indentation block at `:52-57` (the delegation loop and `return permissions` are indented as if nested in a closure that does not exist), consistent with an automated `fix as any` pass. | Low | `auth/index.ts:52-57` |

### 5.2 NextAuth observations (in `apps/portal/lib/auth.ts`, flagged because the package should own them)

These are outside the strict package boundary but are the direct consequence of the package not owning auth, and they should move into `packages/auth` when it is fixed:

- **NextAuth v4.24.15 is pinned.** The task brief notes v5 is current. v4 is in maintenance; the migration is a breaking `NextAuthOptions` → `NextAuth` config change plus handler-signature changes.
- **`@auth/prisma-adapter@^2.11.3` is the v5-era adapter line paired with a v4 runtime.** It typechecks, but the pairing is a known upgrade hazard.
- **The `PrismaAdapter` is dead weight.** `session.strategy: 'jwt'` bypasses the adapter's session persistence entirely; only the account/user lookups are used. Either drop the adapter or switch to database sessions.
- **`maxAge: 30 * 24 * 60 * 60` with JWT sessions and no re-validation.** `isActive` is checked only at sign-in, so a deactivated user retains a valid 30-day token. This is exactly the check the auth package's `getEffectivePermissions` should be performing per-request and is not.
- **`resolveSchool` falls back to `DEFAULT_SCHOOL_CODE`** when no code is supplied, so any credential pair valid for the default school can sign in without naming it.
- **`export const TENANT_ID = process.env.TENANT_ID`** is a process-global tenant, read by `apps/portal/app/api/config/entities/[type]/route.ts:3, 25, 76, 128` in place of the session's tenant. The comment concedes it: *"in production, this would come from the session/JWT"*. It is a direct contradiction of the multi-tenant model in `shared-types`.
- **Three password-hashing libraries** are reachable from the portal (`@node-rs/argon2` via `lib/password`, plus `argon2` and `bcryptjs` in its manifest), and a fourth version of `bcryptjs` is declared in `packages/auth`. No migration path between them is defined.

---

## 6. `packages/notifications` — Resend Email

| # | Finding | Severity | Evidence |
|---|---|---|---|
| NO-1 | **HTML injection into outbound email.** `sendBulkNotifications` interpolates `input.body` directly into an HTML email: `` html: `<p>${input.body}</p><p><a href="…">View in Portal</a></p>` ``. `body` is free-form, caller-supplied content with no escaping. Anyone who can influence a notification body (an announcement title, a student's name, a fee note) can inject arbitrary markup or a phishing payload into a parent- or staff-facing email. | **High** | `notifications/index.ts:276` |
| NO-2 | **`savePushSubscription` corrupts the notification feed.** It stores a push subscription by creating a `Notification` row titled `"Push Subscription"` whose body is `JSON.stringify(input)`. Every subscription save produces a spurious in-app notification visible to the user. There is **no push-sending code at all** despite the file header advertising *"Email, Push, In-App"*. | **High** | `notifications/index.ts:93-106` |
| NO-3 | **`type` is unvalidated and duplicated.** `createNotification` casts the whole Prisma `data` object `as any` and the type `as any`, discarding the enum check. `NotificationType` is a bare union in `shared-types` whose members do not match the Prisma enum, so a typo compiles, passes, and fails at the database. | **High** | `:67-80`; `shared-types/index.ts:270` |
| NO-4 | **`sendEmail` swallows all failure.** Every error path `console.error`s and returns `null`, so callers cannot distinguish "no API key" from "delivery rejected" from "network down". No retry, no queue, no dead-letter, no idempotency key, and `result.data!` is a non-null assertion on a value the code has already checked for error. | Medium | `:34-55` |
| NO-5 | **Serial 1-by-1 fan-out with no rate limiting.** `sendBulkNotifications` loops `for (const user of users)` awaiting a DB insert and then a Resend API call per user. For a whole-school announcement that is hundreds of sequential network round-trips with no concurrency cap and no provider rate-limit handling. | Medium | `:259-280` |
| NO-6 | `findMany` includes `{ student: true, staff: true }` and **never uses either relation.** Two unnecessary joins per bulk send. | Low | `:256` |
| NO-7 | **`fillTemplate` builds a RegExp from an unescaped key.** `new RegExp(\`{${key}}\`, 'g')` throws on a key containing an unbalanced metacharacter (e.g. `a)`), and any `$&`/`$1` sequences inside `value` are interpreted as replacement patterns. There is also no check that every `mergeFields` entry was actually supplied. | Medium | `:285-291` |
| NO-8 | The portal URL is **hardcoded** as `https://portal.novastarmontessorischool.com` rather than read from config/env. | Low | `:276` |
| NO-9 | **`NOTIFICATION_TEMPLATES` is an unvalidated object literal with incomplete i18n.** `INFO`, `WARNING`, `ERROR`, and `SUCCESS` omit `bodyTw` (the type makes it optional, so nothing flags it), and every template is hardcoded English/Twi with no locale-parameterised formatting. Nothing validates that the record is exhaustive for `NotificationType` beyond TypeScript's structural check. | Medium | `:208-235` |
| NO-10 | The "Twi locale" available to this package's consumers is a fiction: `shared-utils` defines `tw` as `{ ...enUS, code: 'tw' }` — English formatting under a misleading code. Every `locale: 'tw'` render produces English text. For a Ghanaian school product with Twi as a first-class language this is a correctness lie. | Medium | `shared-utils/index.ts:12-15` |

---

## 7. `packages/payments` — MoMo, Bank, Cash

| # | Finding | Severity | Evidence |
|---|---|---|---|
| PA-1 | **`verifyPayment` always succeeds.** `MTNMoMoProvider.verifyPayment` is a placeholder that unconditionally returns `{ success: true, status: 'PENDING', amount: 0 }` with the comment *"Placeholder — would call actual MTN API"*. `BankTransferProvider.verifyPayment` does the same. `PaymentService.verifyPayment` treats a `COMPLETED` result as ground truth and **sends a payment-confirmation email** on that basis. Any webhook or reconciliation path built on this method would confirm payments that were never made. | **High** | `payments/index.ts:117-135`, `:177-184`, `:291-326` |
| PA-2 | **`processPayment` is unconditional success too**, and writes a database row. `MTNMoMoProvider.processPayment` makes no network call and returns `success: true, status: 'PENDING'` unconditionally. Every "payment" in the system is recorded whether or not money moved. | **High** | `:91-115` |
| PA-3 | **The payment write is entirely untyped.** `prisma.payment.create({ data: { … } as any })` — the whole `data` object is `as any`, so field names, required fields, and relations are not checked at all. Combined with `method: { connect: { code: providerType } } as any` and `invoiceId: … as unknown as string`, the insert can fail at runtime for any schema change. | **High** | `:264-280` |
| PA-4 | **`paidAt` is set on a PENDING payment.** `PaymentService.processPayment` hardcodes `status: 'PENDING'` while also writing `paidAt: new Date()`. `CashProvider.processPayment` returns `status: 'COMPLETED'` but the DB row still says PENDING with a paid timestamp. Reports keyed on `paidAt` will include unpaid payments. | **High** | `:275-276` vs `:209` |
| PA-5 | **`mtn-bulk` is a duplicate provider instance aliased under a second key.** `PAYMENT_PROVIDERS['mtn-bulk'] = new MTNMoMoProvider()` is a *second instance* whose `.id` is `'mtn-momo'`. `getProvider('mtn-bulk').id !== 'mtn-bulk'`, and the DB write uses the *requested* `providerType` while the provider behaved as the other. Two distinct stateful objects where one is expected. | Medium | `:236-241` |
| PA-6 | **No idempotency key.** References are `MM-${Date.now()}-${studentId}` — two payments by the same student in the same millisecond collide, and the format is trivially guessable. There is no uniqueness constraint enforced in code and no dedupe on retry. | Medium | `:93, :167, :204` |
| PA-7 | **No webhook signature verification anywhere**, and the `callbackUrl` is accepted from the caller with no allow-list. The `const _callbackUrl` at `:98` is computed and discarded. | Medium | `:98` |
| PA-8 | **No amount validation.** `PaymentInput.amount: number` accepts `0`, negatives, `NaN`, and arbitrarily large values. There is no `> 0`, no upper bound, and no currency guard beyond a hardcoded `'GHS'` literal type. `getFees` on a negative amount produces a negative `netAmount`. | Medium | `:23-38, :80-89` |
| PA-9 | **`PaymentInput.metadata` is typed `[key: string]: string \| undefined` but the code reads undeclared keys.** `input.metadata.tenantId`, `.schoolId`, `.recordedById` are not in the interface and are consumed via `as string`. The type signature lies about the required shape. | Medium | `:31-36, :266-277` |
| PA-10 | **The QR payload leaks an internal URL.** `generateQR` embeds `callbackUrl` in the QR data, which is scanned by parents and visible to anyone who photographs it. | Medium | `:137-147` |
| PA-11 | **`reconcilePayments` is an N+1 with unguarded status mutation.** One `findFirst` per transaction, and it overwrites local `payment.status` from the provider feed with **no audit trail** — unlike every other mutation in the repo. | Medium | `:353-390` |
| PA-12 | `PaymentService.verifyPayment` composes an HTML confirmation email with a template literal and never escapes `provider.name` or interpolates `result.amount` into markup. Low risk today (both are internal/numeric) but it is the second unescaped-HTML site in the tree. | Low | `:316-320` |
| PA-13 | `getFees` uses a hardcoded 1.5% + ₵0.50 MTN tariff with no effective date and no configuration source. | Low | `:80-89` |

**What payments gets right:** the `PaymentProvider` interface is a genuinely good seam — `processPayment`/`verifyPayment`/`generateQR?`/`getFees` is exactly the right shape, and `generateQR` is correctly optional with `generatePaymentQR` returning `null` when absent. The provider registry with a typed `Record<PaymentProviderType, PaymentProvider>` is the correct pattern and is the closest thing in the repo to the plugin architecture the brief asks about.

---

## 8. `packages/sync-engine` — IndexedDB Offline Sync

**This package is a stub.** The header comment claims *"Uses a conflict-resolution strategy with optimistic writes and background sync."* None of that exists.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| SY-1 | **Every operational method is a no-op.** `initialize()` is an empty body. `sync()` returns `{ synced: 0, conflicts: 0 }`. `getPendingChanges()` returns `[]`. `resolveConflicts()` is an empty body. `clear()` is an empty body. `write()` constructs a `SyncRecord` and returns it **without persisting anything**. The class is a type declaration with no behaviour. | **Critical** | `sync-engine/index.ts:32-72` |
| SY-2 | **IndexedDB is never touched.** The field is `private db: unknown // IDBDatabase` and is never assigned. `idb@^8.0.2` is a declared dependency and is **never imported** (verified by grep). The package's entire reason for existing is absent. | **Critical** | `:26`, `package.json:22` |
| SY-3 | **`SyncStrategy` is declared, stored, and never read.** `config.strategy` is stored in the constructor and no method consults it. `'merge'` and `'ask-user'` have no defined semantics anywhere — no merge function, no conflict type, no UI contract. | **High** | `:8, :23, :28, :66-70` |
| SY-4 | **`SyncOptions` is a completely dead API.** `onProgress` and `onConflict` are declared, `SyncOptions` is never a parameter of any method, and neither callback is ever invoked. `onConflict` in particular is the entire conflict-resolution story, and it is unreachable. | **High** | `:17-21` |
| SY-5 | **The package is not typechecked by the monorepo.** It has no `typecheck` script (its `build` is `tsc --noEmit`), so `turbo run typecheck` **skips it entirely** — confirmed by the run: 13 packages in scope, 11 tasks executed, `sync-engine` absent. The one package with no implementation and no type safety net is the only one excluded from CI's type gate. | **High** | `package.json:5-11`; turbo output |
| SY-6 | **`test: "bun test"` with zero test files passes green.** A false-green signal in CI. | Medium | `package.json:9` |
| SY-7 | **`write()` silently defaults `tenantId` to the string `'default'`.** In a multi-tenant system an omitted tenant becomes a shared bucket rather than an error. | **High** | `:44` |
| SY-8 | **`write()` type-casts unvalidated input**: `entityId: record.id as string` and `recordId: record.id as string` with no check that `id` exists — a record without one yields `undefined` typed as `string`, and `data: record` stores whatever was passed. | Medium | `:43-47` |
| SY-9 | **No serialisation contract for `Date`.** `SyncRecord.timestamp: Date` and `SyncRecord.data: Record<string, unknown>` are stored to IndexedDB and pushed to a server; there is no ISO-string boundary, no schema, and no version field. Nothing can be validated on either side. | Medium | `shared-types/index.ts:251-263`; `sync-engine/index.ts:48` |
| SY-10 | **Config defaults are all-or-nothing.** The constructor's default parameter is replaced wholesale by any caller argument, so a caller passing `{ strategy: 'merge' }` gets `batchSize: undefined`, `retryAttempts: undefined`, and infinite/NaN arithmetic downstream. Should be `Partial<SyncConfig>` merged over defaults. | Medium | `:28-30` |
| SY-11 | `dev: "tsx watch index.ts"` and `start: "tsx index.ts"` execute a library file as a script. There is no entry point, no `main` export beyond the class, and nothing to run. | Low | `package.json:6,12` |
| SY-12 | The package declares `@novastar/database` as a dependency but imports **only** `@novastar/shared-types`. The sync half of an offline sync engine has no server counterpart wired. | Medium | `package.json:20`, `index.ts:7` |

---

## 9. `packages/reports`, `packages/database`, and the Plugin System

### 9.1 `reports` — empty

`packages/reports/index.ts` is, in its entirety:

```ts
// @novastar/reports
export const reports = {}
```

It declares `@react-pdf/renderer@^4.0.0`, `csv-string@^4.1.1`, `zod@^4.4.3`, and `@novastar/database` — **all four entirely unused**. There is no PDF generation, no CSV generation, no schema, no report model, and no import of React. The brief's premise ("PDF report generation with `@react-pdf`") is not met. **Severity: Critical** (a package that exists, is installed, and does nothing is worse than an absent one, because it looks done). It typechecks and lints clean, which is precisely the failure mode.

Note the one thing it gets right: it is the only package in the tree that correctly marks `react`/`react-dom` as **optional** peer dependencies via `peerDependenciesMeta`, which is exactly right for a package that may run in Node.

### 9.2 `database` — the silent-mock hazard (in scope as a dependency contract)

`packages/database` is outside the brief's package list, but three packages (`auth`, `notifications`, `payments`) import `prisma` from it, so its contract is load-bearing:

- **`createMockPrisma()` returns a `Proxy` that answers *every* model method with `[]`, `0`, or `{}`.** If `DATABASE_URL` is unset, every query **succeeds with empty data** rather than failing. The comment scopes this to `next build` (*"At runtime, DATABASE_URL is always set"*), but nothing enforces that. A missing env var in production yields blank lists, zero counts, and a green health check — a silent data-loss class of failure, not a crash. **Severity: High.**
- **The outer `Proxy` cannot support client-level methods.** `client[prop]` on the mock returns `modelProxy` (an object, not a function), so `typeof value === 'function'` is false and `prisma.$transaction`, `prisma.$queryRaw`, and `prisma.$connect` resolve to the model proxy object and are not callable. Undocumented limitation.
- **`log: ['error', 'warn']`** with no `query` logging and no slow-query threshold. **Low.**
- **~50 model types and 16 enum objects are re-exported by hand** (`:51-121`). Adding a model to the Prisma schema requires editing this file, and every one of the 16 re-exported enum *objects* — `Phase`, `Gender`, `SubjectCategory`, `NotificationType`, `TermStatus` — **shadows a same-named Zod enum in `shared-types`**. This is the structural root cause of ST-5 and the whole class of "two sources of truth for an enum" findings. **Severity: High** as a systemic issue.

### 9.3 Plugin system — does not exist

| Path | State |
|---|---|
| `packages/plugin-registry/` | **Empty directory.** No `package.json`, no `index.ts`, nothing. |
| `packages/plugins/alumni/` | **Empty directory** |
| `packages/plugins/analytics/` | **Empty directory** |
| `packages/plugins/canteen/` | **Empty directory** |
| `packages/plugins/clinic/` | **Empty directory** |
| `packages/plugins/learning/` | **Empty directory** |
| `packages/plugins/library/` | **Empty directory** |
| `packages/testing/` | **Empty directory** |

`tsconfig.base.json:29` still declares a path mapping for `@novastar/plugin-registry/*` pointing at a directory that has no files.

There is therefore **no registry pattern, no plugin API, no type-safe plugin contract, and no isolation or sandboxing to evaluate.** None of the six analysis criteria for the plugin system can be assessed. **Severity: Critical** — but the correct response is a scoping decision (§12), not an implementation plan, because the brief describes a system that was never started.

The closest existing thing to the intended pattern is `PAYMENT_PROVIDERS: Record<PaymentProviderType, PaymentProvider>` in `payments/index.ts:236` — a typed provider registry with a `getProvider` accessor. If a plugin system is wanted, that is the in-repo precedent to generalise, and it should be extracted into `packages/plugin-registry` rather than invented fresh.

---

## 10. Impact on consumers (evidence from the apps)

The package contracts are not just internally inconsistent — the apps route around them, which is the clearest signal that the packages are not doing their job.

- **Three parallel entity catalogs.** `DEFAULT_ENTITY_REGISTRY` (`shared-types/config-schema.ts:268`) defines 22 entities. `apps/portal/app/api/config/[entityType]/route.ts:20-258` defines a **second, independent** `entityModelMap` with 22 entries, its own `createSchema` for each (10+ hand-written inline `z.object`s instead of the shared schemas), its own `paginationSchema` (`:260-266`) duplicating `PaginationSchema`, and its own `allowedSortFields`. `apps/portal/components/config/entity-form.tsx:35` reads the *shared* registry. Three catalogs, three sources of truth, and the route's map is the one that includes the 5 types the enum forbids.
- **`GET /api/config/entities/[type]` is unauthenticated on PATCH.** The `GET` and `DELETE` handlers call `getServerSession`; the **`PATCH` handler (`[type]/route.ts:50-112`) never does**. Any unauthenticated request can rewrite a tenant's entity definition. The body is stored as `JSON.stringify(body)` and later `JSON.parse`d and cast `as EntityDefinition` (`:38`) with no validation — a stored-definition injection path. This is app scope, but it is the direct consequence of `shared-types` exporting an unvalidated, `as`-cast registry with no `EntityRegistrySchema.parse` at the boundary.
- **`TENANT_ID` (a process-global env constant) is used in place of the session tenant** in `[type]/route.ts:25, 76, 128`, contradicting the tenancy model in `shared-types`.
- **`shared-ui`'s type-safety gaps are visible in the portal**: `components/config/entity-form.tsx` and `student-form.tsx` consume `FormField`/`FormControl`/`FormMessage`, which — per UI-18 through UI-20 — do not associate labels, do not forward ARIA, and do not render errors. Every form in the portal is unlabelled and its error text is hand-threaded.
- **`@novastar/auth`, `@novastar/ghana-education`, `@novastar/notifications`, `@novastar/payments`, and `@novastar/sync-engine` are declared in the portal's `package.json` and imported nowhere in it.**

---

## 11. Best-practices compliance scorecard

| Practice | shared-ui | shared-types | shared-utils | auth | notifications | payments | ghana-edu | reports | sync-engine |
|---|---|---|---|---|---|---|---|---|---|
| `strict: true` | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| No `any` (or suppressed with reason) | Yes (2 suppressed) | Yes | Yes (1) | No (2) | No (7) | No (2) | Yes | Yes | Yes |
| Named exports only | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Barrel file | Yes (1) | Yes (1) | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Internal deps declared | No (self-import) | No (zod in devDeps) | No (zod peer, unused) | No (peers not deps) | No | No | **No (missing)** | n/a | No (unused db) |
| No unused dependencies | **No (5 unused)** | No (`dotenv` n/a) | No (`zod`) | No (`next-auth`, `bcryptjs`) | Yes | Yes | No (`zod`) | **No (4 unused)** | **No (`idb`)** |
| Barrel is the only entry | No (no `exports` map) | No | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Tree-shaking friendly | No (circular import) | Partly (module-load parses) | Yes | n/a | n/a | n/a | n/a | n/a | n/a |
| Zod at every boundary | n/a | Partly (no cross-field) | No (regex duplicates) | **No** | **No** | **No** | No | n/a | No |
| Branded domain primitives | **No** | **No** | **No** | **No** | **No** | **No** | **No** | **No** | **No** |
| Tests | **None** | **None** | **None** | **None** | **None** | **None** | **None** | **None** | None (script only) |
| Storybook | Scripts, no config | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| `server-only` on server packages | No | No | No | **No** | **No** | No | No | n/a | n/a |
| Structured logging | `console.error` | n/a | n/a | n/a | `console.error` | n/a | n/a | n/a | n/a |
| Error types, not strings | n/a | n/a | n/a | **No** (`throw new Error`) | n/a | No | n/a | n/a | n/a |
| Transactional multi-write | n/a | n/a | n/a | **No** | No | **No** | n/a | n/a | n/a |
| Accessible by default | **Partial (6 findings)** | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

**Honest totals:** 0 of 10 packages have tests. 0 of 10 use branded types. 0 of 10 use Zod to validate function inputs. 0 of 10 mark server-only packages with `server-only`. Every package typechecks; none of them is tested.

---

## 12. Findings register

### Critical (5)

| ID | Finding | Package | Fix |
|---|---|---|---|
| **AU-1** | Delegation rules are keyed by role name but looked up by role id → every role falls through to `['*']` → any user can delegate any permission | `auth` | Key the map by a stable role **slug** column (not the cuid) and add a Zod-validated `DelegationRule[]` table; make an unmatched role **deny**, not allow-all |
| **AU-2** | Caller supplies `requiresApproval`; the rule's value is computed then discarded → self-approved delegation | `auth` | Derive `requiresApproval` from the matched rule. Remove it from the public input type. Reject when the rule says approval is required and no approver is set |
| **SY-1** | `SyncEngine` has no implementation — all five operational methods are empty | `sync-engine` | Implement against `idb`, or delete the package and the portal's dependency on it |
| **SY-2** | IndexedDB is never used; `idb` is a declared, never-imported dependency | `sync-engine` | Same as SY-1 |
| **RP-1** | `reports` is a 2-line stub with four unused dependencies | `reports` | Implement, or delete the package and its `workspace:*` edges |
| **PL-1** | `plugin-registry/` and all six `plugins/*` directories are empty; no plugin system exists | `plugins` | **Scoping decision** — see §13 |

### High (21)

`UI-1` build emits nothing but `main` points at `dist/index.js` · `UI-2` tokens live in `src/src/index.css` and are never compiled · `UI-3` compiled CSS contains **zero** `bg-background` (measured) · `UI-10` `use-confirm.tsx` circularly imports its own barrel · `UI-11` two toast systems; `@radix-ui/react-toast` never imported · `UI-17` `focus-within` on form controls → no focus ring · `UI-18` `FormControl` is a `div`, not `Slot` → ARIA dropped · `UI-19` `FormLabel` has no `htmlFor` · `UI-20` `FormMessage` never reads the error · `UI-21` `Progress` drops `value` → `aria-valuenow` missing · `UI-22` toasts unannounced; close button unnamed · `UI-23` `DataTabled` renders no `<thead>` · `UI-29` Switch visually inert · `UI-30` Checkbox never fills · `UI-31` Calendar uses react-day-picker **v8** API against **v10** · `UI-33` `FormField` erases RHF generics · `UI-35` ThemeProvider doesn't persist · `UI-36` two competing theme systems (`next-themes` vs `ThemeProvider`) · `ST-1` registry uses 5 entity types the enum forbids · `ST-3` no cross-field validation (date ranges, score ranges, age ranges) · `ST-4` permission key regex rejects the wildcards the delegation system needs · `ST-5` `NotificationType` is a bare union duplicating the Prisma enum · `ST-6` no branded types anywhere · `AU-3` `maxDurationDays` never enforced · `AU-4` cross-tenant IDOR on approve/revoke · `AU-5` cross-tenant permission resolution · `NO-1` HTML injection in bulk email · `NO-2` push subscriptions stored as user-visible notifications · `NO-3` `type` unvalidated, enum duplicated · `PA-1` `verifyPayment` always succeeds and triggers confirmation email · `PA-2` `processPayment` unconditionally succeeds · `PA-3` payment write is `as any` · `PA-4` `paidAt` set on a PENDING payment · `SY-3` `SyncStrategy` never read · `SY-4` `SyncOptions` is a dead API · `SY-5` sync-engine excluded from `turbo typecheck` · `SY-7` `tenantId` silently defaults to `'default'` · `DB-1` missing `DATABASE_URL` yields empty results, not an error · `DB-2` hand-re-exported Prisma enums shadow the Zod enums

### Medium (24)

`UI-12` `constants.ts` is a copy of `utils.ts` · `UI-13` `DialogPortal`/`DialogOverlay`/`Calendar` not exported · `UI-14` `DataTabled` typo in the public API · `UI-24` toast primitives lack live-region roles · `UI-25` `radio-group` uses `focus:` not `focus-visible:` · `UI-26` Accordion hardcodes `<h3>` · `UI-32` `Button` doesn't `cn()`-merge · `UI-34` `FormField` ref type is a lie · `UI-37` `animate-shimmer` undefined · `UI-38` toast variants are light-mode-only · `UI-39` toast animations need an uninstalled plugin · `UI-40` toast timers never cleared · `UI-41` `BreadcrumbLink` `asChild` is a no-op · `UI-42` `CardTitle` ref typed `HTMLParagraphElement` for an `<h3>` · `UI-43` `DataTabled` reimplements the table; no sorting/paging · `UI-44` `createContext(undefined as never)` in `use-confirm` · `UI-47` `SelectContent` has no Portal/groups/separator · `ST-2` 9 enum members have no field definition · `ST-7` base-schema adoption inconsistent · `ST-9` no `PaginatedResponse<T>` type; redundant meta · `ST-10` ~140 Zod parses at module load · `ST-11` field `order` never assigned (all `0`) · `D1` `ghana-education` missing `shared-types` · `D2` `shared-types` uses zod from devDependencies · `D5` internal packages declared as peers · `D7` redundant `@prisma/client` in `auth` · `D8` dead `pg`/`dotenv`/`@prisma/adapter-pg` deps · `D10` 5 unused shared-ui deps · `D11` no `exports` maps; bare specifiers unmapped · `D12` shared-ui tsconfig path mapping breaks on subpaths · `AU-6` `logAudit` casts optional to required · `AU-7` N+1 role resolution; shared `visited` drops diamond branches; docblock claims nonexistent Redis cache · `AU-8` no validation, no `server-only`, no rate limiting · `AU-9` two delegation-rule role names don't exist in `UserRoleEnum` · `NO-4` `sendEmail` swallows all errors · `NO-5` serial 1-by-1 bulk fan-out · `NO-7` `fillTemplate` builds a RegExp from an unescaped key · `NO-9` templates unvalidated; i18n incomplete · `NO-10` the "Twi" locale is `enUS` renamed · `PA-5` `mtn-bulk` is a duplicate provider instance · `PA-6` no idempotency key · `PA-7` no webhook signature verification · `PA-8` no amount validation · `PA-9` `metadata` type lies about its shape · `PA-10` QR payload leaks `callbackUrl` · `PA-11` reconciliation is N+1 with unaudited writes · `SY-6` `bun test` with zero tests passes green · `SY-8` `write()` casts unvalidated input · `SY-9` no `Date` serialisation contract · `SY-10` config defaults are all-or-nothing · `SY-12` `database` declared but unused

### Low (17)

`UI-15` mojibake in committed source · `UI-16` server components that spread event props · `UI-27` `aria-label="breadcrumb"` lowercase · `UI-28` `ToastVariant` includes `null`/`undefined` · `UI-45` breadcrumb parts lack `forwardRef` · `UI-46` empty interfaces + unimported `React` namespace · `UI-48` cva used in 4 of 31 components · `ST-8` Zod v3 string methods on v4 · `ST-12` `dependsOn` is string-equality only · `ST-13` `ConfigurableEntitySchema` is a dead export · `ST-14` 32-line forward type query; ragged indentation · `D3` `ghana-education` unused `zod` devDep · `D4` `shared-utils` unused, unoptional `zod` peer · `D6` `reports` declares `database` as a dependency while siblings use peers · `AU-10` revoke is not transactional · `AU-11` mangled indentation in `auth/index.ts:52-57` · `NO-6` unused `student`/`staff` includes · `NO-8` hardcoded portal URL · `PA-12` unescaped HTML in the confirmation email · `PA-13` hardcoded MTN tariff with no effective date · `SY-11` `dev`/`start` scripts run a library file · `DB-3` no query logging · `GE-1`…`GE-6` (see §13) — `ghana-education` findings

### `packages/ghana-education` (full detail)

| # | Finding | Severity | Evidence |
|---|---|---|---|
| GE-1 | **Grading-scale ids referenced by the curriculum do not exist.** `GES_CURRICULUM.SHS.gradingScale = 'naCCA_5_1'`, `JHS/PRIMARY = 'naCCA_6_1'`, `KINDERGARTEN = 'naCCA_EYLF'`. The exported constants have ids `nacca_6_level`, `nacca_5_level`, `eylf_grading`. Every lookup by id fails silently. | **High** | `:42, :62, :83, :103` vs `:127, :141, :170` |
| GE-2 | **`NACCA_5_LEVEL` is named "5-Level" and defines 9 levels** (A1–F9). The naming, the `id` (`nacca_5_level`), and the curriculum's `naCCA_5_1` reference all disagree with the contents. | **High** | `:139-154` |
| GE-3 | **`PromotionRule` fields are unitless.** `minAverage`, `minAttendance`, `minSBA` are all `number` with no unit in the type or the field name. `minAttendance: 80` means 80%, but a caller may reasonably pass `0.8`. For a promotion gate this is a silent-correctness hazard. | **High** | `:183-210` |
| GE-4 | **Duplicate subject codes within a phase are unenforced.** SHS defines both `MAT` (core, "Mathematics") and `MATH` (elective, "Elective Mathematics"); JHS defines `MAT` core with no elective maths at all. Nothing validates code uniqueness per phase. | Medium | `:96-99` vs `:70` |
| GE-5 | **`calculateTeachingDays` compares midnight-normalised `day` against arbitrary-time `holiday.start`/`end`**, so a holiday starting at noon excludes that day inconsistently. It is also O(days × holidays) re-filtering the whole array per holiday, and the `holidays` field returned by `calculateGhanaTermDates` is **never wired into it** — no Ghana public-holiday list exists anywhere in the package. | Medium | `:228-249, :289-306` |
| GE-6 | **`BECE_SUBJECT_MAPPING` names `ICT` "Information Communication Technology"** while `GES_CURRICULUM` names it "Information & Communication Technology". Two display strings for one subject, so reports and exports disagree. | Low | `:318` vs `:57, :76` |
| GE-7 | The whole curriculum is a **global constant with no tenant or admin override**, directly contradicting the "zero-hardcoding, admin-editable" premise stated at the top of `shared-types/config-schema.ts`. | Medium | `:29-106` |
| GE-8 | **`DEFAULT_REPORT_TEMPLATES[2]` (SHS) has mangled indentation** at `:385-393` — a generation artefact, cosmetic but a signal that the file was produced by a script and not reviewed. | Low | `:385-393` |
| GE-9 | `PhaseCurriculum` has both `phase: Phase` and `phases: string[]`; the plural field holds level codes (`['B1'…'B6']`) and should be named `levelCodes`. | Low | `:19-26` |
| GE-10 | No Zod validation on any exported config, despite `zod` being a declared devDependency. | Medium | `package.json:11` |

---

## 13. Recommended remediation, in order

### Wave 0 — Decide (blocking; 30 minutes, no code)

Eight of twelve packages are consumed by nothing. This audit cannot tell you whether to fix or delete them, because that depends on intent:

- **`reports`** — is PDF report generation on the roadmap, or was the idea dropped?
- **`plugin-registry/` + `plugins/*`** — is the plugin system planned, or are the empty directories a scaffold that was abandoned? (`tsconfig.base.json:29` still maps a path into it, so something was started.)
- **`auth`** — should this package own the NextAuth config that currently lives in `apps/portal/lib/auth.ts`? Right now the app owns auth and the package owns RBAC, which is an odd and undocumented split.
- **`sync-engine`** — is offline support a committed requirement? The package is 100% stub.

Everything below assumes "fix, don't delete". If the answer for any of these is "delete", Waves 1–2 shrink substantially and Wave 3 is the whole job.

### Wave 1 — Security and correctness (1–2 days)

1. **`auth/index.ts:256-274`** — key `getDefaultDelegationRules` by a stable role slug, and **deny on no-match** instead of `|| ['*']`. Add a test that a `CLASSROOM_TEACHER` cannot delegate `finance:approve`.
2. **`auth/index.ts:175-178`** — remove `requiresApproval` from `CreateDelegationInput`; derive it from the matched rule. Enforce `maxDurationDays` by computing `expiresAt` server-side.
3. **`auth/index.ts:199, :228`** — ✅ Done (2026-09-29): added `tenantId` to the `update` predicates (`where: { id: delegationId, tenantId }`). Also added `tenantId` to `getEffectivePermissions`'s `user.findUnique` (`:20`), `resolveRolePermissions`'s `role.findUnique` (`:71`), `createDelegation`'s `user.findUnique` (`:146`), and `revokeDelegation`'s `findUniqueOrThrow` (`:241`).
4. **`notifications/index.ts:276`** — escape `input.body` before interpolating it into HTML, or switch to `text`-only email plus a templated HTML wrapper with a fixed body.
5. **`payments/index.ts:117, :177`** — `verifyPayment` must not return `success: true` on a code path that performs no verification. Make it throw `NotImplementedError` until the MTN API is wired, so the failure is loud.
6. **`payments/index.ts:275-276`** — do not write `paidAt` on a `PENDING` payment.
7. **`database/index.ts:8-33`** — make the missing-`DATABASE_URL` mock opt-in via an explicit `ALLOW_MOCK_DB` flag, and have it **throw** for any call outside `next build`. A proxy that answers `[]` to everything is a silent-corruption primitive.
8. **`shared-types/config-schema.ts:634`** — delete the `as EntityDefinition[]` cast and add the 5 missing enum members (`class`, `fee_line_item`, `staff`, `student`, `parent`). Then add a **compile-time exhaustiveness test** asserting `Set<EntityType> === Set<registry type>` so the two lists can never diverge again.

### Wave 2 — Shared-UI correctness (2–3 days)

9. **Fix the build.** Set `"noEmit": false, "declaration": true, "outDir": "dist"` in a build tsconfig (or use `tsc -p tsconfig.build.json`), or — simpler and better for an internal monorepo — **drop `main`/`module` entirely** and let `types: index.ts` plus the workspace symlink serve everything, which is what every other package here already does. Delete the `dist/` fiction.
10. **Consolidate the theme layer to one source of truth.** Move `src/src/index.css` to `src/theme.css`, decide whether the package or the app owns the tokens, and delete the other two copies. If the app owns them (as today), say so in the package README and drop the `@tailwind` directives and `build:css` pipeline from shared-ui entirely.
11. **`form.tsx`** — restore the shadcn composition contract: add a `FormFieldContext`, render `FormControl` as `Slot`, give `FormLabel` a `formItemId` + `htmlFor`, and have `FormMessage` read `fieldState.error`. Remove the `Record<string, unknown>` types and the `_ref` lie.
12. **`input.tsx` / `textarea.tsx` / `select.tsx`** — `focus-within:` → `focus-visible:`. Three-character fix, six WCAG findings closed.
13. **`calendar.tsx`** — rewrite the `classNames` and `components` objects against the react-day-picker v10 `UI`/`SelectionState`/`DayFlag` keys and **delete both `as any` casts** so the compiler enforces it.
14. **Delete `toast.tsx`** and either adopt `@radix-ui/react-toast` properly or drop the dependency. Keep one toast system. Add `aria-live="polite"` to the container and an `aria-label` to the dismiss button.
15. **`switch.tsx`** — add `data-[state=checked]:translate-x-4` to the Thumb and `data-[state=checked]:bg-primary` to the Root.
16. **`progress.tsx`** — forward `value` to `ProgressPrimitive.Root` and let Radix own the width; drop the inline `transform`.
17. **`use-confirm.tsx`** — change the imports to `'./dialog'` and `'./button'`. Delete the circular edge.
18. **`lib/constants.ts`** — delete the duplicated `cn` and the `export * from './constants'` in `utils.ts`.
19. **`theme-provider.tsx`** — either implement `localStorage` + `matchMedia` + an inline pre-hydration script, or delete it and re-export `next-themes` so there is one theme system.
20. **`data-table.tsx`** — rename to `DataTable`, render `<thead>` from `getHeaderGroups()`, compose the library's own `Table*` primitives, and either wire sorting or stop exporting `SortingState`.

### Wave 3 — Contract and hygiene (2–3 days)

21. **Branded IDs in `shared-types`**: `TenantId`, `SchoolId`, `UserId`, `StudentId`, `InvoiceId`, `PermissionKey`, `Cuid`. One `.brand<'TenantId'>()` per primitive. This is the single highest-leverage type change in the repo — it makes every cross-tenant bug in §5 a compile error.
22. **Cross-field refinements**: `.refine(s => s.endDate > s.startDate)` on the term/year schemas, `minScore <= maxScore` on grading levels, `ageMin <= ageMax` on class levels, percentages summing to 1 on assessment weights.
23. **A permission catalog**: move `getDefaultDelegationRules` into `shared-types`, model permissions as data (a `PermissionKey` union + a wildcard-matching function) rather than regex-validated strings, and delete `PermissionSchema.key`'s regex so wildcards are expressible.
24. **Zod-validate every exported function input** in `auth`, `notifications`, `payments`, `ghana-education`, `shared-utils`. This is the single change that most reduces the `as any` count (currently 16 suppressed instances across 5 files).
25. **Fix dependency declarations**: add `shared-types` to `ghana-education`; move `zod` in `shared-types` to `dependencies`; convert internal `peerDependencies` to `dependencies`; delete the 5 unused `shared-ui` deps, the 4 unused `reports` deps, `idb` from `sync-engine`, and `pg`/`dotenv`/`@prisma/adapter-pg` from `database`. Add a `depcheck`-equivalent CI step so this does not regress.
26. **Add `"sideEffects": false` and an `exports` map** to `shared-ui` (and every package) so deep imports are impossible and the barrel is the only entry.
27. **Add `typecheck` to `sync-engine`** so `turbo run typecheck` covers it.

### Wave 4 — Tests and CI gates (ongoing)

28. **The single highest-value change: tests.** Zero of ten packages have any. In priority order:
    - `shared-utils` — pure functions, trivial to test, and `determineGrade` / `calculatePercentage` / `formatPhone` are exactly where a silent regression is most expensive (report cards, fees, parent contact).
    - `shared-types` — schema parse tests, plus a `DEFAULT_ENTITY_REGISTRY` completeness test against `EntityTypeSchema` (fails today on ST-1/ST-2).
    - `auth` — a permission-matrix test that would have caught AU-1 on day one: "role X cannot delegate permission Y" for every role × permission pair.
    - `payments` — provider contract tests: `verifyPayment` must not return `success: true` without a verified source.
    - `shared-ui` — `@testing-library/react` + `jest-axe` for the 8 accessibility findings. The root already provides both `@axe-core/playwright` and `@testing-library/*`.
29. **Add Storybook properly** (or delete the two dead scripts). With a barrel of 31 components and no visual catalogue, regressions like UI-29 and UI-30 are invisible until someone opens the app.
30. **Add a build-integrity CI step**: `node -e "require('fs').accessSync('packages/shared-ui/dist/index.js')"` would have caught UI-1 on the first run. More generally, a script that asserts every declared dependency is imported somewhere in its own package.

---

## 14. Verification performed

| Check | Command | Result |
|---|---|---|
| Monorepo typecheck | `bun run typecheck` | 11/11 pass. **`sync-engine` skipped** (no `typecheck` script) |
| Monorepo lint | `bun run lint` | 12/12 pass, 2 warnings (both in `portal`) |
| ESLint actually lints packages | temp file with `any` in `shared-ui` → `eslint .` | Detected (`no-explicit-any` warning). Package lint is **not** a no-op |
| Compiled CSS contains theme utilities | `Select-String "bg-background" packages/shared-ui/dist/index.css` | **0 matches** (UI-3) |
| `main`/`module` targets exist | `ls packages/shared-ui/dist` | Only `index.css` (UI-1) |
| Storybook present | directory scan for `.storybook/`, glob for `*.stories.tsx` | **None** (UI-8) |
| Tests present | glob for `*.test.ts(x)` under `packages/` | **None** |
| `animate-shimmer` defined | grep across both `globals.css`, both `tailwind.config.ts`, both shared-ui CSS | **0 matches** (UI-37) |
| react-day-picker version | read `packages/shared-ui/node_modules/react-day-picker/package.json` | **10.0.1** — file uses v8 API (UI-31) |
| next-auth installed | `node_modules/next-auth`, `packages/*/node_modules/next-auth` | **Absent everywhere except `apps/portal`** (4.24.15) |
| Unused shared-ui deps | grep per dependency across package source | `zod`, `@radix-ui/react-context`, `@radix-ui/react-slider`, `@radix-ui/react-toast`, `@tanstack/react-virtual` → **0 imports each** |
| `idb` used | grep `idb\|indexedDB\|openDB` in `sync-engine` | Only comments; never imported (SY-2) |
| Package consumers | grep `from '@novastar/<pkg>'` across `apps/**` | 44 hits → only `shared-ui`, `shared-types`, `shared-utils` |
| EntityType ↔ registry consistency | scripted diff of enum members vs registry `type:` values | 5 in registry not in enum; 9 in enum not in registry (ST-1/ST-2) |
| Grading-scale id consistency | grep `gradingScale:` vs exported `id:` | 3 of 3 references unmatched (GE-1) |
| Plugin packages | recursive directory listing | `plugin-registry`, all 6 `plugins/*`, and `testing` are **empty** (PL-1) |
| Mojibake | read file headers | UTF-8 em-dash corrupted in 3 committed files (UI-15) |

**Not verified (out of reach without a live environment):** actual runtime behaviour of the Radix components, real MTN/Resend/Neon API integration, Prisma schema conformance of the `as any` writes, and whether the portal's forms render labels correctly in the browser. Every finding above is derived from source, configuration, or measured build output — none is speculative about a dependency's runtime behaviour unless the dependency's own type definitions were inspected directly (as with react-day-picker v10).
