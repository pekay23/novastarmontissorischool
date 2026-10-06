/**
 * `provisionTenant` against an in-memory database.
 *
 * Two properties are load-bearing for `apps/super-admin` as well as the CLI:
 * re-running `create` must converge on one tenant, and a re-run must never reset
 * an administrator's password. Both are asserted against stored state, not
 * against call counts alone.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { FakeDatabase, installFakeDatabase } from "./support/fake-prisma";
import type { ProvisionInput } from "../provision";
import { PERMISSION_CATALOG, PLATFORM_ROLE_NAMES } from "@novastar/shared-types";

const fake = new FakeDatabase();
await installFakeDatabase(fake);

const { ADMIN_PASSWORD_ENV_VAR, MIN_ADMIN_PASSWORD_LENGTH, ProvisionInputError, provisionTenant } =
  await import("../provision");
const { assertAdminPassword, normalizeProvisionInput } = await import("../provision");

function baseInput(overrides: Partial<ProvisionInput> = {}): ProvisionInput {
  return {
    tenant: { name: "Another Montessori School", code: "another" },
    school: {
      name: "Another Montessori School",
      code: "main",
      address: "1 Test Road, Kumasi",
      phone: "+233 24 000 0000",
      email: "info@another.example.com",
      established: new Date("2020-01-01"),
    },
    ...overrides,
  };
}

beforeEach(() => {
  fake.reset();
});

describe("provisionTenant idempotency", () => {
  test("running create twice with the same code leaves exactly one tenant", async () => {
    const first = await provisionTenant(baseInput());
    expect(first.created).toBe(true);

    const second = await provisionTenant(baseInput());
    expect(second.created).toBe(false);

    expect(fake.countOf("tenant")).toBe(1);
    expect(fake.countOf("school")).toBe(1);
    expect(second.tenant.id).toBe(first.tenant.id);
    expect(second.school.id).toBe(first.school.id);
  });

  test("the tenant goes through the upsert path keyed on code, never through create", async () => {
    await provisionTenant(baseInput());
    await provisionTenant(baseInput());

    expect(fake.callsTo("tenant", "create")).toHaveLength(0);

    const upserts = fake.callsTo("tenant", "upsert");
    expect(upserts).toHaveLength(2);
    for (const call of upserts) {
      expect((call.args.where as Record<string, unknown>).code).toBe("another");
    }
  });

  test("the school is upserted on the compound tenantId_code key", async () => {
    await provisionTenant(baseInput());
    const upserts = fake.callsTo("school", "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].args.where).toEqual({
      tenantId_code: { tenantId: fake.rowsOf("tenant")[0].id, code: "main" },
    });
  });

  test("isActive is set explicitly on create and is not flipped on update", async () => {
    await provisionTenant(baseInput());
    expect((fake.callsTo("tenant", "upsert")[0].args.create as Record<string, unknown>).isActive).toBe(true);

    fake.resetCalls();
    await provisionTenant(baseInput());
    const update = fake.callsTo("tenant", "upsert")[0].args.update as Record<string, unknown>;
    expect(update).not.toHaveProperty("isActive");
  });

  test("a suspended tenant stays suspended across a re-provision", async () => {
    const first = await provisionTenant(baseInput());
    await provisionTenant(baseInput());
    const row = fake.rowsOf("tenant")[0];
    expect(row.isActive).toBe(true);
    expect(first.tenant.code).toBe("another");

// Simulate `suspend`, then re-provision.
fake.seed("tenant", { code: "another" }, { ...row, isActive: false });
await provisionTenant(baseInput());
expect(fake.rowsOf("tenant")[0].isActive).toBe(false);
  });

  test("base RBAC is written once, on the create path", async () => {
    const created = await provisionTenant(baseInput());

    // Assert the ROWS, not the counters. `seedPermissions` returns
    // `PERMISSION_CATALOG.length` and `seedPlatformRoles` returns
    // `PLATFORM_ROLE_NAMES.length` — both constants, not counts of anything
    // written — so `permissionsCreated > 0` held even when every
    // `tx.permission.upsert` was deleted, and so did `rolesCreated > 0` with every
    // `tx.role.upsert` deleted. A tenant provisioned with no permissions and no
    // roles at all passed this test.
    expect(fake.countOf("permission")).toBeGreaterThan(0);
    expect(fake.countOf("role")).toBeGreaterThan(0);
    expect(created.permissionsCreated).toBe(PERMISSION_CATALOG.length);
    expect(created.rolesCreated).toBe(PLATFORM_ROLE_NAMES.length);

    const beforePermissions = fake.countOf("permission");
    const beforeRoles = fake.countOf("role");
    const second = await provisionTenant(baseInput());
    expect(fake.countOf("permission")).toBe(beforePermissions);
    expect(fake.countOf("role")).toBe(beforeRoles);
    expect(second.permissionsCreated).toBe(0);
    expect(second.rolesCreated).toBe(0);
  });

  test("everything happens inside one transaction", async () => {
    expect(fake.transactions).toBe(0);
    await provisionTenant(baseInput());
    expect(fake.transactions).toBe(1);
    await provisionTenant(baseInput());
    expect(fake.transactions).toBe(2);
  });

  test("a rejected input opens no transaction at all", async () => {
    await expect(
      provisionTenant(baseInput({ tenant: { name: "A", code: "BAD CODE" } })),
    ).rejects.toBeInstanceOf(ProvisionInputError);
    expect(fake.transactions).toBe(0);
    expect(fake.countOf("tenant")).toBe(0);
  });
});

describe("provisionTenant administrator password", () => {
  // A password that clears the new composition floor (upper + lower + digit +
  // symbol) as well as the length minimum. The old examples in this block were
  // memorable but did not meet the rules, which is exactly why the rules exist.
  const COMPLEX = "Correct-Horse-Battery-1!"
  const withAdmin = (password: string = COMPLEX): ProvisionInput =>
    baseInput({ admin: { email: "head@another.example.com", password } });

  test("throws and names the environment variable when no password is supplied", async () => {
    expect.assertions(2);
    try {
      await provisionTenant(baseInput({ admin: { email: "head@another.example.com", password: "" } }));
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(ADMIN_PASSWORD_ENV_VAR);
    }
  });

  test("throws before opening a transaction, so nothing is written", async () => {
    await expect(
      provisionTenant(baseInput({ admin: { email: "head@another.example.com", password: "" } })),
    ).rejects.toThrow(ADMIN_PASSWORD_ENV_VAR);
    expect(fake.countOf("tenant")).toBe(0);
    expect(fake.countOf("user")).toBe(0);
  });

  test("rejects a password that is too short", () => {
    expect(() => assertAdminPassword({ email: "a@b.com", password: "short" })).toThrow(
      new RegExp(String(MIN_ADMIN_PASSWORD_LENGTH)),
    );
  });

  test("never defaults a password when the admin is omitted entirely", async () => {
    const result = await provisionTenant(baseInput());
    expect(result.admin).toBeNull();
    expect(fake.countOf("user")).toBe(0);
  });

  test("the hash is argon2id and not the plaintext", async () => {
    await provisionTenant(withAdmin());
    const row = fake.rowsOf("user")[0];
    expect(row.passwordHash).toBeString();
    expect(String(row.passwordHash)).not.toContain(COMPLEX);
    expect(String(row.passwordHash).startsWith("$argon2id$")).toBe(true);
  });

  test("sets the password on create and never on update", async () => {
    await provisionTenant(withAdmin());
    const firstHash = fake.rowsOf("user")[0].passwordHash;

    fake.resetCalls();
    await provisionTenant(withAdmin("Another-Complex-Password-2!"));

    const upsert = fake.callsTo("user", "upsert")[0];
    expect(upsert.args.update).toEqual({});
    expect(upsert.args.create).toHaveProperty("passwordHash");
    expect(fake.rowsOf("user")[0].passwordHash).toBe(firstHash);
  });

  test("reports whether the administrator already existed", async () => {
    const first = await provisionTenant(withAdmin());
    expect(first.admin?.created).toBe(true);
    const second = await provisionTenant(withAdmin());
    expect(second.admin?.created).toBe(false);
    expect(fake.countOf("user")).toBe(1);
  });
});

describe("normalizeProvisionInput", () => {
  test("collects every problem before anything is written", () => {
    expect.assertions(2);
    try {
      normalizeProvisionInput(
        baseInput({
          tenant: { name: "", code: "BAD CODE", domain: "https://nope.example.com" },
          school: {
            name: "S",
            code: "BAD",
            address: "",
            phone: "",
            email: "not-an-email",
            established: new Date("2999-01-01"),
          },
        }),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ProvisionInputError);
      const paths = (error as InstanceType<typeof ProvisionInputError>).issues.map((issue) => issue.path);
      expect(paths).toEqual(
        expect.arrayContaining([
          "tenant.code",
          "tenant.name",
          "tenant.domain",
          "school.code",
          "school.address",
          "school.phone",
          "school.email",
          "school.established",
        ]),
      );
    }
  });

  test("rejects an unknown settings key", () => {
    expect(() =>
      normalizeProvisionInput(baseInput({ tenant: { name: "A", code: "a", settings: { nope: 1 } } })),
    ).toThrow(ProvisionInputError);
  });

  test("keeps the supplied settings", () => {
    const input = baseInput({
      tenant: { name: "A", code: "a", settings: { currency: "USD" } },
    });
    expect(normalizeProvisionInput(input).settings).toEqual({ currency: "USD" });
  });

  test("leaves settings undefined when none were supplied, so no defaults are invented", () => {
    expect(normalizeProvisionInput(baseInput()).settings).toBeUndefined();
  });
});