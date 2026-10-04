/**
 * The privilege ceiling: who may mint an account holding which role.
 *
 * The property pinned throughout is that authority only runs downhill. A caller
 * may grant a role at or below their own standing and nothing above it, and every
 * way of being unable to answer the question -- an unranked role on either side
 * of the comparison, a blank name, a key borrowed from `Object.prototype` --
 * refuses instead of grants. The defect it prevents is the one the table was
 * written for: an `ADMIN_STAFF` account, which holds two student reads and one
 * communication read, minting a `HEADMASTER` and taking the school over.
 *
 * The ranks are read as a total order and compared, never asserted as literals,
 * so reordering the table into a more defensible arrangement does not break this
 * file while a hole in it does.
 */
import { describe, expect, test } from "bun:test";
import { PLATFORM_ROLE_NAMES, type PlatformRoleName } from "@novastar/shared-types";
import { ROLE_GRANT_RANK, mayGrantRole, parsePlatformRoleName, type GrantAuthority } from "../invite";

const rank = (name: PlatformRoleName): number => ROLE_GRANT_RANK[name];

/**
 * A school user identified only by their role, which is all the ceiling sees. The
 * parameter is widened past `GrantAuthority["roleName"]` because the cases worth
 * pinning are precisely the ones a type-correct caller cannot express.
 */
const school = (roleName: string | null | undefined): GrantAuthority => ({
  kind: "school-role",
  roleName: roleName ?? null,
});

const OPERATOR: GrantAuthority = { kind: "platform-operator" };

/** A role name outside the seeded vocabulary, forced past the compiler on purpose. */
const unranked = (name: string): PlatformRoleName => name as unknown as PlatformRoleName;

// ---------------------------------------------------------------------------

describe("ROLE_GRANT_RANK ranks every role the platform has", () => {
  test("a role with no rank is ungrantable, so its absence has to fail here rather than pass unnoticed", () => {
    // `invite.ts` also throws at module load for this. Asserting the invariant as
    // well means a role added to `PLATFORM_ROLE_NAMES` without a rank is caught by
    // whichever notice fires first, and that the ranks are usable as numbers: a
    // rank of zero is falsy and a rank written as a numeric string is coerced,
    // either of which quietly breaks the comparison the ceiling is made of.
    for (const name of PLATFORM_ROLE_NAMES) {
      expect(typeof ROLE_GRANT_RANK[name]).toBe("number");
      expect(Number.isInteger(ROLE_GRANT_RANK[name])).toBe(true);
      expect(ROLE_GRANT_RANK[name] > 0).toBe(true);
    }
  });

  test("two roles never share a rank, because a shared rank calls them interchangeable", () => {
    const ranks = PLATFORM_ROLE_NAMES.map(rank);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  test("the order follows the grant breadth the table is built from", () => {
    // HEADMASTER takes the whole catalog and ASSISTANT_HEAD everything outside
    // `system`; a head teacher holds the Head of School in full and a classroom
    // teacher less than that; ADMISSIONS_OFFICER's grant rule is a strict superset
    // of ADMIN_STAFF's; a parent is the narrowest set in the catalog.
    const above: ReadonlyArray<readonly [PlatformRoleName, PlatformRoleName]> = [
      ["HEADMASTER", "ASSISTANT_HEAD"],
      ["ASSISTANT_HEAD", "HEAD_TEACHER"],
      ["HEAD_TEACHER", "CLASSROOM_TEACHER"],
      ["CLASSROOM_TEACHER", "ACCOUNTANT"],
      ["ADMISSIONS_OFFICER", "ADMIN_STAFF"],
      ["ADMIN_STAFF", "PARENT"],
    ];
    for (const [higher, lower] of above) {
      expect({ pair: `${higher} above ${lower}`, holds: rank(higher) > rank(lower) }).toEqual({
        pair: `${higher} above ${lower}`,
        holds: true,
      });
    }
  });

  test("a parent is the floor: it stands below every other role", () => {
    for (const name of PLATFORM_ROLE_NAMES) {
      if (name === "PARENT") continue;
      expect(rank("PARENT") < rank(name)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

describe("parsePlatformRoleName is a narrowing, not a normalisation", () => {
  test("every seeded role resolves to itself, so a legitimate invite is never mistaken for a typo", () => {
    for (const name of PLATFORM_ROLE_NAMES) {
      expect(parsePlatformRoleName(name)).toBe(name);
    }
  });

  test("a blank or whitespace-only name is absent, not a value", () => {
    // These reach the ceiling as an unranked role and answer "unknown" rather than
    // ranking at one end or the other, so they grant nothing.
    for (const blank of ["", " ", "   ", "\t", "\n", "\r\n", null, undefined]) {
      expect(parsePlatformRoleName(blank)).toBeNull();
    }
  });

  test("a name that merely resembles a role is refused, not trimmed or case-folded into one", () => {
    // Padding or a lowercase spelling that reached the ceiling as a match would let
    // a role the seed never wrote be granted by naming it loosely.
    for (const near of [
      " HEADMASTER",
      "HEADMASTER ",
      "  HEADMASTER  ",
      "HEADMASTER\n",
      "headmaster",
      "Headmaster",
      "HEADMASTER_",
      "_HEADMASTER",
      "HEAD MASTER",
    ]) {
      expect(parsePlatformRoleName(near)).toBeNull();
    }
  });

  test("a key borrowed from Object.prototype is not a role", () => {
    // `parsePlatformRoleName` is an array search, so these are already refused.
    // The day it is rewritten as a lookup into the rank table -- the obvious
    // "simplification" -- every one of them becomes truthy and starts to grant.
    for (const inherited of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "__proto__",
    ]) {
      expect(parsePlatformRoleName(inherited)).toBeNull();
    }
  });

  test("a plausible name the seed never wrote is refused", () => {
    for (const invented of ["SUPERADMIN", "SUPER_ADMIN", "TEACHER", "HEAD_MASTER", "ADMIN"]) {
      expect(parsePlatformRoleName(invented)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------

describe("mayGrantRole answers with a ceiling that only runs downhill", () => {
  test("no school caller can mint a role that outranks them", () => {
    // The whole grid, one direction: every pair where the target outranks the
    // caller, including the ones nobody thought about.
    let checked = 0;
    for (const caller of PLATFORM_ROLE_NAMES) {
      for (const target of PLATFORM_ROLE_NAMES) {
        if (rank(target) <= rank(caller)) continue;
        checked += 1;
        expect({ caller, target, allowed: mayGrantRole(school(caller), target) }).toEqual({
          caller,
          target,
          allowed: false,
        });
      }
    }
    // Not a vacuous loop: with eight distinct ranks, exactly half of the ordered
    // pairs has the target above the caller, and none of them may be skipped.
    expect(checked).toBe((PLATFORM_ROLE_NAMES.length * (PLATFORM_ROLE_NAMES.length - 1)) / 2);
  });

  test("a caller can mint their own role, because standing is granted at or below", () => {
    // Equality has to be inside the ceiling. A `>` instead of a `>=` would break
    // this and leave nobody able to create a second account of their own kind.
    for (const name of PLATFORM_ROLE_NAMES) {
      expect(mayGrantRole(school(name), name)).toBe(true);
    }
  });

  test("an ADMIN_STAFF account cannot mint a HEADMASTER", () => {
    // The regression the ceiling exists for, named because it happened.
    expect(mayGrantRole(school("ADMIN_STAFF"), "HEADMASTER")).toBe(false);
    expect(mayGrantRole(school("ADMIN_STAFF"), "ASSISTANT_HEAD")).toBe(false);
    expect(mayGrantRole(school("ADMIN_STAFF"), "HEAD_TEACHER")).toBe(false);
    // ...and the roles it legitimately may create still work, so the refusals above
    // are a ceiling rather than a blanket ban.
    expect(mayGrantRole(school("ADMIN_STAFF"), "ADMIN_STAFF")).toBe(true);
    expect(mayGrantRole(school("ADMIN_STAFF"), "PARENT")).toBe(true);
  });

  test("a caller whose own role is not seeded grants nothing, not even the lowest role", () => {
    // `PARENT` is the floor, so each of these is refused purely because the caller
    // is unrecognised.
    for (const caller of ["", " ", "teacher", "SUPERADMIN", "__proto__", null, undefined]) {
      expect({ caller, allowed: mayGrantRole(school(caller), "PARENT") }).toEqual({ caller, allowed: false });
    }
  });

  test("a target that is not a seeded role is refused from every standing, including the highest", () => {
    // The comparison has to treat an absent rank as "no answer" -- not as zero, and
    // not as a number. `>=` does; the usual rewrites (`!(a < b)`, or defaulting an
    // absent rank to `0`) turn this into a grant for every caller at once.
    for (const target of ["SUPERADMIN", "", "__proto__", "HEADMASTER ", "constructor"]) {
      for (const caller of PLATFORM_ROLE_NAMES) {
        expect({ caller, target, allowed: mayGrantRole(school(caller), unranked(target)) }).toEqual({
          caller,
          target,
          allowed: false,
        });
      }
    }
  });

  test("raising a caller's standing never takes away a grant they already had", () => {
    let carried = 0;
    for (const target of PLATFORM_ROLE_NAMES) {
      for (const caller of PLATFORM_ROLE_NAMES) {
        if (!mayGrantRole(school(caller), target)) continue;
        for (const higher of PLATFORM_ROLE_NAMES) {
          if (rank(higher) <= rank(caller)) continue;
          carried += 1;
          expect({ higher, granting: caller, target, allowed: mayGrantRole(school(higher), target) }).toEqual({
            higher,
            granting: caller,
            target,
            allowed: true,
          });
        }
      }
    }
    expect(carried).toBeGreaterThan(0);
  });

  test("a platform operator is not bounded by the ceiling, so the ceiling is not the only guard", () => {
    // Deliberate, and worth pinning: the operator's authority over tenants is
    // total by construction, so a ceiling on a ceiling would only stop the console
    // from provisioning. What stops it acting outside a scoped tenant is each
    // caller's own verified context, never this table.
    for (const name of PLATFORM_ROLE_NAMES) {
      expect(mayGrantRole(OPERATOR, name)).toBe(true);
    }
    expect(mayGrantRole(OPERATOR, unranked("SUPERADMIN"))).toBe(true);
    // The school path refuses the same target, so these are two different answers
    // rather than one shared fallback.
    expect(mayGrantRole(school("HEADMASTER"), unranked("SUPERADMIN"))).toBe(false);
  });
});