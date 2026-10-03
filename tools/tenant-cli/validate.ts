/**
 * Input validation for `tools/tenant-cli`.
 *
 * Every value that reaches the database passes through here first. `Tenant.code`
 * is a permanent routing key and `School.code` is part of a compound unique, so
 * a bad value is not a transient failure that a retry fixes -- it is a row
 * nobody can create and a subdomain nobody can serve. Validating in the CLI
 * turns that into a message naming the field instead of a driver error.
 *
 * Pure: no `process`, no `console`, no filesystem, no database. Importable from
 * `provision.ts` and from tests without any setup.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Failure type
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class ValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(
      issues.length === 1 && issues[0].path === ""
        ? issues[0].message
        : issues.map((i) => `${i.path}: ${i.message}`).join("; "),
    );
    this.name = "ValidationError";
    this.issues = issues;
  }

  /** Normalises any thrown value into a `ValidationError`. */
  static from(error: unknown, prefix = ""): ValidationError {
    if (error instanceof ValidationError) return error;
    if (error instanceof z.ZodError) {
      return new ValidationError(
        error.issues.map((issue) => ({
          path: [prefix, ...issue.path.map(String)].filter((part) => part.length > 0).join("."),
          message: issue.message,
        })),
      );
    }
    return new ValidationError([
      { path: prefix, message: error instanceof Error ? error.message : String(error) },
    ]);
  }
}

function fail(path: string, message: string): never {
  throw new ValidationError([{ path, message }]);
}

export function formatIssues(issues: readonly ValidationIssue[]): string {
  if (issues.length === 0) return "no issues";
  return issues.map((i) => (i.path === "" ? `  - ${i.message}` : `  - ${i.path}: ${i.message}`)).join("\n");
}

/** Normalises a Zod failure into `ValidationError` so callers have one error type. */
export function toValidationError(error: unknown, prefix = ""): ValidationError {
  if (error instanceof ValidationError) return error;
  if (error instanceof z.ZodError) {
    const issues: ValidationIssue[] = error.issues.map((i) => ({
      path: [prefix, ...i.path.map(String)].filter((s) => s.length > 0).join("."),
      message: i.message,
    }));
    return new ValidationError(issues);
  }
  return new ValidationError([{ path: prefix, message: error instanceof Error ? error.message : String(error) }]);
}

// ---------------------------------------------------------------------------
// code
// ---------------------------------------------------------------------------

/**
 * `Tenant.code` becomes a subdomain and a `@unique` column; `School.code` is the
 * second half of `@@unique([tenantId, code])`. Both therefore have to survive
 * being typed by a human in a terminal and being pasted into a hostname.
 *
 * Lowercase only, no leading or trailing hyphen, 1-63 characters. The length
 * ceiling keeps the value inside the 63-character DNS label limit.
 */
export const CODE_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export const CODE_RULE =
  "lowercase letters, digits and single hyphens only, starting and ending with a letter or digit (1-63 characters)";

export const codeSchema = z.string().regex(CODE_PATTERN, `Must be a valid code: ${CODE_RULE}.`);

export function validateCode(value: unknown, field = "code"): string {
  if (typeof value !== "string") fail(field, `Must be a string, received ${typeof value}.`);
  if (value.length === 0) fail(field, "Must not be empty.");
  const parsed = codeSchema.safeParse(value);
  if (!parsed.success) fail(field, `Must be a valid code: ${CODE_RULE}. Received "${value}".`);
  return value;
}

// ---------------------------------------------------------------------------
// domain
// ---------------------------------------------------------------------------

/**
 * `Tenant.domain` is a custom domain used for routing, so it is validated as a
 * hostname: no scheme, no path, no port, no userinfo, at least two labels. A
 * value like `https://school.example.com` is rejected rather than silently
 * trimmed, because a stored scheme makes every later hostname comparison wrong.
 */
const DOMAIN_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export const DOMAIN_RULE =
  "a bare hostname such as school.example.com -- lowercase letters, digits and hyphens, at least two labels, no scheme, path or port";

export function isValidDomain(value: string): boolean {
  const host = value.endsWith(".") ? value.slice(0, -1) : value;
  if (host.length === 0 || host.length > 253) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => DOMAIN_LABEL_PATTERN.test(label));
}

export const domainSchema = z.string().refine(isValidDomain, `Must be ${DOMAIN_RULE}.`);

export const optionalDomainSchema = domainSchema.nullish();

/** `undefined` and `null` mean "no custom domain"; anything else must be a hostname. */
export function validateDomain(value: unknown, field = "domain"): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") fail(field, `Must be a string or null, received ${typeof value}.`);
  const parsed = domainSchema.safeParse(value);
  if (!parsed.success) fail(field, `Must be ${DOMAIN_RULE}. Received "${value}".`);
  return value;
}

// ---------------------------------------------------------------------------
// email
// ---------------------------------------------------------------------------

export const emailSchema = z.email("Must be a valid email address.");

export function validateEmail(value: unknown, field = "email"): string {
  if (typeof value !== "string") fail(field, `Must be a string, received ${typeof value}.`);
  const parsed = emailSchema.safeParse(value);
  if (!parsed.success) fail(field, `Must be a valid email address. Received "${value}".`);
  return value;
}

// ---------------------------------------------------------------------------
// established
// ---------------------------------------------------------------------------

export const ESTABLISHED_RULE = "a calendar date no later than today";

/**
 * `School.established` has no default in the schema, so the CLI must supply one.
 * A date in the future is rejected: it is always a typo, and it silently becomes
 * real data that the portal then renders.
 */
export function parseEstablished(value: unknown, field = "established"): Date {
  // A number is deliberately not accepted: `new Date(12345)` is valid and means
  // 12.345 seconds after the epoch, which is never what a caller meant.
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : fail(field, `Must be a date string such as 2016-01-01, or a Date. Received ${typeof value}.`);

  if (Number.isNaN(date.getTime())) {
    fail(field, `Must be ${ESTABLISHED_RULE}. Received "${String(value)}", which is not a date.`);
  }
  if (date.getTime() > Date.now()) {
    fail(field, `Must be ${ESTABLISHED_RULE}. Received "${date.toISOString().slice(0, 10)}", which is in the future.`);
  }
  return date;
}

// ---------------------------------------------------------------------------
// settings (the Json columns on Tenant and School)
// ---------------------------------------------------------------------------

/**
 * The shared settings bag written into `Tenant.settings` and `School.settings`.
 *
 * Strict on purpose. The configuration-first promise only holds if an unknown key
 * is refused rather than stored: a silently accepted `currancy` is a typo nobody
 * discovers until a school's fees render in the wrong currency. `config set`
 * re-validates the whole document after a dot-path write, so a bad write is
 * rejected before it reaches the column.
 */
export const SettingsSchema = z.strictObject({
  language: z.string().min(2).max(16).default("en"),
  currency: z.string().length(3, "Must be a three-letter ISO 4217 code.").default("GHS"),
  timezone: z.string().min(1).default("Africa/Accra"),
  dateFormat: z.enum(["iso", "dmy", "mdy"]).default("iso"),
  timeFormat: z.enum(["12h", "24h"]).default("24h"),
  features: z.record(z.string(), z.boolean()).default({}),
});

export type Settings = z.infer<typeof SettingsSchema>;

/** `Tenant.settings` and `School.settings` share one vocabulary; the aliases keep call sites readable. */
export const TenantSettingsSchema = SettingsSchema;
export const SchoolSettingsSchema = SettingsSchema;

export const SETTINGS_KEYS = Object.freeze(Object.keys(SettingsSchema.shape).sort());

export function parseSettings(value: unknown, field = "settings"): Settings {
  const parsed = SettingsSchema.safeParse(value ?? {});
  if (!parsed.success) throw toValidationError(parsed.error, field);
  return parsed.data;
}

/**
 * Validates supplied settings and returns them unchanged.
 *
 * The raw object is returned rather than the schema's output so provisioning
 * stores what the operator asked for, not a document padded with defaults.
 * `config set` re-validates after every write and is where a document gets
 * filled in.
 */
export function parseOptionalSettings(
  value: unknown,
  field = "settings",
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError([{ path: field, message: "Must be a JSON object." }]);
  }
  const parsed = SettingsSchema.safeParse(value);
  if (!parsed.success) throw toValidationError(parsed.error, field);
  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// dot-path read/write for `config set`
// ---------------------------------------------------------------------------

export function parseDotPath(path: string): string[] {
  const segments = path.split(".").filter((s) => s.length > 0);
  if (segments.length === 0) fail("key", "Must be a dot-path such as timezone or features.grading.");
  return segments;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns a new document with `path` set to `value`; the input is not mutated. */
export function setDotPath<T extends Record<string, unknown>>(document: T, path: string, value: unknown): T {
  const segments = parseDotPath(path);
  const root: Record<string, unknown> = { ...document };
  let cursor = root;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    cursor[segment] = isPlainObject(next) ? { ...next } : {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
  return root as T;
}

export function getDotPath(document: unknown, path: string): unknown {
  let cursor: unknown = document;
  for (const segment of parseDotPath(path)) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// Mutable Tenant / School columns (`commands/set.ts`)
// ---------------------------------------------------------------------------

/**
 * The mutable `Tenant` columns. `code` is absent on purpose: it is the routing
 * key and changing it would move a live tenant to a different subdomain, so it is
 * set once at creation and never patched.
 */
export const TenantPatchSchema = z.strictObject({
  name: z.string().min(1, "Must not be empty.").optional(),
  domain: optionalDomainSchema,
  isActive: z.boolean().optional(),
});

export const SchoolPatchSchema = z.strictObject({
  name: z.string().min(1, "Must not be empty.").optional(),
  address: z.string().min(1, "Must not be empty.").optional(),
  phone: z.string().min(1, "Must not be empty.").optional(),
  email: emailSchema.optional(),
  logoUrl: z.string().min(1).nullable().optional(),
  motto: z.string().nullable().optional(),
  established: z.date().optional(),
});

export function parsePatch<T extends z.ZodType>(schema: T, value: unknown, field: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw toValidationError(parsed.error, field);
  return parsed.data;
}