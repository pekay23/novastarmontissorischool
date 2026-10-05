# School portal refactor: Unifiedtransform reconciliation & class-position gap

Plan ID: portal-school-portal-synthesis-and-class-position-gap

## Context and inputs

- **Reconciliation target**: legacy `C:\Projects\Unifiedtransform` (Laravel 8 / Eloquent / MySQL 5.7 / Blade+jQuery/PHP ^7.3|^8.0) vs. the Next 16 / Prisma / shared-utils portal in this repo.
- **Source sessions**: a read-only `@explore` subagent inventoryed the legacy domain surface (`ses_ef42a7...`; full transcript truncated, findings relayed via the shared board); parent orchestrator digest (`ses_f0723f8eafferSJCSegwPEf9kd`).
- **Constraint (do NOT port or duplicate)**: the `academic_settings` global singleton, the Spatie `sentence-style` permission pattern, attendance *marking*, Ghana Primary/JHS grade bands, term-scoped report-card composition, and all-or-nothing promotion mechanics — all already mature on the portal side.

## Unifiedtransform rules extracted (only high-value overlaps recorded)

| Domain area | Legacy presence | Concrete rule | Overlap verdict |
|---|---|---|---|
| **Position / rank** | **ABSENT** (exhaustive negative grep). No rank column, no computation, no tie-break, no report-card view. `final_marks` keyed strictly per-course (MarkRepository.php:80-91) → no class/school aggregate to rank against. | None. | Not an overlap. **Genuine portal gap** (below). |
| **Attendance `attendance_type`** | BUILT but shallow — 2-value keying switch `'section'`/`'course'`, only Blade radios (settings.blade.php:90,96) + migration default; validation is bare `'required'` (no `in:`); branch only at AttendanceController.php:93-97 and :154-158. Data model unchanged. | Register = 1 per section (`'section'`) or 1 per course (`'course'`); unused column zeroed in the Blade view. | **Overlap (partial)**. Portal has richer `AttendanceStatus` enum (PRESENT/ABSENT/LATE/EXCUSED/HALF_DAY) but **no subject/course-level register keying** — registers are date+period keyed. Defers: subject-level registers are a larger model/route change; out of this change's scope. |
| **`marks_submission_status`** | STUB in enforcement — `'on'`/`'off'` from checkbox; the gating UI is Blade-only (create.blade.php:36) and `MarkController::storeFinalMark` (284-311) has **no** status check, no input validation, window bypassable. | "Published and scored" is human convention typed into a free-text `note`; aggregation is unweighted sum. | **Overlap**. Portal supersets: `Assessment.isPublished` + `Score.isApproved`/`approvedById`/`approvedAt` + `POST /api/assessments/[id]/scores/[scoreId]/approve`. No port; document and move on. |
| **Per-(session, semester, class) grading-system resolution** | Real rule: `GradingSystemRepository.php:22-28` resolves a scale per cohort. NOT the excluded singleton. | n/a (not ported); portal resolves per LEVEL (school-wide), one scale per class level. | **Nuance gap, not this change** (product decision; lower priority than rank). |

> Note: the orchestrator digest previously listed `Score.approvedAt` and `AttendanceStudent.finalizedAt` as "never written" latent gaps. That is now **stale**: commit `6808abd` added the `RecordAmendment` trail with reason-gated locks and the `POST .../approve` and `.../unfinalize` routes now write `isApproved`/`approvedById`/`approvedAt` and `finalizedAt`/`finalizedById`. Verified in-place: `apps/portal/app/api/assessments/[id]/scores/[scoreId]/approve/route.ts:114,147-149` and `apps/portal/app/api/attendance/[id]/unfinalize/route.ts:91`. Both gaps are closed.

## Genuine domain gap selected for implementation

**Class position ("Position in class") on the term report card.**

- Ghanaian report cards carry a class-rank line; our portal's report card
  (`[reports]/[studentId]/page.tsx`, `/api/reports/academic/[studentId]`, and the
  class-wide **`/api/reports/batch`** POST that emails a card to every parent in a class)
  computes `weightedPercentage` and `overallPercentage` for each child but emits **no
  position** anywhere — confirmed by grep (`position|rank` over `apps/`, `packages/` →
  zero substantive hits; only CSS `position:relative` and unrelated `sortBy('weekday')`).
- It is bounded: a **pure** `shared-utils` ranking function (no DB), wired into the
  batch route that already builds every child's summary in memory, plus the field on the
  `ChildReport` payload and one line in the emailed card.

### Domain rule encoded (single source of truth, testable)

1. Ranks over students with a readable 0–100 `overallPercentage`. A child whose marks
   are all ungraded/unapproved has no aggregate → **not ranked** (position `null`), never
   ranked last; rewarding absence would mis-state a card showing "No marks recorded".
2. Higher percentage ranks first; `1` = top of class.
3. Ties share a position and the next position skips by the tie count — **standard
   competition ranking** ("1 2 2 4"), the Ghanaian school-report convention.
4. Among ties, a stable deterministic tie-break (`displayName`, then `studentId`) keeps
   the API idempotent; it does **not** change the shared position.

## Implementation change set (single cohesive change)

| File | Change |
|---|---|
| `packages/shared-utils/index.ts` | Add `StudentForRanking`, `RankedStudent` interfaces and exported `rankStudents()` (rule above). Append near academic helpers. |
| `packages/shared-utils/tests/ranking.test.ts` | **New**. TDD tests: ties share + skip, null excluded, empty, single, deterministic tie-break. Pure, no DB. |
| `apps/portal/app/api/reports/batch/route.ts` | Import `rankStudents`; add `position: number \| null` to `ChildReport.summary`; after the per-child loop, compute ranks over `results` by `overallPercentage` and attach `position` to each `report.summary`; render a "Position" row in `renderReportEmail` (the card that goes to parents). |

### Out of scope (recorded, not done here)
- Single-student card (`reports/academic/[studentId]`) showing position: would require fetching every classmate's approved aggregate, which is a heavier cohort read; left for a follow-up. Position is already in the batch payload (`children[].report.summary.position`) and in the emailed card.
- Report-type gap (7 of 8 `ReportType` values unimplemented; `ReportTemplate.template` not rendered): a separate, larger surface.
- Subject/course-level attendance register keying (the real `attendance_type` overlap): model + route change, deferred.

## Migration

No schema change: `position` is a derived value computed at read over existing `overallPercentage` values already fetched by the batch route. No migration, no `db push`.

## Tests / verification

```bash
bun run test --filter @novastar/shared-utils
bun run typecheck --filter @novastar/shared-utils
bun run typecheck --filter portal
bun run test --filter portal         # regression: existing report tests
```

## Blocker / status

Open. Implementation begins on the shared-utils function (TDD), then batch wiring.
