// Barrel re-export for '@/lib/queries' — preserves all existing imports.
// The actual logic lives in the queries/ directory.

// Projections & utilities
export {
  AUDIT_SELECT,
  PLATFORM_AUDIT_SCOPE,
  appendAudit,
  writeAuditEntry,
  iso,
  pageOf,
  toAuditEntry,
  type AuditWrite,
} from '@/lib/queries/audit-writes'

// Tenant gate, projections, fleet reads, tenant reads/writes
export {
  TENANT_SELECT,
  SCHOOL_SELECT,
  TENANT_USER_SELECT,
  toSummary,
  assertTenantIsActive,
  getTenantById,
  listSchoolsForTenant,
  listUsersForTenant,
  getSchoolInTenant,
  auditForTenant,
  listTenantsAcrossPlatform,
  countPlatformTotals,
  countAppliedMigrations,
  auditAcrossPlatform,
  updateTenantFields,
  setTenantActive,
  writeTenantSetting,
  isSafeSettingPath,
} from '@/lib/queries/tenants'

export type {
  MutableTenantField,
  MutableTenantFields,
  TenantMutationContext,
  TenantDetail,
  TenantSummary,
  TenantUserSummary,
  SchoolSummary,
  Paged,
  PaginationQuery,
  AuditEntrySummary,
  PlatformAuditPage,
} from '@/lib/queries/tenants'

// Platform operators
export {
  OPERATOR_PROFILE_SELECT,
  OPERATOR_CREDENTIAL_SELECT,
  findOperatorByIdentifier,
  readOperatorById,
  recordOperatorLogin,
  recordOperatorPasswordFailure,
} from '@/lib/queries/operators'

export type {
  OperatorCredentialRow,
} from '@/lib/queries/operators'

// School mutations
export {
  createSchoolInTenant,
  updateSchoolInTenant,
  deleteSchoolInTenant,
} from '@/lib/queries/schools'

// User mutations
export {
  updateUserInTenant,
  deactivateUserInTenant,
  reactivateUserInTenant,
} from '@/lib/queries/users'

export type {
  UpdateUserInTenantData,
} from '@/lib/queries/users'