/**
 * Scope resolution in `BaseService`. Everything else in this package is a
 * database query sitting behind one of these two calls, so the properties worth
 * pinning are the ones a broken guard would violate quietly rather than throw
 * on: a caller with no school is refused, and the scope handed back carries the
 * tenant and the school and nothing else. A `userId` or a `role` riding along in
 * that object would land in somebody's `where` clause and change which invoices
 * come back, with nothing failing anywhere.
 *
 * Both helpers are protected, so the subclass below is the access. It overrides
 * nothing and stands in for nothing: `schoolScope` and `tenantScope` read
 * `this.ctx` and no database, which is why this file runs without one.
 * `withTransaction` and `audit` do need a database and are not covered here.
 */
import { describe, expect, test } from "bun:test";
import { BaseService, type ServiceContext } from "../index";

/** Opens up the two protected scope helpers without altering their behaviour. */
class ScopeProbe extends BaseService {
  school(): { tenantId: string; schoolId: string } {
    return this.schoolScope();
  }

  tenant(): { tenantId: string } {
    return this.tenantScope();
  }
}

function probe(overrides: Partial<ServiceContext> = {}): ScopeProbe {
  return new ScopeProbe({
    tenantId: "tenant_novastar",
    schoolId: null,
    userId: "user_head",
    role: "HEADMASTER",
    ...overrides,
  });
}

/** The only wording an operator gets when their school assignment is missing. */
const REFUSAL = "No school assigned to user";

describe("schoolScope", () => {
  test("hands back the tenant and the school exactly as the caller supplied them", () => {
    // Mixed case and punctuation, so a normalisation -- a trim, a lowercase, a
    // re-derivation from the tenant code -- fails here rather than in production.
    const scope = probe({
      tenantId: "Tenant_NOVASTAR",
      schoolId: "School_Kumasi-01",
    }).school();

    expect(scope).toEqual({
      tenantId: "Tenant_NOVASTAR",
      schoolId: "School_Kumasi-01",
    });
  });

  test("refuses a caller with no school", () => {
    expect(() => probe({ schoolId: null }).school()).toThrow(REFUSAL);
  });

  test("an empty-string school is refused as well, because '' addresses no school", () => {
    // `audit` writes `schoolId: ''` for a caller with no school, so the empty
    // string is a value this codebase really does put in front of a school
    // column. Accepting it here would scope every school query to a school that
    // cannot exist, and return nothing at all rather than refuse.
    expect(() => probe({ schoolId: "" }).school()).toThrow(REFUSAL);
  });

  test("carries exactly two keys, so nothing else can reach the where clause", () => {
    // The context also holds userId and role. Returning the context itself --
    // `return this.ctx as ...` -- would silently add a filter on the acting user
    // to every school-scoped query in the package.
    const scope = probe({
      schoolId: "school_kumasi",
      userId: "user_head",
      role: "HEADMASTER",
    }).school();

    expect(Object.keys(scope).sort()).toEqual(["schoolId", "tenantId"]);
  });

  test("returns a fresh scope each call, so one caller cannot rewrite another's", () => {
    const service = probe({ schoolId: "school_kumasi" });

    const scope = service.school();
    scope.schoolId = "school_accra";

    // Same reason as the empty string: a scope is a value the caller holds, and
    // a shared one would make `schoolAccra = school.kumasi()` a real outcome.
    expect(service.school()).toEqual({
      tenantId: "tenant_novastar",
      schoolId: "school_kumasi",
    });
  });

  test("two schools in one tenant are scoped apart", () => {
    // The shape the invoice-number generator depends on: a tenant runs several
    // schools, and each school's queries have to name their own.
    const kumasi = probe({ schoolId: "school_kumasi" }).school();
    const accra = probe({ schoolId: "school_accra" }).school();

    expect(kumasi.tenantId).toBe(accra.tenantId);
    expect(kumasi.schoolId).not.toBe(accra.schoolId);
  });
});

describe("tenantScope", () => {
  test("tenant-level work runs without a school assigned", () => {
    // Grading scales and role definitions are tenant-wide. Routing this through
    // `schoolScope` would refuse the platform's own staff, who have no school.
    expect(probe({ schoolId: null }).tenant()).toEqual({ tenantId: "tenant_novastar" });
  });

  test("carries only the tenant, so a second school's rows stay visible", () => {
    // A school filter on a tenant-wide query hides the other school's rows and
    // returns an empty result rather than an error, which reads as "no data"
    // instead of "wrong scope".
    expect(Object.keys(probe({ schoolId: "school_kumasi" }).tenant())).toEqual([
      "tenantId",
    ]);
  });
});