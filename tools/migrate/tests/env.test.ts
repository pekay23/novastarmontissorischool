/**
 * Target resolution.
 *
 * Pure: every case passes an environment literal, so nothing here depends on
 * the developer's shell or on the repo root `.env` being present.
 */
import { describe, expect, test } from "bun:test";
import {
  MissingEnvError,
  hostOf,
  isLocalHost,
  redact,
  resolveDirect,
  resolveMirror,
  resolvePrimary,
  resolveTarget,
} from "../env";

const PG = "postgresql://user:secret@db.example.com:5432/novastar";

describe("resolvePrimary", () => {
  test("prefers DATABASE_URL, exactly as prisma.config.ts does", () => {
    const target = resolvePrimary({ DATABASE_URL: PG, DIRECT_URL: "postgresql://u:p@direct:5432/d" });
    expect(target.url).toBe(PG);
    expect(target.source).toBe("DATABASE_URL");
    expect(target.host).toBe("db.example.com");
  });

  test("falls back to DIRECT_URL and says where the value came from", () => {
    const target = resolvePrimary({ DIRECT_URL: "postgresql://u:p@direct.example.com:5432/d" });
    expect(target.host).toBe("direct.example.com");
    expect(target.source).toBe("DIRECT_URL (DATABASE_URL unset)");
  });

  test("throws and names the variable when both are absent", () => {
    expect(() => resolvePrimary({})).toThrow(MissingEnvError);
    try {
      resolvePrimary({});
      throw new Error("expected a throw");
    } catch (err) {
      expect((err as MissingEnvError).variable).toBe("DATABASE_URL (or DIRECT_URL)");
      expect((err as Error).message).toContain("DATABASE_URL");
    }
  });

  test("treats an empty string as absent rather than as a URL", () => {
    expect(() => resolvePrimary({ DATABASE_URL: "", DIRECT_URL: "  " })).toThrow(MissingEnvError);
  });

  test("refuses a non-postgres URL instead of guessing the protocol", () => {
    expect(() => resolvePrimary({ DATABASE_URL: "file:./dev.db" })).toThrow(
      /not a PostgreSQL URL/,
    );
  });
});

describe("resolveDirect", () => {
  test("prefers DIRECT_URL so DDL never lands on a pooler by accident", () => {
    const target = resolveDirect({
      DATABASE_URL: "postgresql://u:p@pooler:6543/d",
      DIRECT_URL: "postgresql://u:p@direct:5432/d",
    });
    expect(target.host).toBe("direct");
    expect(target.source).toBe("DIRECT_URL");
  });

  test("falls back to DATABASE_URL and records that it did", () => {
    const target = resolveDirect({ DATABASE_URL: PG });
    expect(target.source).toBe("DATABASE_URL (DIRECT_URL unset)");
  });
});

describe("resolveMirror", () => {
  test("is optional", () => {
    expect(resolveMirror({})).toBeUndefined();
  });

  test("names the variable when asked for explicitly and absent", () => {
    expect(() => resolveTarget("mirror", {})).toThrow(/SUPABASE_DATABASE_URL/);
  });
});

describe("isLocalHost", () => {
  test("accepts the loopback family", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "app.localhost",
      "127.0.0.1",
      "127.1.2.3",
      "::1",
      "[::1]",
      "0.0.0.0",
      "host.docker.internal",
    ]) {
      expect(isLocalHost(host)).toBe(true);
    }
  });

  test("rejects everything else, including things that look local", () => {
    for (const host of [
      "db.example.com",
      "ep-cool-name.us-east-2.aws.neon.tech",
      "localhost.evil.com",
      "127.0.0.1.evil.com",
      "1270.0.0.1",
      "",
      "192.168.1.10",
    ]) {
      expect(isLocalHost(host)).toBe(false);
    }
  });
});

describe("hostOf and redact", () => {
  test("never leaks a password", () => {
    expect(redact(PG)).toBe("postgresql://***@db.example.com:5432/novastar");
    expect(redact(PG)).not.toContain("secret");
  });

  test("reports an unparseable URL rather than throwing", () => {
    expect(hostOf("not a url")).toBe("<unparseable>");
  });
});
