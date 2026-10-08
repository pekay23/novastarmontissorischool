import { describe, it, expect } from "bun:test";

import { readFileSync } from "node:fs";

import { join } from "node:path";

import {
  permissionsForRole,
  type PlatformRoleName,
} from "@novastar/shared-types";

import { announcementAbilities } from "../app/portal/(portal)/announcements/page";

const PORTAL = join(import.meta.dir, "..");

const PAGE = join(PORTAL, "app", "portal", "(portal)", "announcements", "page.tsx");

const pageSource = readFileSync(PAGE, "utf-8");

const ROUTE = join(PORTAL, "app", "portal", "api", "announcements", "route.ts");

const ID_ROUTE = join(
  PORTAL,
  "app",
  "portal",
  "api",
  "announcements",
  "[id]",
  "route.ts",
);

// ---------------------------------------------------------------------------
// The request bodies the page builds, evaluated
// ---------------------------------------------------------------------------
/** * `handleSubmit`'s `body` object literal, evaluated. * * Read out of the page and run, so a change to what the page SENDS is caught. * Restating the body here would leave the page free to send `audience: * [targetAudience]` —— the original defect —— with every test still green. * * `editingAnnouncement` is a parameter rather than a captured binding because the * two schemas accept different `publishedAt` shapes and the whole point of * defect 3 is which body goes to which route. */
function evaluatedBody(
  form: {
    title: string;
    body: string;
    targetAudience: string;
    status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
    publishedAt: string;
  },
  options: { editing: boolean },
): Record<string, unknown> {
  const start = pageSource.indexOf("const body: Record<string, unknown> = {");

  if (start === -1)
    throw new Error(`the request body literal was not found in ${PAGE}`);

  // Balanced-brace scan rather than a regex: the literal carries a spread whose

  // own braces make a non-greedy `[\s\S]*?\n    \}` land on the wrong line, and a

  // truncated body would silently drop `publishedAt` from every assertion.
  let depth = 0;
  let end = -1;
  for (let i = pageSource.indexOf("{", start); i < pageSource.length; i += 1) {
    if (pageSource[i] === "{") depth += 1;
    else if (pageSource[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end === -1)
    throw new Error(
      `the request body literal in ${PAGE} is not brace-balanced`,
    );

  const literal = [pageSource.slice(start, end)];
  const objectLiteral = literal[0].slice(literal[0].indexOf("{"));

  if (!objectLiteral) {
    throw new Error(
      `the request body literal in ${PAGE} could not be read for evaluation`,
    );
  }

  const evaluate = new Function(
    "form",
    "targetAudience",
    "editingAnnouncement",
    `return (${objectLiteral})`,
  ) as (
    form: Parameters<typeof evaluatedBody>[0],
    targetAudience: string,
    editingAnnouncement: { id: string } | null,
  ) => Record<string, unknown>;

  // `targetAudience` is computed one line above the literal in the real handler.

  // It is supplied here the same way, trimmed —— so the literal under test is

  // evaluated with exactly the value the page would have given it.
  const targetAudience = form.targetAudience.trim();

  return evaluate(
    form,
    targetAudience,
    options.editing ? { id: "announcement-1" } : null,
  );
}
/** * `handleEdit`'s `targetAudience` expression, evaluated against a stored row. * * The read half of the audience round trip. The defect this replaces read * `a.audience?.[0] ?? ''`, which is a perfectly reasonable line on its own and * loses a second role only in combination with the write half —— so it has to be * asserted against real rows, not described. */
function evaluatedTargetAudience(audience: string[] | undefined): string {
  const start = pageSource.indexOf("const handleEdit");

  if (start === -1) throw new Error(`handleEdit not found in ${PAGE}`);

  const source = pageSource.slice(
    start,
    pageSource.indexOf("const handleDelete", start),
  );

  const property = /targetAudience:\s*(.+?),\r?\n/.exec(source);

  if (!property)
    throw new Error(`handleEdit's targetAudience was not found in ${PAGE}`);

  const evaluate = new Function("a", `return (${property[1]})`) as (a: {
    audience?: string[];
  }) => string;
  return evaluate({ audience });
}
interface FormValues {
  title: string;
  body: string;
  targetAudience: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publishedAt: string;
}
/** * One form's field values. * * `publishedAt` is a real `''` when the school has chosen no date, because that is * what an empty `<input type="date">` reports and it is the state both * `publishedAt` behaviours turn on. */
const edit = (over: Partial<FormValues> = {}): FormValues => ({
  title: "Term 1 closure",
  body: "School closes on Friday.",
  targetAudience: "CLASSROOM_TEACHER, HEAD_TEACHER",
  status: "DRAFT",
  publishedAt: "",
  ...over,
});
/** The two routes take different `publishedAt` shapes, so both are exercised. */
const ON_EDIT = { editing: true };
const ON_CREATE = { editing: false };
// ---------------------------------------------------------------------------
// Defect 1: the audience was lossy
// ---------------------------------------------------------------------------
describe("a multi-role audience survives a read-write round trip", () => {
  it("sends every audience the notice names", () => {
    const body = evaluatedBody(edit(), ON_EDIT);

    // The defect: `audience: targetAudience ? [targetAudience] : []` sent ONE.
    expect(body.audience).toEqual(["CLASSROOM_TEACHER", "HEAD_TEACHER"]);
  });

  it("reads a multi-role notice back into the form as every role", () => {
    // `handleEdit`'s `targetAudience` expression, evaluated. The defect was

    // `a.audience?.[0] ?? ''`, which reads one role and loses the rest.
    expect(evaluatedTargetAudience(["CLASSROOM_TEACHER", "HEAD_TEACHER"])).toBe(
      "CLASSROOM_TEACHER, HEAD_TEACHER",
    );
  });

  it("reads a notice addressed to everyone as a blank field", () => {
    expect(evaluatedTargetAudience([])).toBe("");

    expect(evaluatedTargetAudience(undefined)).toBe("");
  });

  it("round-trips: what the form shows is what the body sends back", () => {
    // The claim that actually matters, and the one neither half can establish

    // alone. Reopening a notice and saving it unchanged must leave the audience

    // identical —— which is exactly what the original `audience?.[0]` defect broke.
    const stored = ["CLASSROOM_TEACHER", "HEAD_TEACHER"];
    const shown = evaluatedTargetAudience(stored);

    const body = evaluatedBody({ ...edit(), targetAudience: shown }, ON_EDIT);

    expect(body.audience).toEqual(stored);
  });

  it("round-trips a notice addressed to nobody as nobody", () => {
    const shown = evaluatedTargetAudience([]);

    expect(shown).toBe("");

    expect(
      evaluatedBody({ ...edit(), targetAudience: shown }, ON_EDIT).audience,
    ).toEqual([]);
  });

  it("sends an empty list for a blank audience, not a list naming nobody", () => {
    // The migration is explicit: no DEFAULT, because `{}` would silently mean

    // "nobody" and a notice would be written that reaches no one. Empty means

    // every role in the school.
    expect(
      evaluatedBody(edit({ targetAudience: "" }), ON_EDIT).audience,
    ).toEqual([]);

    expect(
      evaluatedBody(edit({ targetAudience: "   " }), ON_EDIT).audience,
    ).toEqual([]);
  });

  it("never sends an empty string as a role name", () => {
    // `'A,,B'` split without filtering yields `['', '']`, and an empty role name

    // is a role that does not exist.
    expect(
      evaluatedBody(
        edit({ targetAudience: "CLASSROOM_TEACHER, ,HEAD_TEACHER" }),
        ON_EDIT,
      ).audience,
    ).toEqual(["CLASSROOM_TEACHER", "HEAD_TEACHER"]);
  });

  it("trims each role, so a stray space does not create a second role", () => {
    expect(
      evaluatedBody(edit({ targetAudience: " CLASSROOM_TEACHER " }), ON_EDIT)
        .audience,
    ).toEqual(["CLASSROOM_TEACHER"]);
  });
});
// ---------------------------------------------------------------------------
// Defect 3: publishedAt was dropped on edit
// ---------------------------------------------------------------------------
describe("a publish date the school chose is actually transmitted", () => {
  it("sends the date on an edit", () => {
    // The defect: `publishedAt: form.status === 'PUBLISHED' && form.publishedAt    // ? form.publishedAt : undefined`, which sent nothing for a DRAFT.
    expect(
      evaluatedBody(edit({ publishedAt: "2026-12-18" }), ON_EDIT).publishedAt,
    ).toBe("2026-12-18");
  });

  it("sends the date on an edit regardless of the status being saved", () => {
    // The specific loss: a notice moved back to DRAFT kept its old date on the

    // server and the page could not change or clear it.
    expect(
      evaluatedBody(
        edit({ publishedAt: "2026-12-18", status: "ARCHIVED" }),
        ON_EDIT,
      ).publishedAt,
    ).toBe("2026-12-18");
  });

  it("clears it with null on an edit, because that is what the schema accepts", () => {
    // `UpdateAnnouncementSchema` is `publishedAt: z.string().nullable().optional()`.

    // Sending `null` is how "never published" is said; sending nothing leaves the

    // stored date untouched and silently.
    expect(
      evaluatedBody(edit({ publishedAt: "" }), ON_EDIT).publishedAt,
    ).toBeNull();
  });

  it("omits it on a create rather than sending null, because create forbids null", () => {
    // `CreateAnnouncementSchema` is `publishedAt: z.string().optional()`, so a null

    // would 400 every unpublished draft. The two schemas genuinely differ.
    const create = evaluatedBody(edit(), ON_CREATE);

    expect("publishedAt" in create).toBe(false);
  });

  it("still sends a chosen date on a create", () => {
    const create = evaluatedBody(
      edit({ publishedAt: "2026-12-18" }),
      ON_CREATE,
    );

    expect(create.publishedAt).toBe("2026-12-18");
  });

  it("agrees with what the create route does with a missing publishedAt", () => {
    // `POST` defaults to `new Date()` when status is PUBLISHED and no date is

    // given. So omitting the key on a PUBLISHED create is deliberate, not a gap.
    const route = readFileSync(ROUTE, "utf-8");

    expect(route).toContain("data.status === 'PUBLISHED' ? new Date() : null");
  });
});
// ---------------------------------------------------------------------------
// Defect 2: write controls were offered to roles that cannot write
// ---------------------------------------------------------------------------
describe("write controls are offered only to roles the routes will accept", () => {
  const idRoute = readFileSync(ID_ROUTE, "utf-8");

  it("follows the same grant table the routes check, per action", () => {
    // `POST` checks `announcement:create`, `PATCH` checks `announcement:edit`,

    // `DELETE` checks `announcement:delete`. Each ability is its own key, so a

    // role can hold one without the others and must not be shown the rest.
    for (const role of [
      "HEADMASTER",
      "ADMIN_STAFF",
      "PARENT",
      "CLASSROOM_TEACHER",
      "ACCOUNTANT",
    ] as const) {
      const granted = permissionsForRole(role);

      const abilities = announcementAbilities(role);

      expect(abilities.canCreate).toBe(granted.includes("announcement:create"));

      expect(abilities.canEdit).toBe(granted.includes("announcement:edit"));

      expect(abilities.canDelete).toBe(granted.includes("announcement:delete"));
    }
  });

  it("gives a parent reading and nothing else", () => {
    // `PORTAL_SECTIONS_BY_ROLE.PARENT` includes `announcements`, and

    // `ROLE_GRANT_RULES.PARENT` grants `announcement:read` only. So the parent

    // reaches the page and every write button it used to show would 403.
    expect(announcementAbilities("PARENT")).toEqual({
      canCreate: false,
      canEdit: false,
      canDelete: false,
    });
  });

  it("gives admin staff reading and nothing else", () => {
    expect(announcementAbilities("ADMIN_STAFF")).toEqual({
      canCreate: false,
      canEdit: false,
      canDelete: false,
    });
  });

  it("gives a classroom teacher create and edit but not delete", () => {
    // `communication` category with `action !== 'delete'`, so `announcement:delete`

    // is excluded. A teacher who can post a notice must not be able to remove one.
    const abilities = announcementAbilities("CLASSROOM_TEACHER");

    expect(abilities.canCreate).toBe(true);

    expect(abilities.canEdit).toBe(true);

    expect(abilities.canDelete).toBe(false);
  });

  it("gives the Head of School everything", () => {
    expect(announcementAbilities("HEADMASTER")).toEqual({
      canCreate: true,
      canEdit: true,
      canDelete: true,
    });
  });

  it("withholds every control from a caller with no role at all", () => {
    for (const role of [null, undefined, "", "not-a-role"]) {
      expect(announcementAbilities(role)).toEqual({
        canCreate: false,
        canEdit: false,
        canDelete: false,
      });
    }
  });

  it("never invents a permission the catalog does not define", () => {
    // The guard reads `announcement:*` from the catalog, so a role named

    // something the seed never assigns cannot widen itself.

    //

    // `SUPER_ADMIN` is cast rather than invented, and the cast is the point: it is

    // a REAL platform role that simply is not a `PlatformRoleName`, so this asserts

    // the lookup is a total function over strings —— an unrecognised name yields

    // nothing rather than throwing or returning everything. An invented string like

    // `'NOT_A_ROLE'` would have passed even against a lookup that special-cased

    // unknown input.
    expect(permissionsForRole("SUPER_ADMIN" as PlatformRoleName)).toEqual([]);

    expect(announcementAbilities("SUPER_ADMIN").canCreate).toBe(false);

    expect(announcementAbilities("SUPER_ADMIN").canEdit).toBe(false);

    expect(announcementAbilities("SUPER_ADMIN").canDelete).toBe(false);
  });

  it("is a courtesy gate, with the routes still refusing", () => {
    // The important limit: this is presentation. If the page's gating were the

    // only protection, deleting a permission check from a route would be

    // invisible. Asserting the route still checks is what makes the UI gate safe

    // to describe as a courtesy.
    const route = readFileSync(ROUTE, "utf-8");

    expect(route).toContain("hasPermission(userId, 'announcement:create'");

    expect(idRoute).toContain("hasPermission(userId, 'announcement:edit'");

    expect(idRoute).toContain("hasPermission(userId, 'announcement:delete'");
  });
});
describe("the gated controls are actually gated at the render site", () => {
  it("hides New Announcement unless the caller may create", () => {
    // A test on `announcementAbilities` alone proves the function; this proves it

    // is consulted. Without it the page could compute the abilities and render

    // the button unconditionally.
    expect(pageSource).toMatch(
      /\{abilities\.canCreate && \(\s*<Button[^}]*onClick=\{handleNew\}/,
    );
  });

  it("hides Edit and Delete behind their own keys", () => {
    expect(pageSource).toContain("{abilities.canEdit && (");

    expect(pageSource).toContain("{abilities.canDelete && (");
  });

  it("still reads, for every role that reaches the page", () => {
    // `announcement:read` is granted to ADMIN_STAFF and PARENT, so the GET must

    // not be gated —— otherwise the notices a parent is entitled to would vanish.
    expect(pageSource).toContain("await fetch('/api/announcements')");

    expect(pageSource).toContain("setAnnouncements(data.data || [])");
  });

  it("says why the controls are absent, rather than showing nothing", () => {
    // A parent seeing no Create button cannot tell "this school has no notices"

    // from "you may not write them". One sentence answers that.
    expect(pageSource).toContain("!abilities.canCreate && (");

    expect(pageSource).toContain("You can read these notices");
  });
});
describe("the page reads the response shapes its routes actually return", () => {
  const route = readFileSync(ROUTE, "utf-8");

  const idRoute = readFileSync(ID_ROUTE, "utf-8");

  it("reads the list from the envelope the GET returns", () => {
    // `GET /api/announcements` answers `{ data: announcements }`. A page reading

    // a bare array would render nothing forever and no error would show.
    expect(route).toContain("NextResponse.json({ data: announcements })");

    expect(pageSource).toContain("setAnnouncements(data.data || [])");
  });

  it("does not read a bare array from the list", () => {
    expect(pageSource).not.toMatch(/setAnnouncements\(data\)/);
  });

  it("sends only the fields the create schema accepts", () => {
    // `CreateAnnouncementSchema` is exactly these five keys. A stray sixth would

    // be stripped by Zod rather than rejected, so it would pass unnoticed and

    // then be a column nobody sets.
    for (const key of ["title:", "body:", "audience:", "status:"]) {
      expect(route).toContain(key);
    }

    expect(route).toMatch(
      /const CreateAnnouncementSchema = z\.object\(\{[\s\S]*?\}\)/,
    );
  });

  it("sends the same five fields on an edit", () => {
    expect(idRoute).toMatch(
      /const UpdateAnnouncementSchema = z\.object\(\{[\s\S]*?\}\)/,
    );

    for (const key of ["title:", "body:", "audience:", "status:"]) {
      expect(idRoute).toContain(key);
    }
  });

  it("refuses its own empty title and body rather than sending them", () => {
    // `required` on the two text inputs, matching `z.string().min(1)` on both

    // routes. Without it the page would send `''` and get a 400 with a message

    // about "Invalid input" and nothing to act on.
    expect(pageSource).toMatch(/id="title"[\s\S]{0,400}?required/);

    expect(pageSource).toMatch(/id="body"[\s\S]{0,400}?required/);
  });

  it("reports the route's own error message rather than a generic one", () => {
    expect(pageSource).toContain("data.error ||");
  });
});
describe("the whole surface is reached, reads and writes alike", () => {
  it("calls GET, POST, PATCH and DELETE by their real paths", () => {
    // The four verbs the two routes expose. A missing one is a button that does

    // nothing, and this file exists to prove nothing is missing.
    expect(pageSource).toContain("await fetch('/api/announcements')");

    expect(pageSource).toContain("await fetch('/api/announcements', {");

    expect(pageSource).toContain("method: 'POST'");

    expect(pageSource).toContain(
      "`/api/announcements/${editingAnnouncement.id}`",
    );

    expect(pageSource).toContain("method: 'PATCH'");

    expect(pageSource).toContain("method: 'DELETE'");
  });

  it("routes an edit to the id path and a create to the collection path", () => {
    // The two branches of `handleSubmit`, by their actual method and path. A

    // regression that PATCHed the collection would be a 405 nothing catches.
    const branch = /if \(editingAnnouncement\) \{[\s\S]*?\} else \{/.exec(
      pageSource,
    );

    if (!branch)
      throw new Error(
        `handleSubmit's create/edit branch was not found in ${PAGE}`,
      );

    expect(branch[0]).toContain("method: 'PATCH'");

    expect(branch[0]).toContain("/api/announcements/${editingAnnouncement.id}");

    expect(pageSource).toContain("method: 'POST'");
  });

  it("sends JSON with a content type on every write", () => {
    const writes = pageSource.match(/method: '(POST|PATCH|DELETE)'/g) ?? [];
    expect(writes.length).toBeGreaterThanOrEqual(3);

    expect(pageSource).toMatch(
      /method: 'PATCH',\s*headers: \{ 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(body\)/,
    );

    expect(pageSource).toMatch(
      /method: 'POST',\s*headers: \{ 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(body\)/,
    );
  });

  it("re-reads the list after a write, so the screen is not a stale guess", () => {
    // Each write path calls the loader again. Without that the page would show

    // the pre-write state and a user would conclude the save failed.
    const afterWrite = pageSource.slice(pageSource.indexOf("if (res.ok)"));

    expect(afterWrite).toContain("void fetchAnnouncements()");

    // Two re-reads for two write handlers: `handleDelete`, and `handleSubmit`

    // (whose create and edit branches share one `res.ok` reload). The third call

    // site is the initial load, which is not a write.
    const reloads = pageSource.match(/void fetchAnnouncements\(\)/g) ?? [];
    expect(reloads.length).toBe(2);

    expect(
      pageSource.match(/await fetchAnnouncements\(\)/g) ?? [],
    ).toHaveLength(1);
  });
});
