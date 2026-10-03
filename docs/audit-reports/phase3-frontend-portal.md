# Phase 3 Frontend Portal Audit Report

**Application:** Novastar Montessori School — Portal (`apps/portal`)  
**Date:** 2026-09-28  
**Auditor:** Kilo (automated code audit)  
**Scope:** `apps/portal/app/(portal)/`, `apps/portal/app/providers.tsx`, `apps/portal/app/login/page.tsx`, `apps/portal/components/`, `apps/portal/lib/`, shared UI from `@novastar/shared-ui`

---

## Executive Summary

The portal application demonstrates a well-structured Next.js 16 + React 19 + Tailwind CSS v4 codebase with strong multi-tenant architecture, proper auth guards, and a sophisticated entity configuration system. However, there are **critical gaps** between the infrastructure provided and the UI patterns actually used by the pages.

### Key Findings at a Glance

| Category | Critical | High | Medium | Low |
|---|---|---|---|---|
| UI/UX Quality | 1 | 6 | 8 | 3 |
| Component Architecture | 0 | 4 | 7 | 2 |
| Performance | 0 | 2 | 4 | 1 |
| Accessibility | 0 | 3 | 4 | 2 |
| Developer Experience | 0 | 2 | 6 | 3 |
| Security | 0 | 1 | 2 | 1 |

### Top 5 Issues

1. **React Query is configured but never used** — `QueryClientProvider` is set up in `providers.tsx`, but every page uses manual `useState` + `useEffect` + raw `fetch()` instead of `useQuery`/`useMutation`. This adds 15KB+ to the bundle for zero benefit.

2. **Non-functional UI elements** — The Announcements page has a "New Announcement" button and all Edit/Delete dropdown items with no `onClick` handlers. The Grades page "Enter Scores" action opens `/grades/${a.id}/scores` which doesn't exist as a route.

3. **Raw HTML elements instead of shared UI components** — Despite `@novastar/shared-ui` exporting `Input`, `Select`, `Table`, `TableHead`, `Skeleton`, `Badge`, and `Label` components, pages use raw `<input>`, `<select>`, `<table>`, and hand-rolled `animate-pulse` divs instead.

4. **ToastProvider/ConfirmProvider not at root level** — These providers are only wrapped inside `PortalLayout`, meaning the login page and any non-portal route cannot use `toast()` or `useConfirm()` without crashing.

5. **All portal pages are `'use client'`** — Nearly every page marks itself as a client component, defeating SSR/ISR benefits. Only the Dashboard page correctly uses Server Components.

---

## Detailed Findings

### 1. UI/UX Quality

#### 1.1 React Query Configured But Unused (HIGH)

**Severity:** High  
**Files:** `app/providers.tsx:5-15`, all pages under `app/(portal)/`

The `providers.tsx` file imports `QueryClient`, `QueryClientProvider` and creates a `QueryClient` with sensible defaults (5-minute stale time, 1 retry). However, **no page or component in the entire portal uses `useQuery`, `useMutation`, or any React Query API**. Instead, every page implements its own boilerplate fetch pattern:

```tsx
// students/page.tsx:28-58 (repeated in 8+ pages)
const [students, setStudents] = useState<Student[]>([])
const [loading, setLoading] = useState(true)
// ...
useEffect(() => {
  const load = async () => { await fetchStudents() }
  load()
}, []) // eslint-disable-line react-hooks/exhaustive-deps
```

**Recommendation:** Migrate to React Query. The setup is already done — just use `useQuery`:

```tsx
const { data: students, isLoading, error } = useQuery({
  queryKey: ['students', search],
  queryFn: () => fetch(`/api/students?${params}`).then(r => r.json()),
  staleTime: 5 * 60 * 1000,
})
```

This would eliminate ~300 lines of duplicated fetch logic across pages.

#### 1.2 Providers Missing from Root Layout (HIGH)

**Severity:** High  
**Files:** `app/layout.tsx:29-37`, `app/providers.tsx:17-26`, `app/(portal)/layout.tsx:74-81`

`ToastProvider` and `ConfirmProvider` are only wrapped inside `PortalLayout`, not in the root `Providers` component. This means:

- The login page (`app/login/page.tsx`) has no `ToastProvider` — if any toast is triggered before navigation to the portal, it will throw `useToast must be used within a ToastProvider`.
- The `ConfirmProvider` is required by `useConfirm()` which is used in `students/page.tsx:27`, `teachers/page.tsx:29`, `grades/page.tsx:28`, `fees/page.tsx:29`, `calendar/page.tsx:65`, and `entity-list.tsx:64`. If these pages are ever rendered outside the PortalLayout wrapper, they will crash.

**Recommendation:** Move `ToastProvider` and `ConfirmProvider` into `Providers` in `app/providers.tsx` so they wrap the entire application:

```tsx
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <ToastProvider>
            <ConfirmProvider>
              {children}
            </ConfirmProvider>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProvider>
  )
}
```

Then remove the `ToastProvider`/`ConfirmProvider` wrappers from `PortalLayout`.

#### 1.3 All Portal Pages Marked `'use client'` (HIGH)

**Severity:** High  
**Files:** All pages under `app/(portal)/` except `dashboard/page.tsx`

| Page | `'use client'` | Notes |
|---|---|---|
| `dashboard/page.tsx` | No | Correctly uses Server Component |
| `students/page.tsx:1` | Yes | Could be Server Component with Server Action mutations |
| `teachers/page.tsx:1` | Yes | Same |
| `attendance/page.tsx:1` | Yes | Same |
| `grades/page.tsx:1` | Yes | Same |
| `calendar/page.tsx:1` | Yes | Same |
| `announcements/page.tsx:1` | Yes | Same |
| `reports/page.tsx:1` | Yes | Same |
| `fees/page.tsx:1` | Yes | Same |
| `settings/page.tsx:1` | Yes | Same |
| `settings/entities/page.tsx:1` | Yes | Same |

Marking everything `'use client'` defeats Next.js's SSR capabilities, increases TTI, and adds unnecessary client-side JavaScript to every page.

**Recommendation:** Use Server Components for data fetching and pass data to client components only where interactivity is needed. This is the Next.js 16 App Router best practice.

#### 1.4 Raw HTML Elements Instead of Shared UI Components (HIGH)

**Severity:** High  
**Files:** Multiple

Despite `@novastar/shared-ui` exporting styled components (`Input`, `Select`, `Table`, `TableHead`, `Skeleton`, `Badge`, `Label`), pages use raw HTML:

| File | Line | Raw Element | Shared UI Alternative |
|---|---|---|---|
| `students/page.tsx` | 123-129 | `<input>` + manual icon positioning | `<Input>` + `<Search>` icon wrapper |
| `grades/page.tsx` | 93-104 | `<input>` | `<Input>` |
| `calendar/page.tsx` | 251-257 | `<input>` | `<Input>` |
| `fees/page.tsx` | 198-209 | `<input>` | `<Input>` |
| `students/page.tsx` | 151-159 | Raw `<table>` + `<thead>` | `<Table>`, `<TableHeader>`, `<TableHead>` |
| `teachers/page.tsx` | 132-140 | Raw `<table>` | `<Table>` components |
| `grades/page.tsx` | 125-135 | Raw `<table>` | `<Table>` components |
| `fees/page.tsx` | 230-238 | Raw `<table>` | `<Table>` components |
| `reports/page.tsx` | 109-120, 124-135 | Raw `<select>` | `<Select>`, `<SelectTrigger>` |

The shared `Table` component (`packages/shared-ui/src/components/table.tsx`) provides proper semantic structure with `Table`, `TableHeader`, `TableBody`, `TableHead`, `TableRow`, `TableCell`, and `TableCaption` — all with correct styling via the theme.

**Recommendation:** Replace raw HTML elements with shared components. For example:

```tsx
// Instead of:
<input
  type="text"
  placeholder="Search students..."
  value={search}
  onChange={e => handleSearch(e.target.value)}
  className="pl-10 pr-4 py-2 border rounded-md w-full"
/>

// Use:
<Input
  type="text"
  placeholder="Search students..."
  value={search}
  onChange={(e) => handleSearch(e.target.value)}
  className="pl-10"
/>
```

For tables:

```tsx
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableCaption } from '@novastar/shared-ui'

<Table>
  <TableCaption>List of all students</TableCaption>
  <TableHeader>
    <TableRow>
      <TableHead scope="col">Name</TableHead>
      <TableHead scope="col">Student ID</TableHead>
      ...
    </TableRow>
  </TableHeader>
  <TableBody>
    {students.map(s => (
      <TableRow key={s.id}>
        <TableCell>{s.firstName} {s.lastName}</TableCell>
        ...
      </TableRow>
    ))}
  </TableBody>
</Table>
```

#### 1.5 `Skeleton` Component Exists But Never Used (MEDIUM)

**Severity:** Medium  
**Files:** `packages/shared-ui/src/components/skeleton.tsx`, all pages with loading states

The `Skeleton` component (`packages/shared-ui/src/components/skeleton.tsx:4-21`) is exported from `@novastar/shared-ui` but is never imported anywhere in the portal. Instead, every page uses ad-hoc inline divs:

```tsx
// students/page.tsx:138-141
<div className="space-y-2">
  {[...Array(5)].map((_, i) => (
    <div key={i} className="h-12 bg-muted animate-pulse rounded" />
  ))}
</div>
```

The shared `Skeleton` component has a proper shimmer animation (gradient overlay) and is theme-aware.

**Recommendation:** Import and use the `Skeleton` component:

```tsx
import { Skeleton } from '@novastar/shared-ui'

<Skeleton className="h-12 w-full" />
```

#### 1.6 Non-Functional UI Elements on Announcements Page (HIGH)

**Severity:** High  
**Files:** `app/(portal)/announcements/page.tsx:61-64`, `app/(portal)/announcements/page.tsx:102-110`

The "New Announcement" button (lines 61-64) has no `onClick` handler:

```tsx
// announcements/page.tsx:61-64
<Button className="gap-2">
  <Plus className="h-4 w-4" />
  New Announcement
</Button>
```

The Edit and Delete dropdown items (lines 102-110) also have no `onClick`:

```tsx
// announcements/page.tsx:102-104
<DropdownMenuItem>
  <Edit2 className="h-4 w-4 mr-2" />
  Edit
</DropdownMenuItem>
// lines 107-109
<DropdownMenuItem className="text-red-600 focus:text-red-600">
  <Trash2 className="h-4 w-4 mr-2" />
  Delete
</DropdownMenuItem>
```

These are dead UI — clicking them does nothing.

**Recommendation:** Implement `handleNew`, `handleEdit`, and `handleDelete` functions, and wire them to the `onClick` handlers. Consider reusing the `StudentForm`/`StaffForm` dialog pattern for the announcement editor.

#### 1.7 Grades Page Opens Non-Existent Route (MEDIUM)

**Severity:** Medium  
**Files:** `app/(portal)/grades/page.tsx:157`

The "Enter Scores" dropdown item uses `window.open` to navigate to a route that doesn't exist:

```tsx
// grades/page.tsx:156-161
<DropdownMenuItem
  onClick={() => window.open(`/grades/${a.id}/scores`, '_blank')}
>
  <Edit2 className="h-4 w-4 mr-2" />
  Enter Scores
</DropdownMenuItem>
```

There is no `app/(portal)/grades/[id]/scores` directory or file in the codebase.

**Recommendation:** Either create the scores entry page or use the existing router navigation pattern:
```tsx
onClick={() => router.push(`/grades/${a.id}/scores`)}
```

#### 1.8 Search Inputs Lack Debounce (MEDIUM)

**Severity:** Medium  
**Files:** `students/page.tsx:60-65`, `grades/page.tsx:97-102`, `calendar/page.tsx:107-112`, `fees/page.tsx:202-207`

The search triggers API calls on every keystroke. While there's a guard (`value.length >= 2 || value.length === 0`), this still fires on every 3rd keystroke without debouncing:

```tsx
// students/page.tsx:60-65
const handleSearch = (value: string) => {
  setSearch(value)
  if (value.length >= 2 || value.length === 0) {
    fetchStudents()
  }
}
```

The `debounce` utility exists in `@novastar/shared-utils` (`packages/shared-utils/index.ts:205-214`) but is never used.

**Recommendation:** Use the shared debounce utility:

```tsx
import { debounce } from '@novastar/shared-utils'

const debouncedSearch = useRef(
  debounce((value: string) => {
    setSearch(value)
    fetchStudents()
  }, 300)
).current
```

Or use React Query's built-in `enabled` and `staleTime` options to manage search-triggered refetches.

#### 1.9 Missing Pagination on Data-Heavy Pages (MEDIUM)

**Severity:** Medium  
**Files:** `students/page.tsx`, `teachers/page.tsx`, `grades/page.tsx`, `fees/page.tsx`

The `EntityList` component (`components/config/entity-list.tsx:306-330`) implements proper pagination, but Students, Teachers, Grades, and Fees pages fetch all records with no pagination:

```tsx
// students/page.tsx:34-51 — fetchStudents fetches all records
const res = await fetch(`/api/students?${params}`)
```

The API endpoints support pagination (e.g., `api/config/[entityType]/route.ts:320-321` has `paginationSchema`), but these pages don't use it.

**Recommendation:** Implement paginated fetching. At minimum, add a limit to the API calls and show "Load more" or pagination controls.

#### 1.10 Reports Page Debug Code and Incorrect Button State (MEDIUM)

**Severity:** Medium  
**Files:** `app/(portal)/reports/page.tsx:78`, `app/(portal)/reports/page.tsx:140`

- Line 78: `console.log('Report data:', data)` — debug statement left in production code.
- Line 140: The Generate button is disabled based on `loading` (initial data fetch), not on report generation state:

```tsx
// reports/page.tsx:136-144
<Button
  onClick={handleGenerateReport}
  className="w-full gap-2"
  disabled={loading}  // Should be a separate `generating` state
>
```

**Recommendation:** Add a separate `generating` state for the report generation flow, and remove the `console.log`.

#### 1.11 Raw `<label>` Tags Instead of Shared Label Component (LOW)

**Severity:** Low  
**Files:** `students/page.tsx:67`, `grades/page.tsx` (inline labels), `fees/page.tsx:311, 330, 340, 349, 358, 366`

Multiple pages use raw `<label>` tags with manual styling:

```tsx
// students/page.tsx:67
<label className="block text-sm font-medium mb-1">School Code</label>
```

Instead of the shared `Label` component which has `cursor-pointer` behavior when used with `htmlFor`:

```tsx
import { Label } from '@novastar/shared-ui'
<Label htmlFor="schoolCode">School Code</Label>
```

#### 1.12 Login Form Lacks `aria-describedby` for Error Messages (LOW)

**Severity:** Low  
**Files:** `app/login/page.tsx:97-99`

The error message div is not associated with the form inputs:

```tsx
// login/page.tsx:97-99
{error && (
  <p className="text-sm text-destructive">{error}</p>
)}
```

**Recommendation:** Use `aria-describedby` and `role="alert"`:

```tsx
{error && (
  <p id="login-error" role="alert" className="text-sm text-destructive">{error}</p>
)}
```

Then add `aria-describedby="login-error"` to the password input.

#### 1.13 Hardcoded Gender in Forms (MEDIUM)

**Severity:** Medium  
**Files:** `components/students/student-form.tsx:121`, `components/teachers/staff-form.tsx:101`

Both forms hardcode `gender: 'OTHER'`:

```tsx
// student-form.tsx:121
const body = {
  // ...
  gender: 'OTHER' as const,
  // ...
}
```

This prevents the user from specifying the student's/teacher's actual gender. The `gender` field is defined in the config schema (`packages/shared-types/config-schema.ts:577, 597`) as a select field with `MALE`/`FEMALE` options, but neither form exposes this to the user.

**Recommendation:** Add a gender selection field to both forms:

```tsx
const [gender, setGender] = useState<'MALE' | 'FEMALE' | 'OTHER'>('MALE')
// ...
<Input type="radio" id="male" name="gender" value="MALE" checked={gender === 'MALE'} onChange={() => setGender('MALE')} />
```

#### 1.14 Dashboard Grid Mismatch (LOW)

**Severity:** Low  
**Files:** `app/(portal)/dashboard/page.tsx:46`

The dashboard stat cards grid is set to `lg:grid-cols-4` (4 columns on large screens) but only 3 stat cards are defined (line 31-35: Students, Teachers, Pending Fees). This means the 4th column will always be empty on desktop.

```tsx
// dashboard/page.tsx:46
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
```

**Recommendation:** Either change to `lg:grid-cols-3` or add a fourth stat card (e.g., "Classes" or "Reports Generated").

---

### 2. Component Architecture

#### 2.1 Duplicated Fetch Logic Across 8+ Pages (HIGH)

**Severity:** High  
**Files:** `students/page.tsx:28-58`, `teachers/page.tsx:30-57`, `grades/page.tsx:29-57`, `calendar/page.tsx:64-98`, `announcements/page.tsx:27-52`, `fees/page.tsx:46-63`, `reports/page.tsx:37-61`

Every page implements nearly identical data-fetching boilerplate:

1. Local state for data + loading
2. `useEffect` that calls an async fetch function
3. try/catch/finally with toast error handling
4. A refresh button with `RefreshCw` icon

The only shared abstraction is `EntityList` (`components/config/entity-list.tsx:46-94`), which uses `useCallback`-based fetching correctly, but the other pages don't follow that pattern.

**Recommendation:** Create a shared `useApiQuery` hook or use React Query (which is already set up). For the table pattern, either generalize `EntityList` to handle all entities or create a shared `DataTable` wrapper.

#### 2.2 Missing `ToastProvider`/`ConfirmProvider` in Root (Already noted in 1.2, re-emphasized here as architecture issue)

**Severity:** High  
**Files:** `app/providers.tsx:17-26`, `app/(portal)/layout.tsx:74-81`

The provider architecture is split: auth/session/query/theme providers are in root `Providers`, but toast/confirm providers are only in PortalLayout. This creates a dependency where any component using `useToast` or `useConfirm` must be a descendant of `PortalLayout`, which is an implicit and fragile constraint.

#### 2.3 StudentForm and StaffForm Code Duplication (MEDIUM)

**Severity:** Medium  
**Files:** `components/students/student-form.tsx:45-266`, `components/teachers/staff-form.tsx:28-240`

These two components share 90% of their structure:
- Same `open`, `onOpenChange`, `editId`, `onSuccess` props
- Same loading state management
- Same form submission pattern
- Same dialog layout with header, form body, and footer

Differences: field set, API endpoints, and some state shapes.

**Recommendation:** Extract a generic `EntityDialogForm` component or use the existing `EntityForm` from `components/config/entity-form.tsx` pattern (which is driven by field configuration from the entity registry).

#### 2.4 `any` Type Usage (MEDIUM)

**Severity:** Medium  
**Files:** Multiple

| File | Line | Issue |
|---|---|---|
| `components/config/entity-form.tsx` | 27 | `field: any` — React Hook Form Controller field typed as `any` |
| `app/api/config/[entityType]/route.ts` | 330-334 | Model methods typed as `unknown[]` |
| `app/api/config/[entityType]/[id]/route.ts` | 240 | `prisma as any` |
| `config-schema.ts` | See `EntityFieldSchema` | `default: z.unknown().optional()` — overly permissive |

The ESLint config sets `@typescript-eslint/no-explicit-any` to `'warn'` (`eslint.config.mjs:104`), which allows `any` to slip through as warnings rather than errors.

**Recommendation:** Replace `any` with proper types. For the `field` prop in `entity-form.tsx`, use the RHF `ControllerFieldProps` type.

#### 2.5 Shared `Table` Component Underutilized (MEDIUM)

**Severity:** Medium  
**Files:** All table pages

The shared `Table`, `TableHeader`, `TableBody`, `TableHead`, `TableRow`, `TableCell`, and `TableCaption` components (`packages/shared-ui/src/components/table.tsx`) provide semantic HTML table structure with proper styling, but none of the portal pages import them. Instead, raw `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>` elements are used with manual className props.

**Recommendation:** Use the shared table components for consistent styling and built-in features (e.g., the `[&_tr:last-child]:border-0` rule in `TableBody`).

#### 2.6 `EntityList` vs Page-Level Tables — Architectural Inconsistency (MEDIUM)

**Severity:** Medium  
**Files:** `components/config/entity-list.tsx` vs `students/page.tsx`, `teachers/page.tsx`

The `EntityList` component (`components/config/entity-list.tsx:46-357`) is a well-architected generic CRUD component with:
- Server-driven pagination (via `meta` state)
- Sortable columns with visual indicators
- Search with debounce-like threshold
- Proper confirmation dialogs for delete
- Form integration for create/edit

However, the Students, Teachers, Grades, and Fees pages each implement their own table pattern from scratch, without pagination, sorting, or the same confirmation flow consistency.

**Recommendation:** Either refactor the page-level tables to use `EntityList`, or extract common table primitives (sortable headers, pagination, search) into reusable building blocks that both can use.

#### 2.7 Inconsistent `fetch` Patterns (MEDIUM)

**Severity:** Medium  
**Files:** All client pages

Some pages use `useCallback` for their fetch functions (good — `calendar/page.tsx:81-98`, `fees/page.tsx:46-63`), while others don't (`students/page.tsx:34-51`, `teachers/page.tsx:35-50`, `grades/page.tsx:33-50`). The ones without `useCallback` will recreate the function on every render, potentially causing unnecessary re-renders.

Additionally, some pages call `fetchStudents()` directly in the `useEffect` (without wrapping in an async IIFE), while others wrap properly.

#### 2.8 Missing Shared API Response Types (MEDIUM)

**Severity:** Medium  
**Files:** All pages

Each page defines its own inline interface for the data it expects:

```tsx
// students/page.tsx:13-23
interface Student {
  id: string
  studentId: string
  firstName: string
  // ...
}

// teachers/page.tsx:13-25
interface Teacher {
  id: string
  employeeId: string
  // ...
}

// grades/page.tsx:12-24
interface Assessment {
  id: string
  name: string
  // ...
}
```

These types are not in `@novastar/shared-types` and don't match the API response shapes exactly (e.g., the API returns `Date` objects but the frontend interface uses `string`). This creates drift risk between frontend expectations and backend reality.

**Recommendation:** Add shared types to `@novastar/shared-types` for all API resources.

#### 2.9 ESLint Disable Comments Without Justification (LOW)

**Severity:** Low  
**Files:** `students/page.tsx:58`, `teachers/page.tsx:57`, `grades/page.tsx:57`

Each page has: `// eslint-disable-line react-hooks/exhaustive-deps` without a comment explaining why the deps are intentionally incomplete.

```tsx
// students/page.tsx:53-58
useEffect(() => {
  const load = async () => {
    await fetchStudents()
  }
  load()
}, []) // eslint-disable-line react-hooks/exhaustive-deps
```

**Recommendation:** Either fix the dependency array or add an explanatory comment.

#### 2.10 `EntityForm.getFormField` Uses Inline Component Definitions (LOW)

**Severity:** Low  
**Files:** `components/config/entity-form.tsx:204-324`

The `getFieldComponent` function defines components inline within `case` blocks, which works but creates new component types on every render. This is a minor performance concern and makes the code harder to test.

#### 2.11 `EntityList` Search Doesn't Debounce (MEDIUM)

**Severity:** Medium  
**Files:** `components/config/entity-list.tsx:200-207`

The search input in `EntityList` updates state immediately on every keystroke:

```tsx
// entity-list.tsx:200-207
<Input
  placeholder="Search..."
  value={search}
  onChange={e => setSearch(e.target.value)}
  className="pl-10"
/>
```

Since `search` is part of the `fetchData` dependency array (`entity-list.tsx:87`), this triggers an API call on every keystroke.

**Recommendation:** Add debouncing to the search input.

---

### 3. Performance

#### 3.1 React Query Bundle Cost Without Usage (HIGH)

**Severity:** High  
**Files:** `app/providers.tsx:5`, `package.json:29`

`@tanstack/react-query` (~15KB minified) is listed as a dependency, set up in providers, but never actually used by any component. This is dead weight in the bundle.

**Recommendation:** Either start using React Query (highly recommended for the data-fetching patterns in this app) or remove it from providers and dependencies.

#### 3.2 No Virtualization for Large Tables (MEDIUM)

**Severity:** Medium  
**Files:** `students/page.tsx:150-209`, `teachers/page.tsx:131-190`, `grades/page.tsx:124-176`, `fees/page.tsx:229-291`

All tables render all rows at once. For a school with 500+ students, this will cause significant rendering lag. `@tanstack/react-table` is in the dependencies (`package.json:30`) and the `DataTabled` component exists (`packages/shared-ui/src/components/data-table.tsx:17-54`) but is never used.

**Recommendation:** Use `DataTabled` or add `react-window`/`react-virtualized` for virtual scrolling on large tables.

#### 3.3 `force-dynamic` on Layout + All Client Components (MEDIUM)

**Severity:** Medium  
**Files:** `app/(portal)/layout.tsx:4`, all pages

```tsx
// layout.tsx:3-4
// Portal pages require auth + live DB data — never prerender at build
export const dynamic = 'force-dynamic'
```

Combined with nearly every page being `'use client'`, this means there is zero SSR, zero ISR, and zero caching for the entire portal. Every visit re-fetches all data client-side.

**Recommendation:** Convert pages to Server Components where possible (at minimum, for initial data loading), and use ISR for data that changes infrequently (e.g., class lists, roles, subjects).

#### 3.4 No Code Splitting / Lazy Loading (MEDIUM)

**Severity:** Medium  
**Files:** `app/(portal)/layout.tsx`, all pages

Heavy components like the calendar event dialog (with its complex form `app/(portal)/calendar/page.tsx:357-470`) and the fees payment dialog (`app/(portal)/fees/page.tsx:296-382`) are bundled into the initial JS payload. They should be lazy-loaded:

```tsx
const CalendarEventDialog = lazy(() => import('./calendar-event-dialog'))
```

`react` and `next/dynamic` are available but no `lazy`/`Suspense` pattern is used anywhere.

#### 3.5 `zustand` Dependency Installed But Unused (LOW)

**Severity:** Low  
**Files:** `package.json:42`

`zustand@4.5.5` is in dependencies but is never imported anywhere in the portal source. If not needed, remove it to save bundle size.

---

### 4. Accessibility (WCAG 2.1 AA)

#### 4.1 Icon-Only Buttons Missing `aria-label` (HIGH)

**Severity:** High  
**Files:** Multiple

| File | Line | Button | Issue |
|---|---|---|---|
| `app/(portal)/layout.tsx` | 160-165 | Bell, Search icon buttons in header | No `aria-label` |
| `app/(portal)/students/page.tsx` | 186-188 | MoreHorizontal dropdown trigger | No `aria-label` |
| `app/(portal)/teachers/page.tsx` | 167-169 | MoreHorizontal dropdown trigger | No `aria-label` |
| `app/(portal)/grades/page.tsx` | 151-153 | MoreHorizontal dropdown trigger | No `aria-label` |
| `app/(portal)/fees/page.tsx` | 264-266 | MoreHorizontal dropdown trigger | No `aria-label` |
| `app/(portal)/announcements/page.tsx` | 97-99 | MoreHorizontal dropdown trigger | No `aria-label` |
| `app/(portal)/calendar/page.tsx` | 299-301 | MoreHorizontal dropdown trigger | No `aria-label` |
| `app/(portal)/students/page.tsx` | 95-102 | Menu close button | No `aria-label` |
| `app/(portal)/layout.tsx` | 95-102 | Menu buttons | No `aria-label` |

**Recommendation:** Add `aria-label` to all icon-only buttons:

```tsx
<Button variant="ghost" size="icon" aria-label="Notifications">
  <Bell className="h-4 w-4" />
</Button>

<Button variant="ghost" size="icon" aria-label={`Actions for ${s.firstName} ${s.lastName}`}>
  <MoreHorizontal className="h-4 w-4" />
</Button>
```

#### 4.2 Raw Tables Missing Semantic Structure (HIGH)

**Severity:** High  
**Files:** `students/page.tsx:151-209`, `teachers/page.tsx:132-190`, `grades/page.tsx:125-176`, `fees/page.tsx:230-291`

The raw HTML tables are missing several accessibility features:

1. **No `<caption>` element** — Tables need a caption to describe their purpose for screen readers.
2. **No `scope="col"` on `<th>` elements** — Screen readers use scope to associate header cells with data cells.
3. **No `aria-sort` attributes** — Even though sorting isn't implemented, the shared `TableHead` component supports it.
4. **No `aria-label` on dropdown triggers** — The action column header is just `<th className="w-12" />` with no label.

**Recommendation:** Use the shared `Table` components which include proper structure, or add:

```tsx
<table>
  <caption className="sr-only">List of all students</caption>
  <thead>
    <tr>
      <th scope="col">Name</th>
      <th scope="col">Student ID</th>
      ...
      <th scope="col" aria-label="Actions">Actions</th>
    </tr>
  </thead>
</table>
```

#### 4.3 Color-Only Status Indicators (MEDIUM)

**Severity:** Medium  
**Files:** `fees/page.tsx:174-181`, `calendar/page.tsx:228-232`

Status badges use background color classes to convey meaning:

```tsx
// fees/page.tsx:174-181
const statusColors: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  PAID: 'bg-green-100 text-green-800',
  // ...
}

// fees/page.tsx:253-256
<Badge className={statusColors[inv.status] || ''}>
  {inv.status}
</Badge>
```

While the badge text does show the status name, the color coding relies on visual perception. For users with color blindness, the distinction between `PENDING` (amber) and `PARTIAL` (blue) may not be clear.

**Recommendation:** Add an `aria-label` or additional icon indicator:

```tsx
<Badge 
  className={statusColors[inv.status]}
  aria-label={`Invoice status: ${inv.status}`}
>
  {inv.status}
</Badge>
```

#### 4.4 Search Inputs Missing Labels (MEDIUM)

**Severity:** Medium  
**Files:** `students/page.tsx:123-129`, `grades/page.tsx:93-104`, `calendar/page.tsx:251-257`, `fees/page.tsx:198-209`, `entity-list.tsx:200-207`

The search inputs use a visual search icon positioned absolutely, but the input itself has no `aria-label` or associated `<label>`:

```tsx
// students/page.tsx:121-129
<div className="relative">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
  <input
    type="text"
    placeholder="Search students..."
    value={search}
    onChange={e => handleSearch(e.target.value)}
    className="pl-10 pr-4 py-2 border rounded-md w-full"
  />
</div>
```

**Recommendation:** Add `aria-label` to the input:

```tsx
<Input
  type="search"
  aria-label="Search students"
  placeholder="Search students..."
  value={search}
  onChange={(e) => handleSearch(e.target.value)}
/>
```

#### 4.5 Missing Focus Visible Styles on Interactive Elements (MEDIUM)

**Severity:** Medium  
**Files:** All pages using custom className patterns

The portal's `globals.css` has custom focus styles (`.focus-visible:ring-2`, `.focus-visible:ring-ring`), but the raw HTML input/select elements in pages use manual className strings that don't include focus indicators:

```tsx
// students/page.tsx:128
className="pl-10 pr-4 py-2 border rounded-md w-full"
```

**Recommendation:** Use the shared `Input` component which inherits the theme's focus ring styles, or add `focus:ring-2 focus:ring-ring` to custom inputs.

#### 4.6 Login Form: Error Message Not Linked to Inputs (LOW)

**Severity:** Low  
**Files:** `app/login/page.tsx:97-99`

The error message is displayed below the form but has no `role="alert"` or `aria-live` attribute, so screen readers won't announce it.

**Recommendation:**

```tsx
{error && (
  <p 
    role="alert" 
    aria-live="assertive"
    className="text-sm text-destructive"
  >
    {error}
  </p>
)}
```

#### 4.7 Date Inputs Lack Localization (LOW)

**Severity:** Low  
**Files:** `student-form.tsx:228`, `staff-form.tsx:202`, `calendar/page.tsx:393, 403`, `entity-form.tsx:245`

Date inputs use `type="date"` without specifying a locale. Screen readers in different locales (e.g., Twi-speaking users in Ghana) may mispronounce dates.

**Recommendation:** Add `lang` attribute or use a localized date picker component.

#### 4.8 `ThemeProvider` Has `enableSystem` But No Theme Toggle Visible (LOW)

**Severity:** Low  
**Files:** `app/providers.tsx:21`

The `ThemeProvider` is configured with `enableSystem: true`, suggesting dark mode support, but no theme toggle button is visible in the layout header. Users cannot switch themes.

```tsx
// providers.tsx:21
<ThemeProvider attribute="class" defaultTheme="light" enableSystem>
```

**Recommendation:** Add a theme toggle button (sun/moon icon) in the header.

---

### 5. Developer Experience

#### 5.1 Inline Interfaces Duplicate Backend Types (MEDIUM)

**Severity:** Medium  
**Files:** All pages and both form components

As noted in 2.8, each page defines its own interface for API response data, leading to:

1. **Type drift**: If the backend adds a field, the frontend interface won't reflect it until manually updated.
2. **No autocompletion** for new fields.
3. **Redundant maintenance**: 6+ interfaces define similar shapes (Student, Teacher, Assessment, Announcement, FeeInvoice, CalendarEvent).

**Recommendation:** Add shared types to `@novastar/shared-types/index.ts`:

```ts
export interface StudentDTO {
  id: string
  studentId: string
  firstName: string
  lastName: string
  // ...
}
```

#### 5.2 No Error Boundaries (MEDIUM)

**Severity:** Medium  
**Files:** Entire application

Next.js 16 supports React Error Boundaries via `app/[...not-found].tsx` and `app/error.tsx`, but no such file exists in the portal. The dashboard has `app/(portal)/dashboard/unauthorized/page.tsx` but there's no general error boundary for the `(portal)` route segment.

**Recommendation:** Create `app/(portal)/error.tsx`:

```tsx
'use client'
export default function PortalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
      <h1 className="font-heading text-4xl font-bold text-destructive mb-4">Something went wrong</h1>
      <p className="text-muted-foreground mb-6 max-w-md">{error.message}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  )
}
```

#### 5.3 `field: any` in EntityForm (Already noted in 2.5, re-emphasized)

The `FieldComponentProps` interface uses `any` for the `field` property, which is the RHF Controller's field object. This should use the proper RHF types.

#### 5.4 No Shared Data-Fetching Hook Pattern (MEDIUM)

**Severity:** Medium  
**Files:** All client pages

There are no custom hooks like `useStudents()`, `useTeachers()`, etc. The fetch logic is inline in each page component, making it impossible to:
- Reuse across pages
- Share loading/error states in a consistent way
- Test independently
- Apply consistent caching/refetching policies

**Recommendation:** Create hooks in `apps/portal/lib/hooks/`:

```ts
// lib/hooks/useStudents.ts
export function useStudents(search?: string) {
  return useQuery({
    queryKey: ['students', search],
    queryFn: () => fetchStudents(search),
  })
}
```

#### 5.5 `StudentForm` and `StaffForm` Have No Field Validation Messages (MEDIUM)

**Severity:** Medium  
**Files:** `components/students/student-form.tsx:159-262`, `components/teachers/staff-form.tsx:134-237`

Both forms use `required` attributes on inputs but don't display validation messages. The `EntityForm` component uses `react-hook-form` with `zodResolver` for proper validation, but the inline forms don't.

**Recommendation:** Migrate both forms to `react-hook-form` with `zod` validation, consistent with the `EntityForm` pattern.

#### 5.6 Inconsistent State Management Across Pages (LOW)

**Severity:** Low  
**Files:** All pages

- Some pages use `useState` + raw `fetch` (`students/page.tsx`)
- Some pages use `useState` + `useCallback` + `fetch` (`calendar/page.tsx`, `fees/page.tsx`)
- `EntityList` uses `useCallback` with proper dependency arrays
- `Dashboard` uses Server Components with direct Prisma

There is no consistent pattern. A developer switching between pages needs to learn a different data-fetching approach for each one.

#### 5.7 Missing `aria-label` on Form Inputs (LOW)

**Severity:** Low  
**Files:** `login/page.tsx:67-94`

Form inputs in the login page lack `aria-label` attributes, relying solely on visible `<label>` tags. While this works if labels properly reference inputs via `htmlFor`/`id`, the current labels don't have `htmlFor` attributes:

```tsx
// login/page.tsx:67-74
<label className="block text-sm font-medium mb-1">School Code</label>
<Input
  type="text"
  placeholder="Enter your school code"
  value={schoolCode}
  onChange={(e) => setSchoolCode(e.target.value)}
  required
/>
```

The `<Input>` component doesn't get an `id`, and the `<label>` doesn't have `htmlFor`. Screen reader users may not know which label belongs to which input when there are multiple inputs in a form.

**Recommendation:** Add `id` to inputs and `htmlFor` to labels, or use the shared `Form`/`FormItem` pattern from `entity-form.tsx`.

#### 5.8 `/api/config` Endpoint Misused for Payment Methods (BUG)

**Severity:** Medium  
**Files:** `app/(portal)/fees/page.tsx:65-80`, `app/api/config/route.ts`

The FeesPage fetches payment methods from `/api/config`:

```tsx
// fees/page.tsx:65-80
const fetchPaymentMethods = useCallback(async () => {
  try {
    const res = await fetch('/api/config')
    if (res.ok) {
      const data = await res.json()
      const methods = (data.data || []).filter((e: { type: string }) => e.type === 'paymentmethodconfig')
      setPaymentMethods(methods.map((m: { code: string; name: string; instructions?: string }) => ({
        code: m.code,
        name: m.name,
        instructions: m.instructions,
      })))
    }
  } catch {
    // silently fail
  }
}, [])
```

But the `/api/config` endpoint (`app/api/config/route.ts:7-34`) returns:

```ts
return NextResponse.json({
  entityTypes: DEFAULT_ENTITY_REGISTRY.map(e => ({
    type: e.type,
    name: e.name,
    // ... other registry fields, NO `code` or `instructions`
  }))
})
```

The response has `entityTypes` (not `data`), and the items don't have `code` or `instructions` fields. The filter `e.type === 'paymentmethodconfig'` will never match because the registry uses `'payment_method'` as the type.

**This is a bug** — the payment methods dropdown in the Fees payment dialog will always be empty.

**Recommendation:** Either:
1. Use the correct endpoint `/api/config/payment_method` to fetch actual `paymentMethodConfig` records from the database.
2. Or fix the filter to match the registry type `'payment_method'`.

---

### 6. Security

#### 6.1 CSRF Risk on Manual Fetch Mutations (MEDIUM)

**Severity:** Medium  
**Files:** `students/page.tsx:82`, `teachers/page.tsx:74`, `grades/page.tsx:69`, `calendar/page.tsx:152, 182-192`, `fees/page.tsx:124, 161`, `entity-list.tsx:131, 149, 161`

All mutation calls (POST, PATCH, DELETE) use raw `fetch()` without CSRF tokens:

```tsx
// students/page.tsx:82
const res = await fetch(`/api/students/${student.id}`, { method: 'DELETE' })
```

NextAuth uses same-site cookies by default, which provides some protection, but the app doesn't use NextAuth's `getCsrfToken()` or any CSRF middleware for these manual fetch calls. If the same-site cookie policy is relaxed, these endpoints become CSRF-vulnerable.

**Recommendation:** Either use NextAuth's built-in CSRF protection or implement an `X-CSRF-Token` header check.

#### 6.2 `console.log` in Production Code (LOW)

**Severity:** Low  
**Files:** `app/(portal)/reports/page.tsx:78`

```tsx
// reports/page.tsx:78
console.log('Report data:', data)
```

This debug statement will execute in production and may leak sensitive report data in browser console logs.

#### 6.3 `suppressHydrationWarning` Hides Potential Issues (LOW)

**Severity:** Low  
**Files:** `app/layout.tsx:30`

```tsx
// layout.tsx:30
<html lang="en" suppressHydrationWarning>
```

While `suppressHydrationWarning` is sometimes necessary (e.g., for `next-themes` class manipulation), using it on the `<html>` tag suppresses ALL hydration warnings for the entire app, which can hide real bugs like mismatched date formatting between server and client.

---

## Additional Notable Observations

### Positive Patterns

1. **Server Component for Dashboard** (`dashboard/page.tsx`) — Uses async Server Component with direct Prisma access, correct `dynamic = 'force-dynamic'`. This is the right pattern.

2. **`EntityList` component** — Well-architected generic CRUD component with pagination, sorting, and search. Uses `useCallback` for fetch functions.

3. **`EntityForm` component** — Uses `react-hook-form` with Zod resolver, dynamic field rendering based on entity registry. Strong foundation for a config-driven UI.

4. **Tenant isolation** — `getTenantContext()` in `lib/tenant.ts` correctly enforces tenant isolation on every API route.

5. **Role-based navigation** — The layout filters sidebar items based on user role (`layout.tsx:66-70`).

6. **CSS architecture** — Tailwind v4 with `@config` directive, proper design token system in `globals.css`, and `tailwind.config.ts` includes shared-ui source paths.

7. **Error handling in API routes** — All API routes check for `UnauthorizedError` and `ForbiddenError` by name and return appropriate status codes.

### Architecture Mismatch

The codebase has two different "data fetching philosophies":
- **Dashboard page**: Server Component with direct Prisma
- **All other pages**: Client Component with raw `fetch()` to API routes

The React Query provider is set up for the client-side approach but isn't used. The `EntityForm` uses `react-hook-form` with proper validation, while `StudentForm` and `StaffForm` use raw uncontrolled form patterns.

This suggests the portal is mid-migration from a traditional SSR approach to a client-side interactive app, but the migration is incomplete — React Query was added but not adopted, shared UI components were created but not used, and the form patterns are inconsistent.

---

## Summary of Recommendations by Priority

### Critical (Fix Immediately)

1. **Fix the payment methods bug** in `fees/page.tsx` — the `/api/config` endpoint doesn't return payment methods.
2. **Move `ToastProvider` and `ConfirmProvider`** to root `Providers` in `app/providers.tsx`.
3. **Wire up non-functional buttons** on the Announcements page (New Announcement, Edit, Delete).
4. **Remove `console.log`** from `reports/page.tsx:78`.

### High Priority

5. **Adopt React Query** — it's already configured but unused. Start with `students/page.tsx` as a pilot.
6. **Convert pages to Server Components** where possible, keeping only interactive parts as client components.
7. **Replace raw HTML elements with shared UI components** (`Input`, `Select`, `Table`, `Skeleton`, `Label`).
8. **Add `aria-label` to all icon-only buttons** throughout the application.

### Medium Priority

9. **Add pagination** to Students, Teachers, Grades, and Fees pages.
10. **Add debouncing** to search inputs.
11. **Create shared types** in `@novastar/shared-types` for API resources.
12. **Add error boundary** for the `(portal)` route segment.
13. **Create shared data-fetching hooks** in `apps/portal/lib/hooks/`.
14. **Fix the Grades page "Enter Scores"** link to point to an existing route or create the route.
15. **Add form validation** with `react-hook-form` + `zod` to `StudentForm` and `StaffForm`.

### Low Priority

16. **Add theme toggle button** in the header.
17. **Fix Dashboard grid** to 3 columns or add a 4th stat card.
18. **Remove unused `zustand` dependency** if not needed.
19. **Create reusable `DataTable` wrapper** from the pattern in `EntityList`.
20. **Add `aria-describedby`** relationships between form labels and inputs.
