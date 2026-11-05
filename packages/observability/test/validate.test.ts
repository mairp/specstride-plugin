/**
 * T005 — CT-111-120: validation before the write (F111-FR-020).
 *
 * F111-FR-020: *The writer MUST check the `data` of every event against the
 * schema of its type before it writes it. An event that fails, and an event
 * whose type is neither in the catalogue nor starts with `x.`, MUST NOT be
 * written and MUST be counted in `event.dropped` with the reason `invalid`.
 * The `data` of a type that starts with `x.` is not checked. The check MUST
 * never throw into the loop.*
 *
 * This is an INTEGRATION test with an EFFECT WITNESS: the events are appended
 * to a real file in a temporary directory, and every claim about what was
 * written is read back THROUGH AN INDEPENDENT READ PATH — the bytes of the
 * file, parsed by `readEventLine` of `@specstride/contracts`, which is feature
 * 100's reader of the envelope and knows nothing of this package. The value
 * `writeThroughValidation` returns is never taken as proof on its own; the test
 * "a successful-looking outcome is not proof" below shows why.
 *
 * The durable witness is the file: its byte length, its gapless `seq` and the
 * SHA-256 of its bytes, none of which can exist before the appends.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, appendFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEventLine } from "@specstride/contracts/envelope/event";
import { reasonsOfADroppedEvent } from "@specstride/contracts/enums/all-sets";
import { CATALOGUE, CATALOGUE_SIZE, dataSchemaForType } from "../src/catalogue/index.ts";
import {
  DROPPED_EVENT_TYPE,
  DROP_REASON_INVALID,
  DropLedger,
  checkAgainstSchema,
  droppedEventOf,
  validateBeforeWrite,
  writeThroughValidation,
} from "../src/writer/validate.ts";

/* ------------------------------------------------------------------ *
 * A real append target: the minimal primary write path this test needs.
 * The writer of T008 owns the lock and the ordering; here the append is a
 * plain append of one line, so that "before it writes it" has a file to be
 * before.
 * ------------------------------------------------------------------ */

type Target = {
  readonly file: string;
  append: (event: { readonly type: string; readonly data?: unknown }) => void;
  /** Every type the target was ASKED to append, in order (lying or not). */
  readonly asked: string[];
};

function fileTarget(dir: string, name = "events.jsonl"): Target {
  const file = join(dir, name);
  const asked: string[] = [];
  let seq = 0;
  return {
    file,
    asked,
    append(event) {
      asked.push(event.type);
      seq += 1;
      const line = JSON.stringify({
        schema: "specstride.event",
        v: 1,
        seq,
        ts: "2026-10-01T00:00:00.000Z",
        type: event.type,
        runId: "run-ct-111-120",
        launchId: "launch-ct-111-120",
        data: event.data ?? {},
      });
      appendFileSync(file, `${line}\n`);
    },
  };
}

/** The independent read path: the bytes of the file, through feature 100's reader. */
function readBack(file: string): { type: string; seq: number; data: Record<string, unknown> }[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
  return lines.map((line, index) => {
    const read = readEventLine(line, index === lines.length - 1);
    assert.equal(read.ok, true, `line ${index + 1} of the file is a well-formed event: ${line}`);
    assert.ok(read.ok);
    return {
      type: String(read.event.type),
      seq: Number(read.event.seq),
      data: (read.event.data ?? {}) as Record<string, unknown>,
    };
  });
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "ct-111-120-"));
}

/* ------------------------------------------------------------------ *
 * The check itself.
 * ------------------------------------------------------------------ */

test("CT-111-120: the reason `invalid` is the member of the closed set of row 94", () => {
  assert.equal(DROP_REASON_INVALID, "invalid");
  assert.equal(reasonsOfADroppedEvent.has(DROP_REASON_INVALID), true);
  assert.equal(reasonsOfADroppedEvent.number, 94);
  assert.equal(DROPPED_EVENT_TYPE, "event.dropped");
  assert.ok(dataSchemaForType(DROPPED_EVENT_TYPE) !== undefined, "event.dropped is a type");
});

test("CT-111-120: the `data` of a catalogue type is checked against its schema", () => {
  const schema = dataSchemaForType("alert");
  assert.ok(schema !== undefined);
  assert.deepEqual(
    [...checkAgainstSchema(schema, { kind: "budget-threshold", level: "warn" })],
    [],
  );
  // A field the catalogue does not know.
  assert.deepEqual(
    [...checkAgainstSchema(schema, { kind: "budget-threshold", nope: 1 })],
    [
      {
        keyword: "additionalProperties",
        path: "data.nope",
        message: "the type alert has no data field named nope",
      },
    ],
  );
  // A value outside the closed set of the field.
  assert.deepEqual(
    [...checkAgainstSchema(schema, { level: "shout" })].map((finding) => finding.keyword),
    ["enum"],
  );
  // `data` that is not a record at all.
  for (const notARecord of [null, 1, "x", [], true, undefined]) {
    assert.deepEqual(
      [...checkAgainstSchema(schema, notARecord)].map((finding) => finding.keyword),
      ["type"],
      JSON.stringify(notARecord ?? null),
    );
  }
  // A free-text field holds text, a list of text or null; never a record.
  const diagnostic = dataSchemaForType("harness.error");
  assert.ok(diagnostic !== undefined);
  assert.deepEqual([...checkAgainstSchema(diagnostic, { message: "boom" })], []);
  assert.deepEqual([...checkAgainstSchema(diagnostic, { message: null })], []);
  assert.deepEqual([...checkAgainstSchema(diagnostic, { message: ["a", "b"] })], []);
  assert.deepEqual(
    [...checkAgainstSchema(diagnostic, { message: { body: "boom" } })].map((f) => f.keyword),
    ["type"],
  );
  assert.deepEqual(
    [...checkAgainstSchema(diagnostic, { message: [1] })].map((f) => f.keyword),
    ["items"],
  );
});

test("CT-111-120: `validateBeforeWrite` admits, refuses, and leaves `x.` unchecked", () => {
  const ok = validateBeforeWrite({ type: "alert", data: { level: "warn" } });
  assert.deepEqual(ok, { admitted: true, type: "alert", checked: true });

  const bad = validateBeforeWrite({ type: "alert", data: { level: "shout" } });
  assert.equal(bad.admitted, false);
  assert.ok(!bad.admitted);
  assert.equal(bad.reason, DROP_REASON_INVALID);
  assert.ok(bad.findings.length > 0, "the refusal says what failed");

  const absent = validateBeforeWrite({ type: "nope.absent", data: {} });
  assert.equal(absent.admitted, false);
  assert.ok(!absent.admitted);
  assert.equal(absent.reason, DROP_REASON_INVALID);
  assert.deepEqual(
    [...absent.findings].map((finding) => finding.keyword),
    ["type-not-in-catalogue"],
  );

  // The `data` of a type that starts with `x.` is NOT checked: anything goes.
  for (const data of [{ anything: [1, 2, 3] }, {}, null, 7, "text"]) {
    const free = validateBeforeWrite({ type: "x.audit", data });
    assert.deepEqual(free, { admitted: true, type: "x.audit", checked: false });
  }
});

test("CT-111-120: the check never throws into the loop", () => {
  // `data` whose access throws: the check refuses and does not propagate.
  const exploding = {
    type: "alert",
    get data(): unknown {
      throw new Error("the loop must not see this");
    },
  };
  const verdict = validateBeforeWrite(exploding);
  assert.equal(verdict.admitted, false);
  assert.ok(!verdict.admitted);
  assert.equal(verdict.reason, DROP_REASON_INVALID);
  assert.deepEqual(
    [...verdict.findings].map((f) => f.keyword),
    ["internal"],
  );

  // A type whose access throws.
  const explodingType = {
    get type(): string {
      throw new Error("the loop must not see this either");
    },
  };
  const second = validateBeforeWrite(explodingType);
  assert.equal(second.admitted, false);

  // An `x.` type is admitted without the `data` ever being read, so a `data`
  // that would throw cannot be reached.
  let read = 0;
  const free = {
    type: "x.audit",
    get data(): unknown {
      read += 1;
      throw new Error("unreachable: the data of an x. type is not checked");
    },
  };
  assert.deepEqual(validateBeforeWrite(free), {
    admitted: true,
    type: "x.audit",
    checked: false,
  });
  assert.equal(read, 0, "the data of an x. type is never read");

  // Nothing at all, and values of every other shape.
  for (const nonsense of [undefined, null, 0, "", [], true, { type: 1 }, { type: "" }]) {
    const outcome = validateBeforeWrite(nonsense);
    assert.equal(outcome.admitted, false, JSON.stringify(nonsense ?? null));
  }
});

/* ------------------------------------------------------------------ *
 * The effect witness: what the file holds.
 * ------------------------------------------------------------------ */

test("CT-111-120: an invalid event and an event without a catalogue type are not written", () => {
  const target = fileTarget(freshDir());
  const ledger = new DropLedger();
  assert.equal(existsSync(target.file), false, "nothing is written before the first append");

  // 1. A valid event of a catalogue type.
  const first = writeThroughValidation(target, ledger, {
    type: "pass.started",
    data: { iter: 1, maxIter: 10, sessionId: "s-1", continued: false },
  });
  assert.equal(first.written, true);

  // 2. An event whose `data` does not fit the schema of its type.
  const invalid = writeThroughValidation(target, ledger, {
    type: "pass.ended",
    data: { iter: 1, endCause: "no_such_cause" },
  });
  assert.equal(invalid.written, false);
  assert.ok(!invalid.written);
  assert.equal(invalid.reason, DROP_REASON_INVALID);

  // 3. An event whose type is in no catalogue row and does not start with `x.`.
  const unknown = writeThroughValidation(target, ledger, {
    type: "nope.absent",
    data: { anything: true },
  });
  assert.equal(unknown.written, false);
  assert.ok(!unknown.written);
  assert.equal(unknown.reason, DROP_REASON_INVALID);

  // 4. An event of a type that starts with `x.`, with `data` nobody checks.
  const free = writeThroughValidation(target, ledger, {
    type: "x.audit",
    data: { whatever: [1, 2, 3] },
  });
  assert.equal(free.written, true);

  // 5. The next event that is written is preceded by `event.dropped`.
  const next = writeThroughValidation(target, ledger, {
    type: "commit.made",
    data: { phase: 2 },
  });
  assert.equal(next.written, true);

  // ---- The independent read path decides what happened. ----
  const onDisk = readBack(target.file);
  assert.deepEqual(
    onDisk.map((event) => event.type),
    ["pass.started", "event.dropped", "x.audit", "commit.made"],
    "the invalid event and the event of an unknown type are in the file nowhere; the " +
      "report stands before the NEXT event that was written, which is the x. event",
  );
  assert.equal(
    onDisk.some((event) => event.type === "pass.ended" || event.type === "nope.absent"),
    false,
    "neither refused event reached the file",
  );
  // `event.dropped` carries the count and the reason `invalid` (F111-FR-020).
  const dropped = onDisk.find((event) => event.type === DROPPED_EVENT_TYPE);
  assert.ok(dropped !== undefined, "the next write is preceded by event.dropped");
  assert.deepEqual(dropped.data, { count: 2, reason: DROP_REASON_INVALID });
  // It stands BEFORE the next event that was written, not after it.
  assert.equal(
    onDisk.findIndex((event) => event.type === DROPPED_EVENT_TYPE),
    1,
  );
  assert.ok(
    onDisk.findIndex((event) => event.type === DROPPED_EVENT_TYPE) <
      onDisk.findIndex((event) => event.type === "x.audit"),
  );
  // A refused event used no `seq`: the file is gapless from 1.
  assert.deepEqual(
    onDisk.map((event) => event.seq),
    [1, 2, 3, 4],
  );
  // The ledger is cleared once the drop has been written: no second report.
  const after = writeThroughValidation(target, ledger, { type: "commit.made", data: { phase: 3 } });
  assert.equal(after.written, true);
  assert.deepEqual(
    readBack(target.file).map((event) => event.type),
    ["pass.started", "event.dropped", "x.audit", "commit.made", "commit.made"],
  );

  // ---- The durable witness: bytes and a content hash that cannot pre-exist. ----
  const bytes = statSync(target.file).size;
  assert.ok(bytes > 0, "the file holds bytes");
  const hash = sha256(target.file);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, sha256(target.file), "the hash is stable on a second read");
  assert.notEqual(
    hash,
    createHash("sha256").update("").digest("hex"),
    "the hash is not the hash of an empty file",
  );
  // The hash is the hash of the five lines the read path returned, and of
  // nothing else: no refused event hides in the bytes.
  assert.equal(
    readFileSync(target.file, "utf8")
      .split("\n")
      .filter((l) => l.length > 0).length,
    5,
  );
});

test("CT-111-120: validation runs BEFORE the write, so a refused event is never appended", () => {
  const target = fileTarget(freshDir());
  const ledger = new DropLedger();
  writeThroughValidation(target, ledger, { type: "pass.ended", data: { endCause: "nope" } });
  writeThroughValidation(target, ledger, { type: "nope.absent", data: {} });
  // The append was never even ASKED for the refused events.
  assert.deepEqual(target.asked, [], "the write path was not reached");
  assert.equal(existsSync(target.file), false, "no file was created");
  assert.deepEqual([...ledger.take()], [{ reason: DROP_REASON_INVALID, count: 2 }]);
});

test("CT-111-120: a successful-looking outcome is not proof; the file is", () => {
  // A target that reports success and writes nothing. The outcome says
  // `written: true`, and the independent read path shows no durable effect —
  // which is why every claim above is made against the file and not the
  // return value.
  const dir = freshDir();
  const lying: Target = {
    file: join(dir, "events.jsonl"),
    asked: [],
    append(event) {
      lying.asked.push(event.type);
    },
  };
  const outcome = writeThroughValidation(lying, new DropLedger(), {
    type: "commit.made",
    data: { phase: 1 },
  });
  assert.equal(outcome.written, true, "the mutation response looks successful");
  assert.deepEqual(lying.asked, ["commit.made"], "the append was called");
  assert.equal(existsSync(lying.file), false, "and yet nothing durable exists");
  assert.deepEqual(readBack(lying.file), [], "the independent read path finds no event");
});

test("CT-111-120: the drop ledger counts by reason and clears when it is taken", () => {
  const ledger = new DropLedger();
  assert.equal(ledger.total, 0);
  assert.deepEqual([...ledger.take()], []);
  ledger.count(DROP_REASON_INVALID);
  ledger.count(DROP_REASON_INVALID);
  assert.equal(ledger.total, 2);
  assert.deepEqual([...ledger.pending()], [{ reason: DROP_REASON_INVALID, count: 2 }]);
  assert.deepEqual([...ledger.take()], [{ reason: DROP_REASON_INVALID, count: 2 }]);
  assert.equal(ledger.total, 0, "the ledger is cleared by the take");
  assert.deepEqual([...ledger.take()], []);
  // The `event.dropped` the ledger produces validates against its own schema.
  const event = droppedEventOf({ reason: DROP_REASON_INVALID, count: 3 });
  assert.equal(event.type, DROPPED_EVENT_TYPE);
  assert.deepEqual(validateBeforeWrite(event), {
    admitted: true,
    type: DROPPED_EVENT_TYPE,
    checked: true,
  });
});

test("CT-111-120: every type of the catalogue is admitted with an empty `data`", () => {
  // No `data` field is required (absence means the value does not apply,
  // F111-FR-002), so the schema of every one of the types admits `{}`. This is
  // the floor the writer stands on: validation never refuses a well-formed
  // event of a catalogue type for a field that was simply not set.
  let admitted = 0;
  for (const entry of CATALOGUE) {
    const verdict = validateBeforeWrite({ type: entry.type, data: {} });
    assert.deepEqual(
      verdict,
      { admitted: true, type: entry.type, checked: true },
      `${entry.type} is admitted with an empty data`,
    );
    admitted += 1;
  }
  assert.equal(admitted, CATALOGUE_SIZE);
});
