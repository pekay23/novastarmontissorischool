import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { EntityApiConfig, EntityParentRef, SiblingWriteRule, SiblingWriteRuleKind } from '@novastar/shared-types'
import {
  findGradingScaleApplicabilityProblems,
  type CallerScope,
  type CrossRowWriteTarget,
  type GradingScaleApplicability,
} from '@novastar/shared-utils'

/**
 * The write checks an entity registry entry declares, and the database reads they
 * need.
 *
 * Both config routes read the same declarations and would otherwise each carry
 * their own copy of "which parent, proved how, for this entity". That copy is the
 * problem: the first version of the parent check existed for exactly one entity,
 * and every entity added since inherited the hole rather than the check, because
 * there was no single list of entities a check applied to. So the declarations stay
 * in the registry, the predicates live here once, and a route adds a new entity's
 * parent by adding a line to `ENTITY_CONFIG_MAP`.
 *
 * The route never names an entity, and neither does anything in this file except
 * the per-kind table at the bottom — which is the same dispatch
 * `config/[entityType]/route.ts` already does for cross-row rules.
 */

/** A Prisma `where` clause, written without depending on Prisma's generated types. */
type Where = Record<string, unknown>

function recordString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

// ---------------------------------------------------------------------------
// Parent scoping
// ---------------------------------------------------------------------------

/**
 * The clause under which a parent row counts as the caller's.
 *
 * `schoolId` is an `OR`, never an equality, and the reason is the same one
 * `gradingScaleScopeWhere` gives: several of these models carry a nullable
 * `schoolId`, and a tenant-wide row (`schoolId` null) is a legitimate parent that
 * every school in the tenant shares. An equality would refuse every write against
 * a shared parent — the same bug wearing the opposite hat, since a shared parent
 * belongs to nobody's school and to everybody's report.
 *
 * For a model with no `schoolId` column at all, the school is reached through the
 * relation the registry named instead: `Timetable` and `ClassSubject` belong to a
 * class, so `class: { schoolId }` is the only way to ask whose timetable this is.
 * That clause has no null arm because `Class.schoolId` is required — there is no
 * shared class.
 *
 * Fails closed for a caller with no school either way: `schoolId: null` matches
 * only tenant-wide parents, and a required `schoolId` column has no null row for
 * it to find. A caller that cannot name a school cannot prove a parent, and an
 * unproven parent is a foreign one.
 */
function parentScopeWhere(
  ref: EntityParentRef,
  scope: CallerScope & { id: string },
): Where {
  if (ref.schoolRelation === '') {
    return {
      id: scope.id,
      tenantId: scope.tenantId,
      OR: [{ schoolId: scope.schoolId }, { schoolId: null }],
    }
  }
  return { id: scope.id, tenantId: scope.tenantId, [ref.schoolRelation]: { schoolId: scope.schoolId } }
}

/** One parent model's delegate, read under a clause this module built. */
function findParent(ref: EntityParentRef, where: Where): Promise<unknown> {
  const delegate = (prisma as unknown as Record<string, { findFirst: (args: { where: Where }) => Promise<unknown> }>)[
    ref.model
  ]
  return delegate.findFirst({ where })
}

/**
 * Which parent this write names, or the one the stored row already hangs from.
 *
 * The ownership check and any later judgement of the row must resolve the parent
 * the same way, or a row can be proved against one parent and judged against
 * another. This is `gradingScaleParentId` generalised: the written value wins, and
 * the stored row is the fallback for a patch that does not mention it — which is
 * the normal shape of every edit the generic settings form sends, since it
 * submits the whole field set whether or not the field was touched.
 */
function resolveParentId(ref: EntityParentRef, context: CrossRowWriteTarget): string | null {
  const written = context.write[ref.field]
  // An explicit null is a caller clearing the field, which is a decision and not a
  // missing value — it resolves to nothing on purpose, and whether that is allowed
  // is the entry's `optional` flag rather than this function's guess.
  if (written === null) return null
  return recordString(written) ?? recordString(context.existing?.[ref.field])
}

/**
 * The refusal a write earns by naming a parent that is not the caller's, or one
 * whose parent cannot be resolved at all.
 *
 * 404, and the same 404 whether the parent is missing or simply belongs to another
 * school: telling those apart would confirm that another school's row exists,
 * which is the only thing a caller probing for one wants to learn.
 *
 * The row being written is already proved to be the caller's by the route — and
 * proving it proves nothing about the row it hangs from. That is the whole of this
 * check, and it is the same argument as the one made for a band and its scale: a
 * tenant-scoped child row written into another school's parent changes what that
 * school reports without being visible in any of its own lists, because those
 * filter on the child's own `schoolId` rather than on its parent's.
 */
export async function declaredParentRefusal(
  entityConfig: EntityApiConfig,
  context: CrossRowWriteTarget,
  scope: CallerScope,
): Promise<NextResponse | null> {
  for (const ref of entityConfig.parentRefs ?? []) {
    const parentId = resolveParentId(ref, context)
    if (parentId === null) {
      // No parent to prove. Allowed only where the field is optional, which is the
      // entry stating that "none" is a real value here — a school-wide attendance
      // grant, a student with no house, a staff member in no department.
      if (ref.optional) continue
      return NextResponse.json({ error: 'Parent not found' }, { status: 404 })
    }
    if ((await findParent(ref, parentScopeWhere(ref, { ...scope, id: parentId }))) === null) {
      return NextResponse.json({ error: 'Parent not found' }, { status: 404 })
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Sibling-row validation
// ---------------------------------------------------------------------------

/** One grading scale as the applicability check reads it. */
function asApplicability(row: Where): GradingScaleApplicability {
  const levels = row.appliesToLevels
  return {
    id: recordString(row.id) ?? undefined,
    name: recordString(row.name) ?? null,
    isDefault: row.isDefault === true,
    // The column is a non-null array, so this only ever sees a caller that handed
    // over something else. Claiming no level is the safe direction for a row whose
    // levels cannot be read: it can collide with nothing.
    appliesToLevels: Array.isArray(levels)
      ? levels.filter((level): level is string => typeof level === 'string')
      : [],
    createdAt: row.createdAt as Date | string | undefined,
  }
}

/**
 * The `grading_scale` rule: one scale write must leave the school able to say
 * which of its scales grades a class.
 *
 * `appliesToLevels` is the whole of that decision, and it is ambiguous the moment
 * two scales name one level — `@@unique([tenantId, schoolId, name])` stops two
 * scales sharing a NAME, so "Ghana Primary" and "Ghana Primary 2026" are both
 * legal rows that both claim B1. Refusing here rather than picking is the point:
 * `resolveApplicableGradingScale` answers deterministically now, but a grade that
 * moves when a row is vacuumed is a grade nobody chose.
 *
 * The prospective set is the stored rows with this one replaced by the write, so a
 * partial patch is judged as it would be stored. The written row's own id is
 * dropped and the stored one filtered out by id, which is what keeps a patch from
 * being counted twice against itself.
 *
 * Not enforced on delete: removing one of two claimants resolves the ambiguity
 * rather than creating it, so a delete can only ever be the safe direction.
 */
const gradingScaleApplicabilityRule: SiblingWriteRule = async ({ write, existing, readSiblings }) => {
  const editedId = recordString(existing?.id)
  const siblings = await readSiblings()
  const prospective = [
    ...siblings.filter((row) => recordString(row.id) !== editedId),
    // A create has no stored row to merge, so this is the validated write alone;
    // an update is the stored row with the patch merged over it.
    ...(existing === null ? [write] : [{ ...existing, ...write }]),
  ]
  return findGradingScaleApplicabilityProblems(prospective.map(asApplicability))
}

/**
 * The sibling read each kind needs, bound to the caller rather than left to the
 * rule.
 *
 * Scoping is not an optimisation. The read is what turns a collision into a 400
 * that names the scales involved, so an unscoped read both refuses this school's
 * write for a conflict on another school's scale and prints that school's grading
 * configuration in the refusal.
 *
 * Typed by `SiblingWriteRuleKind` so a declared kind with no read is a compile
 * error rather than a rule that silently judges nobody.
 */
const SIBLING_READS: Record<SiblingWriteRuleKind, (scope: CallerScope) => Promise<Where[]>> = {
  grading_scale_applicability: (scope) =>
    prisma.gradingScale.findMany({
      where: { tenantId: scope.tenantId, OR: [{ schoolId: scope.schoolId }, { schoolId: null }] },
      select: { id: true, name: true, isDefault: true, appliesToLevels: true, createdAt: true },
    }),
}

const SIBLING_WRITE_RULES: Record<SiblingWriteRuleKind, SiblingWriteRule> = {
  grading_scale_applicability: gradingScaleApplicabilityRule,
}

/**
 * The problems a write would leave behind, judged against its own kind's siblings.
 *
 * Empty for every entity that declares no rule. Both tables are typed by
 * `SiblingWriteRuleKind`, so adding a kind without a rule and a read beside it is a
 * compile error rather than a write that skips validation — which is the whole
 * reason the kind is a union in the registry rather than a string.
 */
export async function siblingWriteProblems(
  entityConfig: EntityApiConfig,
  context: {
    operation: 'create' | 'update'
    write: Record<string, unknown>
    existing: Record<string, unknown> | null
  },
  scope: CallerScope,
): Promise<string[]> {
  const kind = entityConfig.siblingWriteValidation?.kind
  if (kind === undefined) return []
  return SIBLING_WRITE_RULES[kind]({
    ...context,
    readSiblings: () => SIBLING_READS[kind](scope),
  })
}
