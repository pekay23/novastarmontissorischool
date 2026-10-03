/**
 * Validation rules. Pure: no database, no environment, no filesystem.
 */
import { describe, expect, test } from "bun:test";
import {
  CODE_PATTERN,
  SETTINGS_KEYS,
  SettingsSchema,
  ValidationError,
  getDotPath,
  isValidDomain,
  parseDotPath,
  parseEstablished,
  parseSettings,
  setDotPath,
  validateCode,
  validateDomain,
  validateEmail,
} from "../validate";

describe("code", () => {
  test("accepts the codes a school would actually use", () => {
    for (const value of ["a", "ab", "novastar", "anotherschool", "st-annes-1", "x9", "9x"]) {
      expect(validateCode(value)).toBe(value);
    }
  });

  test("rejects a leading hyphen", () => {
    expect(() => validateCode("-school")).toThrow(ValidationError);
    expect(CODE_PATTERN.test("-school")).toBe(false);
  });

  test("rejects a trailing hyphen", () => {
    expect(() => validateCode("school-")).toThrow(ValidationError);
    expect(CODE_PATTERN.test("school-")).toBe(false);
  });

  test("rejects uppercase", () => {
    expect(() => validateCode("NoVaStAr")).toThrow(ValidationError);
    expect(() => validateCode("NOVASTAR")).toThrow(/valid code/i);
    expect(CODE_PATTERN.test("NoVaStAr")).toBe(false);
  });

  test("rejects the characters that would break a subdomain", () => {
    for (const value of ["bad code", "bad_code", "bad.code", "bad/code", "school!", ""]) {
      expect(() => validateCode(value)).toThrow(ValidationError);
    }
  });

  test("rejects anything longer than a DNS label", () => {
    expect(() => validateCode("a".repeat(64))).toThrow(ValidationError);
    expect(validateCode("a".repeat(63))).toHaveLength(63);
  });

  test("names the field in the failure", () => {
    try {
      validateCode("BAD", "--code");
      throw new Error("expected a ValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues[0].path).toBe("--code");
    }
  });
});

describe("domain", () => {
  test("accepts a bare hostname", () => {
    for (const value of ["school.example.com", "a-b.example.co.uk", "xn--bcher-kva.example.com"]) {
      expect(isValidDomain(value)).toBe(true);
      expect(validateDomain(value)).toBe(value);
    }
  });

  test("rejects a value carrying a scheme, path or port", () => {
    for (const value of [
      "https://school.example.com",
      "school.example.com/path",
      "school.example.com:8080",
      "user@school.example.com",
    ]) {
      expect(() => validateDomain(value)).toThrow(ValidationError);
    }
  });

  test("rejects malformed labels", () => {
    for (const value of ["school..example.com", "-school.example.com", "school-.example.com", "school example.com"]) {
      expect(() => validateDomain(value)).toThrow(ValidationError);
    }
  });

  test("treats null, undefined and empty as no custom domain", () => {
    expect(validateDomain(null)).toBeNull();
    expect(validateDomain(undefined)).toBeNull();
    expect(validateDomain("")).toBeNull();
  });

  test("requires at least two labels", () => {
    expect(() => validateDomain("localhost")).toThrow(ValidationError);
  });
});

describe("email", () => {
  test("accepts an ordinary address", () => {
    expect(validateEmail("info@novastarmontessori.com")).toBe("info@novastarmontessori.com");
  });

  test("rejects a value that is not an address", () => {
    for (const value of ["info", "info@", "@example.com", "info@example.com extra", ""]) {
      expect(() => validateEmail(value)).toThrow(ValidationError);
    }
  });
});

describe("established", () => {
  test("accepts a past date and a Date instance", () => {
    expect(parseEstablished("2016-01-01").toISOString().slice(0, 10)).toBe("2016-01-01");
    expect(parseEstablished(new Date("2016-01-01")).toISOString().slice(0, 10)).toBe("2016-01-01");
  });

  test("rejects a future date", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(() => parseEstablished(future)).toThrow(/future/i);
  });

  test("rejects a value that is not a date at all", () => {
    for (const value of ["not-a-date", "2016-13-45", "", 12345]) {
      expect(() => parseEstablished(value)).toThrow(ValidationError);
    }
  });
});

describe("settings", () => {
  test("the registry is stable", () => {
    expect(SETTINGS_KEYS).toEqual(["currency", "dateFormat", "features", "language", "timeFormat", "timezone"]);
  });

  test("fills defaults for an empty document", () => {
    expect(parseSettings({})).toEqual({
      language: "en",
      currency: "GHS",
      timezone: "Africa/Accra",
      dateFormat: "iso",
      timeFormat: "24h",
      features: {},
    });
  });

  test("rejects an unknown key instead of storing it", () => {
    expect(() => parseSettings({ currancy: "GHS" })).toThrow(ValidationError);
  });

  test("rejects a value that is wrong for its key", () => {
    expect(() => parseSettings({ currency: "GHANAINDIANPESOS" })).toThrow(ValidationError);
    expect(() => parseSettings({ features: { grading: "yes" } })).toThrow(ValidationError);
    expect(SettingsSchema.safeParse({ features: { grading: true } }).success).toBe(true);
  });

  test("accepts the document the seed writes", () => {
    expect(() =>
      parseSettings({ language: "en", currency: "GHS", timezone: "Africa/Accra" }),
    ).not.toThrow();
  });
});

describe("dot paths", () => {
  test("parses and rejects", () => {
    expect(parseDotPath("features.grading")).toEqual(["features", "grading"]);
    expect(() => parseDotPath("")).toThrow(ValidationError);
  });

  test("writes without mutating the original", () => {
    const before: Record<string, unknown> = { timezone: "Africa/Accra", features: { a: false } };
    const after = setDotPath(before, "features.b", true);
    expect(after).toEqual({ timezone: "Africa/Accra", features: { a: false, b: true } });
    expect(before).toEqual({ timezone: "Africa/Accra", features: { a: false } });
  });

  test("reads a nested value", () => {
    expect(getDotPath({ features: { a: true } }, "features.a")).toBe(true);
    expect(getDotPath({ features: {} }, "features.missing")).toBeUndefined();
  });

  test("a write through the path still validates against the registry", () => {
    const next = setDotPath(parseSettings({}), "currancy", "GHS");
    expect(() => parseSettings(next)).toThrow(ValidationError);
  });
});