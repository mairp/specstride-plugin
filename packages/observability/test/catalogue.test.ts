/**
 * T003 — CT-111-101: the catalogue of event types and the `data` schemas
 * (F111-FR-001, F111-FR-015).
 *
 * F111-FR-001 states four things that this file holds the catalogue to:
 *
 *   1. NAME FORM — a type name is lower-case, in dotted segments of
 *      lower-case letters, digits and underscores.
 *   2. A SCHEMA FOR EVERY TYPE — every type of the catalogue has a schema for
 *      its `data`, and the schema is the row: its properties are exactly the
 *      `data` fields of the row and nothing else.
 *   3. `x.` IS FREE — a type that starts with `x.` may be written although the
 *      catalogue does not hold it, and it has no schema here; a type that is
 *      neither of the catalogue nor `x.` may not be written.
 *   4. ADDITIVE CHANGE — adding a type inside a major is additive: a change
 *      that only adds types, `data` fields or free-text marks reports no
 *      finding, and a change that removes or redefines one does.
 *
 * Every check is a function of `src/catalogue/index.ts` over parsed rows, so
 * each gets a negative control: the check is shown to detect the violation it
 * exists to detect, and not only to pass over the data as it stands.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { isThirdPartyType as envelopeSaysThirdParty } from "@specstride/contracts/envelope/event";
import {
  CATALOGUE,
  CATALOGUE_BY_TYPE,
  CATALOGUE_COLUMNS,
  CATALOGUE_FILE,
  CATALOGUE_SIZE,
  CLOSED_SET_FIELDS,
  DATA_SCHEMAS,
  EVENT_TYPE_NAME_FORM,
  PAIRS,
  THIRD_PARTY_PREFIX,
  additiveChangeFindings,
  addedTypes,
  dataSchemaForType,
  dataSchemaOf,
  isCatalogueType,
  isThirdPartyType,
  nameIsWellFormed,
  parseCatalogue,
  typeIsWritable,
} from "../src/catalogue/index.ts";

/** A row of the catalogue, by type; the test fails where the type is absent. */
function entryOf(type: string) {
  const entry = CATALOGUE_BY_TYPE.get(type);
  assert.ok(entry !== undefined, `${type} is a type of the catalogue`);
  return entry;
}

/* ------------------------------------------------------------------ *
 * 1. The name form of a type (F111-FR-001).
 * ------------------------------------------------------------------ */

test("CT-111-101 name form: every type of the catalogue is a well-formed name", () => {
  assert.equal(CATALOGUE.length, CATALOGUE_SIZE);
  assert.ok(CATALOGUE_SIZE > 0, "the catalogue holds rows");
  for (const entry of CATALOGUE) {
    assert.equal(nameIsWellFormed(entry.type), true, `the name of ${entry.type}`);
    assert.match(entry.type, EVENT_TYPE_NAME_FORM, entry.type);
    assert.equal(entry.type, entry.type.toLowerCase(), `${entry.type} is lower-case`);
  }
});

test("CT-111-101 name form: the negative controls are refused", () => {
  // Upper case anywhere, an empty segment, a leading digit, a character that
  // is none of a lower-case letter, a digit, an underscore or the dot.
  for (const bad of [
    "Run.started",
    "run.Started",
    "run.STARTED",
    "run..started",
    ".run",
    "run.",
    "0run.started",
    "run.0started",
    "run.started-again",
    "run started",
    "run.started ",
    "",
  ]) {
    assert.equal(nameIsWellFormed(bad), false, `${JSON.stringify(bad)} is no well-formed name`);
  }
  // Underscores and digits inside a segment are allowed (`host.quota_observed`),
  // and one segment is a name (`blocked`, `alert`): the form is the name alone
  // and says nothing about whether the catalogue holds the type.
  for (const good of ["blocked", "alert", "x", "host.quota_observed", "run.started", "a.b2_c.d"]) {
    assert.equal(nameIsWellFormed(good), true, good);
    if (!isCatalogueType(good) && !isThirdPartyType(good)) {
      assert.equal(typeIsWritable(good), false, `${good} is well-formed and still not writable`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * 2. A schema for every type (F111-FR-001).
 * ------------------------------------------------------------------ */

test("CT-111-101 schemas: every type of the catalogue has a `data` schema", () => {
  assert.equal(DATA_SCHEMAS.size, CATALOGUE.length, "one schema per row, and no more");
  for (const entry of CATALOGUE) {
    const schema = dataSchemaForType(entry.type);
    assert.ok(schema !== undefined, `${entry.type} has a schema for its data`);
    assert.equal(schema.type, "object", `${entry.type}: data is a record`);
    assert.equal(schema.additionalProperties, false, `${entry.type}: no field beyond the row`);
    assert.deepEqual(
      Object.keys(schema.properties),
      [...entry.dataFields],
      `${entry.type}: the properties of the schema are the data fields of the row`,
    );
    // Absence is how a field that does not apply is written (F111-FR-002), so
    // no field is required; the closed field list is what the schema pins.
    assert.deepEqual(schema.required, [], `${entry.type}: no data field is required`);
    assert.equal(schema.$id, `specstride.event.data/1:${entry.type}`);
  }
});

test("CT-111-101 schemas: a schema is built from its row alone", () => {
  const made = dataSchemaOf({
    type: "x.made_up",
    kind: "instant",
    partner: "",
    dataFields: ["alpha", "beta"],
    freeTextFields: [{ field: "beta", ingressClass: "free-text" }],
  });
  assert.deepEqual(Object.keys(made.properties), ["alpha", "beta"]);
  // An unmarked field takes any value; a marked field is text, a list of text
  // or null, because the mark says the value is free text (F111-FR-016).
  assert.deepEqual(made.properties.alpha, {});
  assert.deepEqual(made.properties.beta, {
    type: ["string", "array", "null"],
    items: { type: "string" },
  });
});

test("CT-111-101 schemas: a closed-set field carries its members as an enum", () => {
  assert.ok(CLOSED_SET_FIELDS.length > 0, "the table of closed-set fields holds rows");
  for (const row of CLOSED_SET_FIELDS) {
    const entry = entryOf(row.type);
    assert.ok(
      entry.dataFields.includes(row.field),
      `${row.type}.${row.field} is a data field of the type`,
    );
    const members: string[] = [];
    for (const number of row.sets) {
      const set = closedSet(number);
      assert.ok(set !== undefined, `the closed set of row ${number} exists`);
      assert.ok(set.members.length > 0, `the closed set of row ${number} gives its members`);
      members.push(...set.members);
    }
    const property = dataSchemaForType(row.type)?.properties[row.field];
    assert.deepEqual(
      property,
      { enum: [...new Set(members)] },
      `${row.type}.${row.field} carries the members of its closed set`,
    );
  }
});

test("CT-111-101 schemas: the end causes and the outcomes of the closed sets land", () => {
  assert.deepEqual(dataSchemaForType("pass.ended")?.properties.endCause, {
    enum: [...(closedSet(271)?.members ?? [])],
  });
  assert.deepEqual(dataSchemaForType("attempt.ended")?.properties.endCause, {
    enum: [...(closedSet(272)?.members ?? [])],
  });
  assert.deepEqual(dataSchemaForType("phase.ended")?.properties.outcome, {
    enum: [...(closedSet(273)?.members ?? [])],
  });
  assert.deepEqual(dataSchemaForType("event.dropped")?.properties.reason, {
    enum: ["write-failed", "invalid", "too-large"],
  });
});

test("CT-111-101 F111-FR-015: the seven parallel types name group and worker in data", () => {
  const seven = [
    "parallel.plan",
    "parallel.admission",
    "parallel.group.started",
    "parallel.group.ended",
    "parallel.worker.started",
    "parallel.worker.ended",
    "parallel.integration",
  ];
  for (const type of seven) {
    const entry = entryOf(type);
    assert.ok(entry.dataFields.includes("groupId"), `${type} carries groupId in data`);
  }
  for (const type of ["parallel.worker.started", "parallel.worker.ended"]) {
    assert.ok(entryOf(type).dataFields.includes("workerId"), `${type} names the worker in data`);
  }
  assert.ok(entryOf("parallel.admission").dataFields.includes("taskId"));
  const integration = entryOf("parallel.integration");
  assert.ok(integration.dataFields.includes("step"));
  assert.ok(integration.dataFields.includes("pathCount"));
  // A count of paths and never a path: no field of the seven is marked as a
  // target, and none is named `path` or `paths`.
  for (const type of seven) {
    const entry = entryOf(type);
    assert.deepEqual([...entry.freeTextFields], [], `${type} marks no free-text field`);
    for (const field of entry.dataFields) {
      assert.ok(field !== "path" && field !== "paths", `${type}.${field}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * 3. `x.` is free (F111-FR-001).
 * ------------------------------------------------------------------ */

test("CT-111-101 `x.` free: an `x.` type may be written and has no schema here", () => {
  assert.equal(THIRD_PARTY_PREFIX, "x.");
  for (const type of ["x.audit", "x.vendor.thing", "x."]) {
    assert.equal(isThirdPartyType(type), true, type);
    // The reading of the prefix is feature 100's; this package agrees with it.
    assert.equal(envelopeSaysThirdParty(type), isThirdPartyType(type), type);
    assert.equal(isCatalogueType(type), false, `${type} is no type of the catalogue`);
    assert.equal(dataSchemaForType(type), undefined, `${type} has no schema in the catalogue`);
    assert.equal(typeIsWritable(type), true, `${type} may be written`);
  }
});

test("CT-111-101 `x.` free: a type that is neither of the catalogue nor `x.` is not writable", () => {
  for (const type of ["nope.absent", "run.invented", "y.audit", "xaudit", "X.audit", ""]) {
    assert.equal(isCatalogueType(type), false, type);
    assert.equal(isThirdPartyType(type), false, type);
    assert.equal(typeIsWritable(type), false, `${type} may not be written`);
  }
  for (const entry of CATALOGUE) {
    assert.equal(isCatalogueType(entry.type), true, entry.type);
    assert.equal(typeIsWritable(entry.type), true, entry.type);
  }
});

/* ------------------------------------------------------------------ *
 * 4. Adding a type inside a major is additive (F111-FR-001).
 * ------------------------------------------------------------------ */

test("CT-111-101 additive: the catalogue is an additive change of itself", () => {
  assert.deepEqual([...additiveChangeFindings(CATALOGUE, CATALOGUE)], []);
  assert.deepEqual([...addedTypes(CATALOGUE, CATALOGUE)], []);
});

test("CT-111-101 additive: adding a type, a data field or a mark is additive", () => {
  const added = {
    type: "x.later_type",
    kind: "instant" as const,
    partner: "",
    dataFields: ["alpha"],
    freeTextFields: [],
  };
  const after = [...CATALOGUE, added];
  assert.deepEqual([...additiveChangeFindings(CATALOGUE, after)], []);
  assert.deepEqual([...addedTypes(CATALOGUE, after)], ["x.later_type"]);

  // A `data` field added to a type that exists is additive.
  const widened = CATALOGUE.map((entry) =>
    entry.type === "alert" ? { ...entry, dataFields: [...entry.dataFields, "newField"] } : entry,
  );
  assert.deepEqual([...additiveChangeFindings(CATALOGUE, widened)], []);

  // A free-text mark added to a field that exists is additive.
  const marked = CATALOGUE.map((entry) =>
    entry.type === "alert"
      ? { ...entry, freeTextFields: [{ field: "kind", ingressClass: "free-text" }] }
      : entry,
  );
  assert.deepEqual([...additiveChangeFindings(CATALOGUE, marked)], []);
});

test("CT-111-101 additive: removing or redefining is NOT additive", () => {
  const without = CATALOGUE.filter((entry) => entry.type !== "alert");
  assert.deepEqual(
    [...additiveChangeFindings(CATALOGUE, without)],
    ["alert: the type was removed; a change inside a major is additive"],
  );

  const reKinded = CATALOGUE.map((entry) =>
    entry.type === "alert" ? { ...entry, kind: "open" as const, partner: "run.ended" } : entry,
  );
  assert.deepEqual(
    [...additiveChangeFindings(CATALOGUE, reKinded)],
    [
      "alert: the kind changed from instant to open",
      "alert: the partner changed from (none) to run.ended",
    ],
  );

  const shrunk = CATALOGUE.map((entry) =>
    entry.type === "alert"
      ? { ...entry, dataFields: entry.dataFields.filter((field) => field !== "level") }
      : entry,
  );
  assert.deepEqual(
    [...additiveChangeFindings(CATALOGUE, shrunk)],
    ["alert: the data field level was removed"],
  );

  const unmarked = CATALOGUE.map((entry) =>
    entry.type === "harness.error" ? { ...entry, freeTextFields: [] } : entry,
  );
  assert.deepEqual(
    [...additiveChangeFindings(CATALOGUE, unmarked)],
    ["harness.error: the free-text mark on message was removed"],
  );

  const reclassed = CATALOGUE.map((entry) =>
    entry.type === "harness.error"
      ? { ...entry, freeTextFields: [{ field: "message", ingressClass: "free-text" }] }
      : entry,
  );
  assert.deepEqual(
    [...additiveChangeFindings(CATALOGUE, reclassed)],
    ["harness.error: the ingress class of message changed from diagnostic to free-text"],
  );

  const renamed = CATALOGUE.map((entry) =>
    entry.type === "alert" ? { ...entry, type: "alert.renamed" } : entry,
  );
  assert.deepEqual(
    [...additiveChangeFindings(CATALOGUE, renamed)],
    ["alert: the type was removed; a change inside a major is additive"],
  );
  assert.deepEqual([...addedTypes(CATALOGUE, renamed)], ["alert.renamed"]);
});

test("CT-111-101 additive: a schema of an added type is built without a rebuild", () => {
  // US4: an author adds a type in a later minor. The schema is the row, so the
  // added row has a schema at once, and the schemas of the types that were
  // there do not change.
  const added = {
    type: "x.later_type",
    kind: "instant" as const,
    partner: "",
    dataFields: ["alpha", "detail"],
    freeTextFields: [{ field: "detail", ingressClass: "diagnostic" }],
  };
  assert.deepEqual(Object.keys(dataSchemaOf(added).properties), ["alpha", "detail"]);
  for (const entry of CATALOGUE) {
    assert.deepEqual(dataSchemaOf(entry), dataSchemaForType(entry.type));
  }
});

/* ------------------------------------------------------------------ *
 * The parse and the pairs.
 * ------------------------------------------------------------------ */

/**
 * A second reader of the same bytes, written differently on purpose: one regular
 * expression per line instead of a split, so that the rows `parseCatalogue`
 * returns are held against an oracle and not against themselves.
 */
function independentParse(text: string) {
  const row = /^([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)$/;
  const parts = (cell: string) => cell.split(",").filter((part) => part.trim().length > 0);
  return text
    .split("\n")
    .slice(1)
    .filter((line) => line.length > 0)
    .map((line) => {
      const matched = row.exec(line);
      assert.ok(matched !== null, `the row has five tab-separated cells: ${line}`);
      return {
        type: matched[1] ?? "",
        kind: matched[2] ?? "",
        partner: matched[3] ?? "",
        dataFields: parts(matched[4] ?? "").map((part) => part.trim()),
        freeTextFields: parts(matched[5] ?? "").map((mark) => {
          const [field, ingressClass] = mark.trim().split(":");
          return { field: field ?? "", ingressClass: ingressClass ?? "" };
        }),
      };
    });
}

test("CT-111-101: the rows the module returns are the rows the data holds", () => {
  const text = readFileSync(CATALOGUE_FILE, "utf8");
  assert.deepEqual(
    parseCatalogue(text).map((entry) => ({
      type: entry.type,
      kind: String(entry.kind),
      partner: entry.partner,
      dataFields: [...entry.dataFields],
      freeTextFields: entry.freeTextFields.map((mark) => ({ ...mark })),
    })),
    independentParse(text),
    "the reader of T004 and a reader written differently read the same rows",
  );
  assert.deepEqual(
    [...CATALOGUE_COLUMNS],
    ["type", "kind", "partner", "data_fields", "free_text_fields"],
  );
  // The header line of the data names those five columns, in that order.
  assert.equal(text.split("\n")[0], [...CATALOGUE_COLUMNS].join("\t"));
});

test("CT-111-101: a header that is not the five columns is refused", () => {
  assert.throws(
    () => parseCatalogue("type\tkind\n"),
    /the header of the catalogue/,
    "a wrong header is refused, not read",
  );
});

test("CT-111-101: every pair of the catalogue is an opener and its closer", () => {
  assert.ok(PAIRS.length > 0, "the catalogue holds pairs");
  for (const pair of PAIRS) {
    assert.equal(entryOf(pair.open).kind, "open");
    assert.equal(entryOf(pair.close).kind, "close");
    assert.equal(entryOf(pair.open).partner, pair.close);
    assert.equal(entryOf(pair.close).partner, pair.open);
  }
  assert.equal(PAIRS.length, CATALOGUE.filter((entry) => entry.kind === "open").length);
});
