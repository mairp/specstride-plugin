/**
 * T026 — CT-111-116: no content in any event (F111-FR-016).
 *
 * F111-FR-016: *No event MUST hold content. A prompt, a reply, the body of a
 * tool argument and the output of a command MUST be referred to by logical
 * name, hash and size. Every free-text field of an event MUST have passed the
 * redaction ingress and MUST be cut to the cap of its class. The free-text
 * fields are those that the catalogue marks, in the column "Free-text fields"
 * of `data-model.md` and the column `free_text_fields` of
 * `contracts/event-catalogue.tsv`, each with its ingress class; the mark is
 * the only list, and `message`, `evidence`, `target`, `question`, `detail`,
 * `reason`, `title`, `error`, `summary`, `cmd`, `argv`, `why`, `needs` and
 * `options` are among the marked. A type that is added with a field of free
 * text MUST mark it.*
 *
 * Three claims, three oracles:
 *
 *   1. NO CONTENT. The whole catalogue is read and no type has a field that
 *      would be a body; and the four kinds of content F111-FR-016 names are
 *      each carried by a reference of logical name, hash and size.
 *   2. REDACTED AND CAPPED BY ITS CLASS. The ingress runs over a real event
 *      with a planted secret and a value past the cap of each of the nine
 *      classes; the result is checked value by value and byte by byte.
 *   3. NO FIELD OF FREE TEXT WITHOUT A MARK. Every field the catalogue leaves
 *      unmarked is either a member of a closed set, an id, a logical name, a
 *      hash, a time or a number — or it is on the recorded list of readings,
 *      which the test pins exactly, so a tenth would fail the build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closedSet } from "@specstride/contracts/enums/all-sets";
import {
  AN_EVENT_HOLDS_CONTENT,
  CONTENT_REFERENCE_FIELDS,
} from "@specstride/contracts/envelope/event";
import { CATALOGUE, CATALOGUE_BY_TYPE } from "../src/catalogue/index.ts";
import {
  CLASS_LIMITS,
  INGRESS_CLASSES,
  NAMED_IN_THE_REQUIREMENT,
  NOT_FREE_TEXT,
  TARGET_MAX_ITEMS,
  capBytes,
  capFor,
  contentFindings,
  enforceFreeText,
  freeTextFieldsOf,
  ingressClassOf,
  markFindings,
  unmarkedFreeTextCandidates,
} from "../src/writer/freetext.ts";

/** A redactor that replaces a planted secret, as the real one replaces a match. */
const SECRET = "sk-live-0123456789";
function redactor(text: string): { text: string; redacted: boolean } {
  const replaced = text.split(SECRET).join("[REDACTED]");
  return { text: replaced, redacted: replaced !== text };
}

/* ------------------------------------------------------------------ *
 * 1. No content in any event.
 * ------------------------------------------------------------------ */

test("CT-111-116 an event holds no content", () => {
  assert.equal(AN_EVENT_HOLDS_CONTENT, false);
  for (const entry of CATALOGUE) {
    for (const field of entry.dataFields) {
      assert.doesNotMatch(
        field,
        /^(text|prompt|reply|body|output|content|stdout|stderr|transcript|snippet)$/,
        `${entry.type}.${field} would hold content`,
      );
    }
  }
});

test("CT-111-116 the four kinds of content are carried BY REFERENCE", () => {
  assert.deepEqual([...CONTENT_REFERENCE_FIELDS], ["logicalName", "hash", "size"]);
  // A prompt, a reply, the body of a tool argument and the output of a command.
  const byReference: [string, string][] = [
    ["prompt.built", "promptRef"],
    ["pass.ended", "transcriptRef"],
    ["tool.call", "argsRef"],
    ["tool.call", "resultRef"],
    ["stream.text", "textRef"],
    ["job.started", "logRef"],
  ];
  for (const [type, field] of byReference) {
    const entry = CATALOGUE_BY_TYPE.get(type);
    assert.ok(entry, type);
    assert.ok(entry.dataFields.includes(field), `${type} refers to the body through ${field}`);
    assert.equal(
      entry.freeTextFields.some((m) => m.field === field),
      false,
      `${type}.${field} is a reference, not free text`,
    );
  }
  // An event whose `data` carries a body is a finding, whatever the type.
  assert.deepEqual(
    contentFindings("tool.call", { argsRef: { logicalName: "n", hash: "h", size: 1 } }),
    [],
  );
  assert.ok(
    contentFindings("tool.call", {
      argsRef: { logicalName: "n", hash: "h", size: 1, body: "rm -rf /" },
    }).length > 0,
    "a reference that carries the body as well is a finding",
  );
});

/* ------------------------------------------------------------------ *
 * 2. Marked, redacted and capped by its class.
 * ------------------------------------------------------------------ */

test("CT-111-116 the ingress classes are the nine of the closed set, each with its cap", () => {
  assert.deepEqual([...INGRESS_CLASSES], [...(closedSet(89)?.members ?? [])]);
  assert.equal(INGRESS_CLASSES.length, 9);
  assert.deepEqual(CLASS_LIMITS, {
    "stream-text": 4096,
    "tool-arguments": 2048,
    "tool-result": 4096,
    diagnostic: 1024,
    target: 512,
    "check-output": 1024,
    "critic-reply": 1024,
    comment: 1024,
    "free-text": 1024,
  });
  for (const ingressClass of INGRESS_CLASSES) {
    assert.equal(typeof capFor(ingressClass), "number", ingressClass);
    assert.ok(capFor(ingressClass) > 0);
  }
  assert.equal(TARGET_MAX_ITEMS, 8);
});

test("CT-111-116 every mark of the catalogue names a class of the nine, on a field of its row", () => {
  assert.deepEqual(markFindings(), []);
  let marks = 0;
  for (const entry of CATALOGUE) {
    for (const mark of entry.freeTextFields) {
      marks += 1;
      assert.ok(entry.dataFields.includes(mark.field), `${entry.type}.${mark.field}`);
      assert.ok(
        INGRESS_CLASSES.includes(mark.ingressClass),
        `${entry.type}.${mark.field} carries the class ${mark.ingressClass}`,
      );
      assert.equal(ingressClassOf(entry.type, mark.field), mark.ingressClass);
    }
  }
  assert.ok(marks >= 40, `the catalogue marks ${marks} fields`);
});

test("CT-111-116 the fourteen names of the requirement are each among the marked", () => {
  assert.equal(NAMED_IN_THE_REQUIREMENT.length, 14);
  const marked = new Set(CATALOGUE.flatMap((e) => e.freeTextFields.map((m) => m.field)));
  for (const name of NAMED_IN_THE_REQUIREMENT) {
    assert.ok(marked.has(name), `\`${name}\` is among the marked`);
  }
});

test("CT-111-116 a marked field is REDACTED FIRST and CUT SECOND, and the marks say so", () => {
  const long = "x".repeat(3000);
  const result = enforceFreeText(
    "harness.error",
    { class: "auth", retryable: false, message: `${SECRET} ${long}` },
    redactor,
  );
  const message = result.data.message as string;
  assert.equal(message.includes(SECRET), false, "the secret is gone");
  assert.ok(message.startsWith("[REDACTED]"), "redaction ran before the cut");
  // `message` of `harness.error` is of the class `diagnostic`: 1024 bytes.
  assert.equal(ingressClassOf("harness.error", "message"), "diagnostic");
  assert.equal(Buffer.byteLength(message, "utf8"), 1024);
  assert.equal(result.marks.redacted, true);
  assert.equal(result.marks.truncated, true);
  // `originalBytes` is measured BEFORE redaction (research D-7, B-2216).
  assert.equal(result.marks.originalBytes, Buffer.byteLength(`${SECRET} ${long}`, "utf8"));
  assert.equal(result.marks.retainedBytes, 1024);
  assert.ok(result.marks.originalBytes > result.marks.retainedBytes);
});

test("CT-111-116 each class cuts at ITS cap, and a value that fits is untouched", () => {
  for (const ingressClass of INGRESS_CLASSES) {
    const cap = capFor(ingressClass);
    const over = capBytes("y".repeat(cap + 500), cap);
    assert.equal(over.retainedBytes, cap, ingressClass);
    assert.equal(over.truncated, true);
    assert.equal(over.originalBytes, cap + 500);
    const under = capBytes("y".repeat(cap - 1), cap);
    assert.equal(under.truncated, false);
    assert.equal(under.value.length, cap - 1);
    assert.equal(under.retainedBytes, cap - 1);
  }
  // The cut never splits a character in two.
  const emoji = "a".repeat(10) + "\u{1F600}".repeat(10);
  const cut = capBytes(emoji, 13);
  assert.ok(Buffer.byteLength(cut.value, "utf8") <= 13);
  assert.equal(cut.value.includes("�"), false, "no half character came back");
  assert.equal(
    [...cut.value].every((c) => emoji.includes(c)),
    true,
  );
});

test("CT-111-116 a marked field that holds a LIST is treated member by member", () => {
  const result = enforceFreeText(
    "tool.call",
    { tool: "Edit", targets: [`${SECRET}/a.ts`, "b".repeat(900)] },
    redactor,
  );
  const targets = result.data.targets as string[];
  assert.equal(targets.length, 2);
  assert.equal(targets[0]?.includes(SECRET), false);
  // `targets` is of the class `target`: 512 bytes per member.
  assert.equal(ingressClassOf("tool.call", "targets"), "target");
  assert.equal(Buffer.byteLength(targets[1] as string, "utf8"), 512);
  assert.equal(result.marks.truncated, true);
  assert.equal(result.marks.redacted, true);
});

test("CT-111-116 an UNMARKED field is not redacted and not cut: the mark is the only list", () => {
  const long = "z".repeat(3000);
  const result = enforceFreeText(
    "tool.call",
    { tool: "Edit", toolId: long, status: "ok" },
    redactor,
  );
  assert.equal(
    (result.data.toolId as string).length,
    3000,
    "`toolId` is an id and carries no mark",
  );
  assert.deepEqual(
    result.applied.map((a) => a.field),
    ["tool"],
    "only the marked fields of the row went through the ingress",
  );
  assert.equal(ingressClassOf("tool.call", "toolId"), undefined);
});

test("CT-111-116 the ingress never throws, whatever the value is", () => {
  for (const value of [null, 7, true, {}, [1, 2], undefined]) {
    assert.doesNotThrow(() =>
      enforceFreeText("harness.error", { class: "x", message: value }, redactor),
    );
  }
  const kept = enforceFreeText("harness.error", { class: "x", message: null }, redactor);
  assert.equal(kept.data.message, null, "null stays null: it is no text to cut");
  assert.equal(kept.marks.truncated, false);
});

/* ------------------------------------------------------------------ *
 * 3. No field of free text is without a mark.
 * ------------------------------------------------------------------ */

test("CT-111-116 no field of free text is without a mark", () => {
  assert.deepEqual(
    [...unmarkedFreeTextCandidates()],
    [],
    "every field that would hold free text carries its mark",
  );
});

test("CT-111-116 the fields that look like free text and are NOT are recorded, each with its reason", () => {
  // The list is pinned: a tenth entry, or a changed reason, fails the build.
  assert.deepEqual(
    NOT_FREE_TEXT.map((row) => `${row.type}.${row.field}`),
    [
      "blocked.reason",
      "pass.killed.reason",
      "pass.ended.evidence",
      "stage.ended.reason",
      "supervisor.relaunch.reason",
      "plugin.install_denied.reason",
      "check.excluded.reason",
      "check.admission.reason",
      "check.parallelism_lowered.reason",
    ],
  );
  for (const row of NOT_FREE_TEXT) {
    const entry = CATALOGUE_BY_TYPE.get(row.type);
    assert.ok(entry, row.type);
    assert.ok(
      entry.dataFields.includes(row.field),
      `${row.type}.${row.field} is a field of the row`,
    );
    assert.equal(
      entry.freeTextFields.some((m) => m.field === row.field),
      false,
      `${row.type}.${row.field} is unmarked, which is what the row records`,
    );
    assert.ok(row.reason.length > 20, `${row.type}.${row.field} states why`);
  }
});

test("CT-111-116 `freeTextFieldsOf` is the catalogue's list and no second one", () => {
  for (const entry of CATALOGUE) {
    assert.deepEqual(
      freeTextFieldsOf(entry.type).map((m) => `${m.field}:${m.ingressClass}`),
      entry.freeTextFields.map((m) => `${m.field}:${m.ingressClass}`),
      entry.type,
    );
  }
  assert.deepEqual([...freeTextFieldsOf("x.a.third.party.type")], []);
});
