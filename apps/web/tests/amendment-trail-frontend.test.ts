import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { permissionsForRole } from "@novastar/shared-types";
import {
  amendmentHistoryQuery,
  AMENDMENT_HISTORY_ENDPOINT,
  AMENDMENT_REASON_KEY,
  canAmendRecord,
  decodeValue,
  groupAmendments,
  isLockedRecord,
  isUsableReason,
  AMENDMENT_REASON_MAX_LENGTH,
  loadAmendmentGroups,
  historyReadMessage,
  lockColumnsOf,
  MISSING_REASON_MESSAGE,
  withAmendmentReason,
} from "../components/config/amendment";
import { AmendmentHistoryList } from "../components/config/amendment-history";
import { AmendmentReasonField } from "../components/config/amendment-reason-field";

/**
 * The amendment trail's frontend, proved by EXECUTION wherever the code can be
 * executed and by source evaluation where it cannot.
 *
 * This repo has no DOM or server-render harness for client components, so the
 * two established patterns are both used here and the difference is deliberate:
 *
 *   1. `amendment.ts` is plain logic with no React in it, so it is imported and
 *      run. Every assertion about the body, the lock test and the grouping is a
 *      real call, not a description of one.
 *   2. `AmendmentHistoryList` is a pure presentational component, so it is
 *      rendered with `renderToStaticMarkup` and the real markup is asserted on.
 *      Not a source grep for the word "Reason".
 *   3. The two places where the wiring cannot be executed —— `EntityForm`'s
 *      submit guard and `EntityList`'s PATCH body —— are read out of the source
 *      and EVALUATED, in the manner `syllabus-topics.test.ts` established. A
 *      copy of the expression would prove only that the copy works.
 *
 * THE HONESTY CONSTRAINT: a test that cannot fail on a regression is worse than
 * no test, because it reads as coverage. So every load-bearing assertion here is
 * accompanied by a mutation that kills it —— see the report for the transcripts.
 * In particular the reserved-key test kills on `AMENDMENT_REASON_KEY` being
 * renamed, which is exactly the change a backend contract fix would make.
 */
const PORTAL = join(import.meta.dir, "..");
const ENTITY_LIST = join(PORTAL, "components", "config", "entity-list.tsx");
const ENTITY_FORM = join(PORTAL, "components", "config", "entity-form.tsx");
const entityListSource = readFileSync(ENTITY_LIST, "utf-8");
const entityFormSource = readFileSync(ENTITY_FORM, "utf-8");

// ---------------------------------------------------------------------------
// The reserved key and the PATCH body
// ---------------------------------------------------------------------------
/**
 * `EntityList.handleFormSubmit`'s body, evaluated.
 *
 * Read out of the component and run, not restated. The claim under test is that
 * the reason reaches the PATCH body under the reserved key; a test that built its
 * own body object would pass unchanged if the component stopped sending the
 * reason at all, which is the regression that matters.
 *
 * `withAmendmentReason` and `isLockedRecord` are injected as the REAL imports
 * from `amendment.ts`, so the assertion is about the production pair, not a
 * reimplementation.
 */
function evaluatedPatchBody(options: {
  formData: Record<string, unknown>;
  target: Record<string, unknown> | null;
  amendmentReason: string;
}): Record<string, unknown> {
  const start = entityListSource.indexOf("const handleFormSubmit");
  if (start === -1)
    throw new Error(`handleFormSubmit not found in ${ENTITY_LIST}`);
  const source = entityListSource.slice(
    start,
    entityListSource.indexOf("\n  }", start),
  );
  // From `const body = ` up to the first `})` that closes the call at the end of a
  // line. Non-greedy on purpose: the object literal's own `}` is not the call's.
  const declaration =
    /const body = (withAmendmentReason\([\s\S]*?\n\s*\}\))/.exec(source);
  if (!declaration) {
    throw new Error(
      `handleFormSubmit in ${ENTITY_LIST} no longer builds its body through withAmendmentReason —— ` +
        "if the reserved key is being attached some other way, point this at that code.",
    );
  }
  const evaluate = new Function(
    "formData",
    "target",
    "amendmentReason",
    "withAmendmentReason",
    "isLockedRecord",
    `return (${declaration[1]})`,
    // The last two parameters are named `buildBody` and `isLocked` rather than
    // `withAmendmentReason` and `isLockedRecord`. Inside this parameter list the
    // production names would resolve to the parameters themselves, so
    // `typeof withAmendmentReason` would ask for the type of the declaration being
    // written —— TS2502. Parameter names do not affect assignability.
  ) as (
    formData: Record<string, unknown>,
    target: Record<string, unknown> | null,
    amendmentReason: string,
    buildBody: typeof withAmendmentReason,
    isLocked: typeof isLockedRecord,
  ) => Record<string, unknown>;
  return evaluate(
    options.formData,
    options.target,
    options.amendmentReason,
    withAmendmentReason,
    isLockedRecord,
  );
}
const LOCKED_ROW = {
  id: "student-1",
  admissionNumber: "NOVA26001",
  firstName: "Ama",
  lastName: "Serwaa",
  finalizedAt: "2026-10-01T09:00:00.000Z",
  finalizedById: "user-head",
};
describe("the amendment reason reaches the PATCH body", () => {
  it("puts the reason under the reserved key when the row is locked", () => {
    const body = evaluatedPatchBody({
      formData: { firstName: "Ama", lastName: "Serwaa" },
      target: LOCKED_ROW,
      amendmentReason: "Parent reported the phone was the previous owner",
    });
    expect(body[AMENDMENT_REASON_KEY]).toBe(
      "Parent reported the phone was the previous owner",
    );
    // The field edits travel in the SAME body, which is what lets the route mint
    // ONE groupId for the whole edit rather than one per field.
    expect(body.firstName).toBe("Ama");
    expect(body.lastName).toBe("Serwaa");
  });
  it("sends no reason at all for a row that is not locked", () => {
    const body = evaluatedPatchBody({
      formData: { firstName: "Ama" },
      target: { id: "student-2", firstName: "Ama" },
      amendmentReason: "",
    });
    // Not an empty string: the key must be ABSENT, or an unlocked edit acquires a
    // reason and the reason becomes the only record anybody thought about it.
    expect(AMENDMENT_REASON_KEY in body).toBe(false);
    expect(Object.keys(body)).toEqual(["firstName"]);
  });
  it("removes a reason that reached the body anyway on an unlocked row", () => {
    // Something upstream —— a stale form default, a retry —— handed the key over.
    // It must not survive, or an unamended edit could be recorded as amended.
    const body = evaluatedPatchBody({
      formData: {
        firstName: "Ama",
        [AMENDMENT_REASON_KEY]: "leaked from an earlier dialog",
      },
      target: { id: "student-2", firstName: "Ama" },
      amendmentReason: "typed for some other row",
    });
    expect(AMENDMENT_REASON_KEY in body).toBe(false);
  });
  it("reads lock state from the stored row, not from the submitted edits", () => {
    // The form's own values are the edit being requested. They cannot say whether
    // this row is locked —— and a client that let them would let anyone "unlock" a
    // row by submitting a blank `finalizedAt`.
    const body = evaluatedPatchBody({
      formData: { firstName: "Ama", finalizedAt: null },
      target: LOCKED_ROW,
      amendmentReason: "correction",
    });
    expect(body[AMENDMENT_REASON_KEY]).toBe("correction");
  });
  it("treats a locked row with no reason at all as carrying an empty one", () => {
    // `EntityForm` refuses before this point, so an empty reason should be
    // unreachable here. It is still asserted rather than left undefined: an
    // undefined key would be stripped by JSON.stringify and the route would see
    // no reason, which is the refusal the user was told had already happened.
    const body = evaluatedPatchBody({
      formData: { firstName: "Ama" },
      target: LOCKED_ROW,
      amendmentReason: "",
    });
    expect(body[AMENDMENT_REASON_KEY]).toBe("");
  });
});
describe("withAmendmentReason", () => {
  it("trims the reason, because the database CHECK trims it", () => {
    const body = withAmendmentReason(
      { a: 1 },
      { locked: true, reason: "  corrected  " },
    );
    expect(body[AMENDMENT_REASON_KEY]).toBe("corrected");
  });
  it("never mutates the caller's object", () => {
    const fields = { a: 1 };
    withAmendmentReason(fields, { locked: true, reason: "why" });
    expect(fields).toEqual({ a: 1 });
    expect(AMENDMENT_REASON_KEY in fields).toBe(false);
  });
  it("keeps the field edits exactly as given", () => {
    const body = withAmendmentReason(
      { name: "Basic 1A", capacity: 35, nested: { deep: true } },
      { locked: true, reason: "why" },
    );
    expect(body.name).toBe("Basic 1A");
    expect(body.capacity).toBe(35);
    expect(body.nested).toEqual({ deep: true });
  });
});
describe("a locked row is refused without a reason, before the save", () => {
  it("guards on the real lock test and the real emptiness test", () => {
    // The guard is read out of `EntityForm.handleSubmit` and evaluated, so this
    // fails if the guard is dropped, inverted, or weakened to a length check.
    const start = entityFormSource.indexOf("const handleSubmit");
    if (start === -1)
      throw new Error(`handleSubmit not found in ${ENTITY_FORM}`);
    const body = entityFormSource.slice(
      start,
      entityFormSource.indexOf("setIsSubmitting(true)", start),
    );
    // Two hazards in this one regex, both hit while writing it:
    //
    //   - `[^)]*` cannot be used: the condition itself contains a call, so the first
    //     `)` belongs to `isUsableReason(...)`.
    //   - A single lazy match from the start of the handler would capture
    //     `!schema` from the earlier `if (!schema) return` —— the lazy `[\s\S]*?`
    //     happily spans lines and keeps going until it finds a `setSubmitError`,
    //     which yields the syntax error "Unexpected keyword 'return'". Excluding
    //     `;`, `{` and `}` from the condition forbids spanning a statement, so each
    //     candidate is exactly one `if (...)` header.
    // Located by scanning backwards from the refusal rather than by a forward regex,
    // for a reason worth recording: every forward regex tried here either stopped
    // at the `)` of `isUsableReason(...)` (so the captured "condition" was a
    // fragment), or spanned statements and captured `!schema) return —— if (locked
    // && !isUsableReason(amendmentReason` (so the evaluated fragment was a syntax
    // error). Both produced a test that failed for the wrong reason. `if (` is the
    // nearest `if (` before the refusal, so the capture is exactly one header.
    const refusalAt = body.indexOf("setSubmitError(");
    const ifAt = refusalAt === -1 ? -1 : body.lastIndexOf("if (", refusalAt);
    if (ifAt === -1) {
      throw new Error(
        `handleSubmit in ${ENTITY_FORM} no longer refuses a locked row before saving —— ` +
          "a user would reach the server, be rejected there, and lose the reason they had not typed.",
      );
    }
    const header = body.slice(ifAt + "if (".length, refusalAt);
    const condition = header.slice(0, header.lastIndexOf(") {"));
    if (!/\)\s*\{\s*$/.test(header)) {
      throw new Error(
        `the refusal in ${ENTITY_FORM} is no longer a single-statement if-block the test can evaluate`,
      );
    }
    const messageName = /setSubmitError\(([A-Za-z_$][\w$]*)\)/.exec(
      body.slice(refusalAt),
    )?.[1];
    // Any condition at all is accepted here, so a guard changed to `false && ——`
    // or to `true` is EVALUATED and caught on the answer rather than by failing
    // to match. A regex pinned to the literal `locked && !isUsableReason(...)`
    // would have killed mutation M4 by not matching —— which is a weaker failure,
    // since a reader could not tell it apart from the extraction breaking.
    const evaluate = new Function(
      "locked",
      "amendmentReason",
      "isUsableReason",
      `return (${condition})`,
      // The type's parameter is named `checkUsableReason`, not
      // `isUsableReason`, on purpose. Inside a parameter list that name would
      // resolve to the parameter itself, so `typeof isUsableReason` would ask for
      // the type of the thing being declared —— TS2502. Parameter NAMES do not
      // affect assignability, so the cast still describes the same function.
    ) as (
      locked: boolean,
      amendmentReason: string,
      checkUsableReason: typeof isUsableReason,
    ) => boolean;
    const decides = (locked: boolean, amendmentReason: string) =>
      evaluate(locked, amendmentReason, isUsableReason);
    // Six states, not one. A guard that only refuses on `''` accepts `'   '` and
    // the server rejects it after the fact; one that ignores `locked` refuses
    // every edit in the school; one that is simply false lets every locked save
    // through unreasoned.
    expect(decides(true, "")).toBe(true);
    expect(decides(true, "   ")).toBe(true);
    expect(decides(true, "\n\t ")).toBe(true);
    expect(decides(true, "Parent reported the wrong number")).toBe(false);
    expect(decides(false, "")).toBe(false);
    expect(decides(false, "typed for some other row")).toBe(false);
    // And the refusal names the shared message, so the client refusal and the
    // database CHECK describe one rule rather than two that can drift.
    expect(messageName).toBe("MISSING_REASON_MESSAGE");
    expect(entityFormSource).toMatch(
      /import \{[^}]*MISSING_REASON_MESSAGE[^}]*\} from '\.\/amendment'/,
    );
  });
  it("mirrors the database CHECK: whitespace is not a reason", () => {
    // `btrim(reason) <> ''` is what the migration enforces, so a length check
    // would accept '   ' and the server would reject it after the fact.
    expect(isUsableReason("   ")).toBe(false);
    expect(isUsableReason("\n\t")).toBe(false);
    expect(isUsableReason("")).toBe(false);
    expect(isUsableReason(null)).toBe(false);
    expect(isUsableReason(undefined)).toBe(false);
    expect(isUsableReason("x")).toBe(true);
  });
  it("says what is missing and why it is required", () => {
    expect(MISSING_REASON_MESSAGE).toContain("reason is required");
    expect(MISSING_REASON_MESSAGE).toContain("locked");
  });
});

// ---------------------------------------------------------------------------
// Lock state
// ---------------------------------------------------------------------------
describe("isLockedRecord", () => {
  it("is true exactly when finalizedAt is present", () => {
    expect(isLockedRecord(LOCKED_ROW)).toBe(true);
    expect(isLockedRecord({ id: "x" })).toBe(false);
    expect(isLockedRecord({ id: "x", finalizedAt: null })).toBe(false);
  });
  it("ignores finalizedById alone", () => {
    // The migration gives `finalizedById` ON DELETE SET NULL, so a locked row
    // whose finaliser has been removed legitimately has no name. Treating that
    // as unlocked would drop the requirement on the record most likely disputed.
    expect(
      isLockedRecord({
        finalizedAt: "2026-10-01T00:00:00.000Z",
        finalizedById: null,
      }),
    ).toBe(true);
  });
  it("refuses non-objects rather than throwing", () => {
    for (const value of [null, undefined, 0, "", "locked", true, []]) {
      expect(isLockedRecord(value)).toBe(false);
    }
  });
  it("does not treat an absent column as an unlock", () => {
    // A route that selects a fixed column set omits the key entirely. An omitted
    // key means "this entity type has no lock", not "this row was unlocked".
    expect(isLockedRecord({ id: "grade-scale-1", name: "GES" })).toBe(false);
    expect(lockColumnsOf({ id: "grade-scale-1" })).toEqual({
      finalizedAt: null,
      finalizedById: null,
    });
  });
});
describe("canAmendRecord", () => {
  it("follows the same grant table the routes check", () => {
    for (const role of ["HEADMASTER", "ASSISTANT_HEAD"] as const) {
      expect(canAmendRecord(role)).toBe(
        permissionsForRole(role).includes("config:write"),
      );
    }
  });
  it("is false for a role with no config:write, and for no role at all", () => {
    expect(canAmendRecord("PARENT")).toBe(
      permissionsForRole("PARENT").includes("config:write"),
    );
    expect(canAmendRecord(null)).toBe(false);
    expect(canAmendRecord(undefined)).toBe(false);
    expect(canAmendRecord("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The prompt, as markup
// ---------------------------------------------------------------------------
/** The reason field as the form renders it, for one row. */
const renderReasonField = (
  initialData: Record<string, unknown> | null,
  readOnly = false,
): string =>
  renderToStaticMarkup(
    createElement(AmendmentReasonField, {
      recordId: "student-1",
      entityType: "student",
      recordName: "Student",
      initialData,
      readOnly,
      onReasonChange: () => {},
    }),
  );
describe("the prompt is discoverable before the user attempts a save", () => {
  it("renders nothing at all for a row that is not locked", () => {
    // A reason box on every row would train people to type into a field that
    // does not matter, and would make the locked case unremarkable.
    const html = renderReasonField({ id: "grade-scale-1", name: "GES" });
    expect(html).toBe("");
  });
  it("states the lock, and the fact that the row is still editable", () => {
    const html = renderReasonField(LOCKED_ROW);
    const text = html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
    expect(text).toContain("This record is locked");
    // The distinction the lock migration is explicit about: locked means not
    // SILENTLY editable. Saying only "locked" reads as immutable.
    expect(text).toContain("You can still correct it");
    expect(text).toContain("reason is recorded against each field you change");
  });
  it("names who locked it and when", () => {
    const html = renderReasonField(LOCKED_ROW);
    expect(html).toContain("user-head");
    // Rendered as a `<time>` carrying the machine-readable value, so the date is
    // not only ever a locale-formatted string. Matched case-insensitively because
    // React writes the prop as `dateTime` in the attribute itself.
    expect(html.toLowerCase()).toMatch(
      /<time datetime="2026-10-01t09:00:00\.000z"/,
    );
  });
  it("says a removed account is what removed it, rather than printing nothing", () => {
    const html = renderReasonField({ ...LOCKED_ROW, finalizedById: null });
    expect(html.replace(/<[^>]*>/g, "")).toContain(
      "account that has since been removed",
    );
  });
  it("presents a required, described, announced text box", () => {
    const html = renderReasonField(LOCKED_ROW);
    // The requirement must be reachable without a pointer and without a colour:
    // a real label, a real `required`, a real described-by.
    expect(html).toMatch(/<label for="amendment-reason-student-1"/);
    expect(html).toMatch(/aria-required="true"/);
    expect(html).toContain(
      'aria-describedby="amendment-reason-help-student-1"',
    );
    expect(html).toContain('id="amendment-reason-help-student-1"');
    expect(html).toContain("<textarea");
  });
  it("refuses visibly before anything is typed", () => {
    const html = renderReasonField(LOCKED_ROW);
    // An empty reason is refused, and the refusal is rendered as text rather than
    // left to a disabled button the user cannot understand.
    expect(html).toContain('role="alert"');
    expect(html.replace(/<[^>]*>/g, "")).toContain(MISSING_REASON_MESSAGE);
  });
  it("asks for no reason in view mode, and says why", () => {
    const html = renderReasonField(LOCKED_ROW, true);
    expect(html).not.toContain("<textarea");
    expect(html.replace(/<[^>]*>/g, "")).toContain(
      "required to change this record, not to view it",
    );
    // The lock is still stated: a reader should know the record is settled.
    expect(html).toContain("This record is locked");
  });
  it("offers the history, and links it to the record being viewed", () => {
    const html = renderReasonField(LOCKED_ROW);
    expect(html.replace(/<[^>]*>/g, "")).toContain("Amendment history");
  });
  it("offers no history for a row that does not exist yet", () => {
    // A create has no id, so there is no history to read and no button that
    // would 404.
    const html = renderToStaticMarkup(
      createElement(AmendmentReasonField, {
        recordId: null,
        entityType: "student",
        recordName: "Student",
        initialData: LOCKED_ROW,
        readOnly: false,
        onReasonChange: () => {},
      }),
    );
    expect(html).not.toContain("Amendment history");
  });
});

// ---------------------------------------------------------------------------
// The reserved key is one constant, and the render site uses the components
// ---------------------------------------------------------------------------
describe("the reserved key and the history path live in exactly one place", () => {
  it("is declared in amendment.ts and named nowhere else in the portal", () => {
    // Two spellings of the same wire key is two chances to send the wrong one. A
    // component that hardcoded 'amendmentReason' would survive this test and
    // still be wrong the day the contract changed.
    const hits = [
      "entity-list.tsx",
      "entity-form.tsx",
      "amendment-reason-field.tsx",
      "amendment-history.tsx",
    ].filter((file) =>
      readFileSync(
        join(PORTAL, "components", "config", file),
        "utf-8",
      ).includes("'amendmentReason'"),
    );
    expect(hits).toEqual([]);
  });
  it("is named by the constant the form and the list both use", () => {
    expect(AMENDMENT_REASON_KEY).toBe("amendmentReason");
  });
  it("builds the history query from the endpoint constant", () => {
    expect(AMENDMENT_HISTORY_ENDPOINT).toBe("/api/record-amendments");
    const query = amendmentHistoryQuery("student", "student-1");
    expect(query).toBe(
      "/api/record-amendments?entityType=student&entityId=student-1",
    );
  });
  it("escapes an id rather than concatenating it", () => {
    expect(amendmentHistoryQuery("student", "a b&entityId=other")).toContain(
      "a%20b%26entityId%3Dother",
    );
  });
  it("renders the reason field and the history from the form, not a private copy", () => {
    // The prompt must be in the form every config entity is edited through, or a
    // locked student edited elsewhere would never be asked for a reason.
    expect(entityFormSource).toContain("<AmendmentReasonField");
    expect(entityFormSource).toContain(
      "onReasonChange={onAmendmentReasonChange",
    );
    expect(entityFormSource).toContain("amendmentReason = ''");
    expect(entityListSource).toContain(
      "onAmendmentReasonChange={setAmendmentReason}",
    );
    // And the prop is threaded the whole way from the list's own state, so the
    // value the user typed is the value the body carries.
    expect(entityListSource).toContain(
      "const [amendmentReason, setAmendmentReason] = useState",
    );
    expect(entityListSource).toContain("amendmentReason={amendmentReason}");
    // Cleared on close, never on open: a reason belonging to the row just edited
    // would otherwise still be in the box for the next locked row, and would be
    // sent as THAT row's justification without anybody typing it.
    expect(entityListSource).toMatch(
      /const handleFormClose[\s\S]*?setAmendmentReason\(''\)/,
    );
  });
  it("says so in the form's own words", () => {
    expect(entityFormSource).toContain("isLockedRecord");
    expect(entityListSource).toContain("isLockedRecord");
    expect(entityListSource).toContain("withAmendmentReason");
  });
});

// ---------------------------------------------------------------------------
// The value envelope
// ---------------------------------------------------------------------------
describe("decodeValue reads the tagged envelope, never a bare value", () => {
  it("names each documented kind", () => {
    expect(decodeValue({ kind: "decimal", value: "72.50" })).toBe("72.50");
    expect(decodeValue({ kind: "string", value: "Ama Serwaa" })).toBe(
      "Ama Serwaa",
    );
    expect(decodeValue({ kind: "enum", value: "ACTIVE" })).toBe("ACTIVE");
    expect(decodeValue({ kind: "date", value: "2026-10-04" })).toBe(
      "2026-10-04",
    );
    expect(
      decodeValue({ kind: "datetime", value: "2026-10-04T00:00:00.000Z" }),
    ).toBe("2026-10-04T00:00:00.000Z");
    expect(decodeValue({ kind: "number", value: 35 })).toBe("35");
    expect(decodeValue({ kind: "bool", value: true })).toBe("Yes");
    expect(decodeValue({ kind: "bool", value: false })).toBe("No");
    expect(decodeValue({ kind: "null" })).toBe("(empty)");
  });
  it("keeps a decimal as its stored string, trailing zero and all", () => {
    // The migration is explicit that a decimal travels as a string precisely so
    // 72.50 does not print as 72.5. Coercing here would reintroduce the loss the
    // envelope exists to prevent.
    expect(decodeValue({ kind: "decimal", value: "72.50" })).toBe("72.50");
    expect(decodeValue({ kind: "decimal", value: "72.50" })).not.toBe("72.5");
  });
  it("distinguishes the three states a value can be in", () => {
    // SQL NULL oldValue is INSERT; an ABSENT key is "not part of this change";
    // {"kind":"null"} is a column that held NULL. Collapsing any two of these
    // makes a register correction unreadable.
    expect(decodeValue(null)).toContain("inserted");
    expect(decodeValue(undefined)).toContain("not part of this change");
    expect(decodeValue({ kind: "null" })).toBe("(empty)");
    const threeStates = new Set([
      decodeValue(null),
      decodeValue(undefined),
      decodeValue({ kind: "null" }),
    ]);
    expect(threeStates.size).toBe(3);
  });
  it("marks an unrecognised envelope instead of printing [object Object]", () => {
    // A wrong-looking value in an evidence trail is worse than a missing one: a
    // reader cannot tell it apart from a real value.
    const decoded = decodeValue({ kind: "decimal" });
    expect(decoded).toBe("(unrecognised value)");
    expect(decoded).not.toContain("[object");
  });
  it("never throws on anything a JSON payload can carry", () => {
    for (const value of [0, "", false, [], { value: "no kind" }, { kind: 7 }]) {
      expect(typeof decodeValue(value)).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------
const THREE_FIELD_CORRECTION = [
  {
    id: "a1",
    groupId: "group-1",
    field: "phone",
    oldValue: { kind: "string", value: "0244000000" },
    newValue: { kind: "string", value: "0551234567" },
    reason: "Parent reported on 4 Oct the number was the previous owner",
    userId: "user-head",
    operatorId: null,
    createdAt: "2026-10-04T10:00:00.000Z",
  },
  {
    id: "a2",
    groupId: "group-1",
    field: "email",
    oldValue: { kind: "null" },
    newValue: { kind: "string", value: "ama@novastar.edu.gh" },
    reason: "Parent reported on 4 Oct the number was the previous owner",
    userId: "user-head",
    operatorId: null,
    createdAt: "2026-10-04T10:00:00.001Z",
  },
  {
    id: "a3",
    groupId: "group-1",
    field: "address",
    oldValue: { kind: "string", value: "Osu" },
    newValue: { kind: "string", value: "East Legon" },
    reason: "Parent reported on 4 Oct the number was the previous owner",
    userId: "user-head",
    operatorId: null,
    createdAt: "2026-10-04T10:00:00.002Z",
  },
];
const EARLIER_EDIT = {
  id: "b1",
  groupId: "group-2",
  field: "firstName",
  oldValue: { kind: "string", value: "Amah" },
  newValue: { kind: "string", value: "Ama" },
  reason: "Spelling corrected against the birth certificate",
  userId: "user-clerk",
  operatorId: null,
  createdAt: "2026-09-01T08:00:00.000Z",
};
describe("a multi-field edit reads as ONE amendment", () => {
  it("folds three field rows into one group with one reason", () => {
    // The whole reason `groupId` exists for. Rendered flat, one decision would
    // read as three, each apparently carrying its own justification.
    const groups = groupAmendments(THREE_FIELD_CORRECTION);
    expect(groups).toHaveLength(1);
    expect(groups[0].fields).toHaveLength(3);
    expect(groups[0].reason).toBe(
      "Parent reported on 4 Oct the number was the previous owner",
    );
    expect(groups[0].actor).toBe("user-head");
  });
  it("reads one edit as one entry however many fields it touched", () => {
    expect(groupAmendments(THREE_FIELD_CORRECTION)).toHaveLength(
      groupAmendments(THREE_FIELD_CORRECTION.slice(0, 1)).length,
    );
  });
  it("orders groups newest first and fields in the order they changed", () => {
    const groups = groupAmendments([EARLIER_EDIT, ...THREE_FIELD_CORRECTION]);
    expect(groups.map((g) => g.groupId)).toEqual(["group-1", "group-2"]);
    expect(groups[0].fields.map((f) => f.field)).toEqual([
      "phone",
      "email",
      "address",
    ]);
    expect(groups[0].at).toBe("2026-10-04T10:00:00.002Z");
  });
  it("groups by the writer-minted id, not by reason text", () => {
    // Two independent edits can carry identical reasons. Grouping by the text
    // would merge them into one correction that never happened.
    const sameText: unknown[] = [
      { ...EARLIER_EDIT, groupId: "g1" },
      {
        ...EARLIER_EDIT,
        id: "b2",
        groupId: "g2",
        createdAt: "2026-09-02T08:00:00.000Z",
      },
    ];
    expect(groupAmendments(sameText)).toHaveLength(2);
  });
  it("returns nothing for an empty, missing or malformed payload", () => {
    for (const value of [[], null, undefined, {}, "nope", 42]) {
      expect(groupAmendments(value)).toEqual([]);
    }
  });
  it("names a platform operator as one, and a cross-tenant row as its own thing", () => {
    const byOperator = groupAmendments([
      { ...EARLIER_EDIT, userId: null, operatorId: "op-1" },
    ]);
    expect(byOperator[0].actor).toBe("op-1 (platform operator)");
    const byUser = groupAmendments([EARLIER_EDIT]);
    expect(byUser[0].actor).toBe("user-clerk");
  });
  it("refuses to smooth over a row naming two actors", () => {
    // The database CHECK makes that unrepresentable, so seeing it means the
    // trail is inconsistent. Reporting it is the honest answer; naming one of
    // the two would be a guess about who acted.
    const groups = groupAmendments([{ ...EARLIER_EDIT, operatorId: "op-1" }]);
    expect(groups[0].actor).toContain("two actors");
  });
  it("refuses to invent a reason that is not there", () => {
    for (const reason of ["", "   ", null, undefined]) {
      expect(groupAmendments([{ ...EARLIER_EDIT, reason }])[0].reason).toBe(
        "(no reason recorded)",
      );
    }
  });
  it("does not mutate the rows it was given", () => {
    const rows = [...THREE_FIELD_CORRECTION];
    const snapshot = JSON.stringify(rows);
    groupAmendments(rows);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// The history, as markup
// ---------------------------------------------------------------------------
const visibleTextOf = (html: string): string =>
  html
    .replace(/<span class="sr-only">.*?<\/span>/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
const renderHistory = (props: {
  groups: ReturnType<typeof groupAmendments>;
  loading?: boolean;
  error?: string | null;
  entityName?: string;
}): string =>
  renderToStaticMarkup(
    createElement(AmendmentHistoryList, {
      groups: props.groups,
      loading: props.loading ?? false,
      error: props.error ?? null,
      entityName: props.entityName ?? "Student",
    }),
  );
describe("the history says who changed what, when, and why", () => {
  it("renders one card per edit, not one per field", () => {
    const html = renderHistory({
      groups: groupAmendments(THREE_FIELD_CORRECTION),
    });
    const text = visibleTextOf(html);
    expect(text).toContain("3 field changes");
    expect(text).toContain(
      "Parent reported on 4 Oct the number was the previous owner",
    );
    expect(text).toContain("user-head");
    // The reason appears ONCE for the group, not once per field row.
    expect(text.split("Parent reported on 4 Oct").length - 1).toBe(1);
  });
  it("names each field with what it was and what it became", () => {
    const text = visibleTextOf(
      renderHistory({ groups: groupAmendments(THREE_FIELD_CORRECTION) }),
    );
    expect(text).toContain("phone");
    expect(text).toContain("0244000000");
    expect(text).toContain("0551234567");
    expect(text).toContain("(empty)");
    expect(text).toContain("ama@novastar.edu.gh");
  });
  it("renders the values as text, not as a title or an attribute", () => {
    // A value only reachable through a tooltip is invisible on a printout and to
    // a screen reader that is not hovering.
    const html = renderHistory({
      groups: groupAmendments(THREE_FIELD_CORRECTION),
    });
    const attributesGone = html.replace(/\s[a-zA-Z-]+="[^"]*"/g, "");
    expect(attributesGone).toContain("0551234567");
    expect(attributesGone).toContain("Parent reported on 4 Oct");
    expect(html).not.toContain("title=");
  });
  it("uses singular for a one-field edit", () => {
    expect(
      visibleTextOf(renderHistory({ groups: groupAmendments([EARLIER_EDIT]) })),
    ).toContain("1 field change");
  });
  it("labels the columns for a screen reader", () => {
    const html = renderHistory({ groups: groupAmendments([EARLIER_EDIT]) });
    expect(html).toContain('<th scope="col"');
    expect(html).toContain("Field");
    expect(html).toContain("Was");
    expect(html).toContain("Became");
  });
});
describe("an absent trail is not a clean history", () => {
  it("says nothing is RECORDED, not that nothing changed", () => {
    // The migration is explicit: the table is created empty and never
    // backfilled, so absence of a row is not evidence a value was never
    // corrected. Rendering "no changes" would overclaim.
    const text = visibleTextOf(renderHistory({ groups: [] }));
    // Stripped of markup AND entities, because the copy uses typographic quotes and
    // an em dash that React escapes into entities. Asserting the raw string would
    // make the test a hostage to the exact punctuation rather than the claim.
    expect(text).toContain("No recorded amendments");
    expect(text).toContain("never backfilled");
    expect(text).toContain("nothing recorded since then");
    // The claim it must NOT make: that nothing was ever changed. The trail starts
    // empty and is never backfilled, so "nothing was never changed" would be a
    // positive claim about a history that does not exist. The copy states the
    // negation explicitly, so this asserts the DENIAL survives the markup —— if the
    // disclaimer is dropped, these two fail with it.
    expect(text).not.toContain("No changes");
    expect(text).toMatch(/not “never changed”/);
  });
  it("does not present an unreachable history as an empty one", () => {
    // The failure mode this guards: a 404 read as "no amendments", which is a
    // positive statement that nothing was ever amended.
    const html = renderHistory({
      groups: [],
      error: "The amendment history endpoint is not implemented yet.",
    });
    const text = visibleTextOf(html);
    expect(text).toContain("Amendment history unavailable");
    expect(text).toContain("not implemented yet");
    expect(text).toContain("not a clean history");
    expect(text).not.toContain("No recorded amendments");
  });
  it("says which record it is reading, so two dialogs cannot be confused", () => {
    expect(
      visibleTextOf(renderHistory({ groups: [], entityName: "Parent" })),
    ).toContain("No recorded amendments for this parent");
  });
});
describe("loading is announced rather than shown as an empty list", () => {
  it("names the wait", () => {
    const text = visibleTextOf(renderHistory({ groups: [], loading: true }));
    expect(text).toContain("Loading amendment history");
    expect(text).not.toContain("No recorded amendments");
  });
});

// ---------------------------------------------------------------------------
// The reason the server will accept
// ---------------------------------------------------------------------------
describe("the reason the server will accept", () => {
  it("measures AFTER trimming, as the boundary does", () => {
    // The server trims before it measures, so the 1000-character reason that is
    // legal is 1000 characters of text with any amount of padding around it.
    // Measuring the raw string here would refuse a reason the route accepts.
    const limit = AMENDMENT_REASON_MAX_LENGTH;
    expect(isUsableReason(`  ${"x".repeat(limit)}  `)).toBe(true);
    expect(isUsableReason(`  ${"x".repeat(limit + 1)}  `)).toBe(false);
  });
  it("refuses a blank reason at any length, including all spaces", () => {
    expect(isUsableReason("")).toBe(false);
    expect(isUsableReason("   ")).toBe(false);
    expect(isUsableReason("\t\n  ")).toBe(false);
  });
  it("refuses anything that is not a string", () => {
    // The boundary says `amendmentReason must be a string`; sending a number
    // would otherwise be coerced by a template literal into a plausible-looking
    // reason nobody wrote.
    expect(isUsableReason(null)).toBe(false);
    expect(isUsableReason(undefined)).toBe(false);
    expect(isUsableReason(42 as unknown as string)).toBe(false);
  });
  it("agrees with the constant the route enforces", () => {
    // Two constants that must not drift: `lib/amendments.ts` is the server's and
    // this one is the client's, duplicated only because that module imports
    // `prisma` and cannot be pulled into a client bundle. If either moves, this
    // fails instead of the user meeting a 1000-character refusal for the first
    // time on a real amendment.
    const serverLib = readFileSync(
      join(PORTAL, "lib", "amendments.ts"),
      "utf-8",
    );
    const serverKey = /AMENDMENT_REASON_KEY = '([^']+)'/.exec(serverLib)?.[1];
    const serverMax = Number(
      /AMENDMENT_REASON_MAX_LENGTH = (\d+)/.exec(serverLib)?.[1],
    );
    expect(serverKey).toBe(AMENDMENT_REASON_KEY);
    expect(serverMax).toBe(AMENDMENT_REASON_MAX_LENGTH);
  });
  it("shows the count as the user types rather than refusing input silently", () => {
    // `maxLength` was tried and removed: the server trims before measuring, so a
    // hard cap refuses a reason the route would accept, and it discards typed text
    // without saying so.
    const reasonField = readFileSync(
      join(PORTAL, "components", "config", "amendment-reason-field.tsx"),
      "utf-8",
    );
    // Matched as the JSX attribute (`maxLength={`), not the bare word: the
    // component explains in a comment why the cap was removed, and a bare-word
    // search matched that explanation and failed on the very fix it describes.
    expect(reasonField).not.toMatch(/maxLength\s*=\s*\{/);
    expect(reasonField).toContain(
      "reason.trim().length}/{AMENDMENT_REASON_MAX_LENGTH}",
    );
  });
  it("shows the empty count beside the prompt, so the bound is visible up front", () => {
    const html = renderToStaticMarkup(
      createElement(AmendmentReasonField, {
        recordId: "student-1",
        entityType: "student",
        recordName: "Student",
        initialData: { finalizedAt: "2026-10-01T09:00:00.000Z" },
        readOnly: false,
        onReasonChange: () => {},
      }),
    );
    const text = visibleTextOf(html);
    expect(text).toContain("0/1000");
    expect(text).toContain("reason is required");
  });
  it("words the two empty-reason problems differently in the component", () => {
    // Checked against the source because the reason lives in `useState` inside the
    // component: `renderToStaticMarkup` cannot be handed a typed value, so a
    // render-based assertion would pass for both branches without exercising
    // either. The branch itself is pinned by `isUsableReason` above.
    const reasonField = readFileSync(
      join(PORTAL, "components", "config", "amendment-reason-field.tsx"),
      "utf-8",
    );
    expect(reasonField).toContain(
      "reason.trim().length > AMENDMENT_REASON_MAX_LENGTH",
    );
    expect(reasonField).toContain("Keep it to");
    expect(reasonField).toContain(": MISSING_REASON_MESSAGE");
  });
});

// ---------------------------------------------------------------------------
// The prompt is reachable at all
// ---------------------------------------------------------------------------
describe("the prompt is reachable at all", () => {
  /**
   * The failure this exists to prevent: a complete, tested prompt attached to a
   * form that no settings section renders, on records that are the only ones with
   * lock columns. Every other assertion in this file would still pass.
   *
   * SOURCE assertions, and labelled as such. The settings page is a client
   * component behind `useSession`, and the portal has no DOM harness, so the chain
   * from a declared section to a rendered `EntityList` is checked by reading the
   * page rather than by executing it. The link it relies on is the ordinary
   * `section.entities?.map(...)` the page has always used, asserted below.
   */
  const settingsSource = readFileSync(
    join(PORTAL, "app", "(portal)", "settings", "page.tsx"),
    "utf-8",
  );
  /** The entity names every settings section declares, in declaration order. */
  function sectionEntities(): string[] {
    return [
      ...settingsSource.matchAll(/entities: \[([^\]]*)\] as EntityType\[\]/g),
    ].flatMap((match) =>
      match[1].split(",").map((name) => name.trim().replace(/^'|'$/g, "")),
    );
  }
  it("declares every lockable registry entity a section can reach", () => {
    // `Student.finalizedAt` and `Parent.finalizedAt` are the only lock columns the
    // migration adds to entities the config registry manages. `AttendanceStudent`
    // and `AttendanceStaff` also have them but have no registry entry, so they
    // cannot be reached through this form at all.
    expect(sectionEntities()).toContain("student");
    expect(sectionEntities()).toContain("parent");
  });
  it("renders each declared entity through the shared form", () => {
    // The brief was explicit: extend the existing form rather than build a parallel
    // one. A dedicated edit screen would leave two editors for the register, and
    // could quietly omit the prompt from one of them.
    expect(settingsSource).toMatch(
      /section\.entities\?\.map\([\s\S]{0,120}<EntityList/,
    );
    expect(settingsSource).toMatch(/<EntityList[^>]*entityType=\{entityType\}/);
  });
  it("locks on the same column the route locks on", () => {
    // The reason the section matters: without a `student`/`parent` list there is
    // no row whose `finalizedAt` the prompt could ever see.
    const lockMigration = readFileSync(
      join(
        PORTAL,
        "..",
        "..",
        "packages",
        "database",
        "prisma",
        "migrations",
        "20261004170500_amendment_lock_columns",
        "migration.sql",
      ),
      "utf-8",
    );
    expect(lockMigration).toContain(
      'ALTER TABLE "Student" ADD COLUMN "finalizedAt"',
    );
    expect(lockMigration).toContain(
      'ALTER TABLE "Parent" ADD COLUMN "finalizedAt"',
    );
  });
});

// ---------------------------------------------------------------------------
// The read itself
// ---------------------------------------------------------------------------
/**
 * A transport that records what it was asked for and replays a canned response.
 *
 * Deliberately a real callable rather than a `vi.fn`: the point is to observe the
 * URL the component would have requested, so the stub must be handed the string
 * and the test must read it back.
 */
function stubTransport(
  respond: { ok: boolean; status: number; body?: unknown } | Error,
): { transport: (endpoint: string) => Promise<never>; asked: string[] } {
  const asked: string[] = [];
  const transport = async (endpoint: string) => {
    asked.push(endpoint);
    if (respond instanceof Error) throw respond;
    return {
      ok: respond.ok,
      status: respond.status,
      json: async () => respond.body,
    } as never;
  };
  return { transport, asked };
}
const THREE_FIELD_EDIT = {
  data: [
    {
      groupId: "g1",
      field: "firstName",
      oldValue: null,
      newValue: { kind: "string", value: "Adwoa" },
      reason: "Corrected the name on the admission form",
      userId: "u-1",
      createdAt: "2026-10-04T10:00:00.000Z",
    },
    {
      groupId: "g1",
      field: "lastName",
      oldValue: { kind: "string", value: "Mensah" },
      newValue: { kind: "string", value: "Owusu" },
      reason: "Corrected the name on the admission form",
      userId: "u-1",
      createdAt: "2026-10-04T10:00:05.000Z",
    },
    {
      groupId: "g1",
      field: "className",
      oldValue: { kind: "string", value: "Year 1A" },
      newValue: { kind: "string", value: "Year 2B" },
      reason: "Corrected the name on the admission form",
      userId: "u-1",
      createdAt: "2026-10-04T10:00:09.000Z",
    },
  ],
};
describe("the history is read from the endpoint the record selects", () => {
  it("asks for exactly the record it was given, and nothing else", async () => {
    const { transport, asked } = stubTransport({
      ok: true,
      status: 200,
      body: { data: [] },
    });
    await loadAmendmentGroups(
      amendmentHistoryQuery("parent", "rec-42"),
      transport,
    );
    expect(asked).toEqual([
      "/api/record-amendments?entityType=parent&entityId=rec-42",
    ]);
  });
  it("escapes a registry key or id that would otherwise change the query", async () => {
    const { transport, asked } = stubTransport({
      ok: true,
      status: 200,
      body: { data: [] },
    });
    await loadAmendmentGroups(
      amendmentHistoryQuery("a&b=c", "id/../x"),
      transport,
    );
    // A raw interpolation here would let a value from the row silently add or
    // replace a parameter, which for an evidence trail means fetching the wrong
    // record's history and showing it as this record's.
    expect(asked[0]).toBe(
      "/api/record-amendments?entityType=a%26b%3Dc&entityId=id%2F..%2Fx",
    );
  });
  it("groups the rows it receives, so the read and the display cannot disagree", async () => {
    const { transport } = stubTransport({
      ok: true,
      status: 200,
      body: THREE_FIELD_EDIT,
    });
    const read = await loadAmendmentGroups("/api/record-amendments", transport);
    if (read.status !== "ok")
      throw new Error(`expected an ok read, got ${read.status}`);
    expect(read.groups).toHaveLength(1);
    expect(read.groups[0].reason).toBe(
      "Corrected the name on the admission form",
    );
    expect(read.groups[0].fields.map((field) => field.field)).toEqual([
      "firstName",
      "lastName",
      "className",
    ]);
    expect(read.groups[0].fields.map((field) => field.before)).toEqual([
      "(inserted — no previous value)",
      "Mensah",
      "Year 1A",
    ]);
  });
  it("reports a route that does not exist as missing, not as a failed read", async () => {
    const { transport } = stubTransport({ ok: false, status: 404 });
    const read = await loadAmendmentGroups("/api/record-amendments", transport);
    // The distinction is load-bearing: "not built" and "the server broke" call for
    // different responses, and neither may read as "nothing was ever amended".
    expect(read.status).toBe("not-implemented");
    expect(historyReadMessage(read)).toContain("not implemented yet");
  });
  it("reports a server error with the status, so the failure is diagnosable", async () => {
    const { transport } = stubTransport({ ok: false, status: 503 });
    const read = await loadAmendmentGroups("/api/record-amendments", transport);
    expect(read.status).toBe("failed");
    expect(historyReadMessage(read)).toBe(
      "Could not load amendment history (503).",
    );
  });
  it("reports an unreachable server rather than throwing at the render", async () => {
    const { transport } = stubTransport(new Error("ECONNREFUSED"));
    const read = await loadAmendmentGroups("/api/record-amendments", transport);
    expect(read.status).toBe("failed");
    expect(historyReadMessage(read)).toContain("Could not reach the server");
  });
  it("reads a body with no data key as an empty trail, not as a crash", async () => {
    const { transport } = stubTransport({ ok: true, status: 200, body: {} });
    const read = await loadAmendmentGroups("/api/record-amendments", transport);
    if (read.status !== "ok")
      throw new Error(`expected an ok read, got ${read.status}`);
    expect(read.groups).toEqual([]);
  });
  it("has no error to word for a successful read", () => {
    expect(historyReadMessage({ status: "ok", groups: [] })).toBeNull();
  });
});
describe("the dialog reads when it opens", () => {
  const historySource = readFileSync(
    join(PORTAL, "components", "config", "amendment-history.tsx"),
    "utf-8",
  );
  it("calls the read from an effect gated on being open", () => {
    // A SOURCE assertion, and labelled as such. `renderToStaticMarkup` does not
    // run effects and the portal has no DOM harness, so executing this is not
    // available. It is still worth pinning: mutation 14 deleted exactly this call
    // and nothing else in the file noticed.
    const effect = /useEffect\(\(\) => \{[\s\S]*?\n  \}, \[open, load\]\)/.exec(
      historySource,
    );
    expect(effect).not.toBeNull();
    const body = effect?.[0] ?? "";
    expect(body).toContain("if (!open) return");
    expect(body).toContain("await load()");
  });
  it("holds no branch of the response of its own, so the read and the words cannot drift", () => {
    // The classification lives in `amendment.ts`, where it is executed above.
    // A second copy in the component would be untested code that can disagree
    // with the tested one.
    expect(historySource).not.toContain("res.status === 404");
    expect(historySource).not.toContain("await fetch(");
    expect(historySource).toContain("loadAmendmentGroups(endpoint)");
  });
});
