/**
 * T034 — CT-111-137 and CT-111-138 (F111-FR-037, F111-FR-038).
 *
 * F111-FR-037: *A reader and a sink MUST ignore a field and a type they do not
 * know and MUST tolerate a torn last line. Types that start with `x.` MUST be
 * free for third parties, MUST never be projected and MUST never change the
 * read model. An event whose major is outside the accepted range MUST give a
 * doctor warning and never a failure of a run.*
 *
 * F111-FR-038: *The roles in events MUST come from the role registry of the
 * run, and `supervisor` and `host`. An unknown role MUST be kept as text. A
 * sink MUST enumerate no harness by name: it reads the registry.*
 *
 * The tests of CT-111-137 read BYTES: the event file is written by the one
 * writer of the run and then edited by hand, which is what an unknown field, an
 * unknown type and a torn last line look like on disk. Each part has a negative
 * control, and the last one is the one that matters: a reader that ignored a
 * KNOWN field or projected an `x.` type would pass the positive half alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAJOR, SCHEMA } from "@specstride/contracts/envelope/event";
import { DOCTOR_SEVERITIES } from "@specstride/contracts/codes/doctor-and-collisions";
import { eventRoles } from "@specstride/contracts/enums/all-sets";
import {
  DOCTOR_FINDING_MAJOR_OUT_OF_RANGE,
  DOCTOR_SEVERITY_MAJOR_OUT_OF_RANGE,
  MAJOR_OUT_OF_RANGE_FAILS_THE_RUN,
  NO_HARNESS_IS_ENUMERATED_BY_NAME,
  ROLES_BESIDE_THE_REGISTRY,
  THIRD_PARTY_PREFIX,
  UNKNOWN_ROLE_CELL,
  UNKNOWN_ROLE_IS_KEPT_AS_TEXT,
  changesTheReadModel,
  harnessIdsFromTheRegistry,
  ignoreUnknownFields,
  isKnownType,
  isNeverProjected,
  majorRangeFinding,
  readTolerantly,
  roleOf,
  rolesOfTheRun,
} from "../src/dispatcher/unknown.ts";
import { PrimaryWriter } from "../src/writer/writer.ts";

function workdir(): string {
  return mkdtempSync(join(tmpdir(), "ct-111-137-"));
}

/** A real file of three events, written by the one writer of the run. */
function soundFile(dir: string): string {
  const file = join(dir, "events.jsonl");
  const writer = PrimaryWriter.open({ file, runId: "run-137", launchId: "launch-137" });
  writer.append({ type: "pass.started", data: {} });
  writer.append({ type: "tool.call", data: { tool: "Edit" } });
  writer.append({ type: "pass.ended", data: { endCause: "completed" } });
  writer.close();
  return file;
}

/* ------------------------------------------------------------------ *
 * CT-111-137/a — an unknown FIELD is ignored, a known one is not.
 * ------------------------------------------------------------------ */

test("CT-111-137/a: a reader ignores a field it does not know and keeps the ones it knows", () => {
  const event = {
    schema: SCHEMA,
    v: MAJOR,
    seq: 7,
    ts: "2026-10-01T00:00:00.000Z",
    type: "pass.started",
    runId: "run-137",
    launchId: "launch-137",
    data: { iter: 1, somethingFromAFutureMinor: "ignored" },
    aFieldOfAFutureMinor: 42,
  };

  const kept = ignoreUnknownFields(event);
  assert.equal(kept.event.seq, 7, "a field the envelope knows survives");
  assert.equal(kept.event.type, "pass.started");
  assert.equal(
    "aFieldOfAFutureMinor" in kept.event,
    false,
    "the envelope field nobody knows is not in the result",
  );
  assert.deepEqual([...kept.ignoredFields], ["aFieldOfAFutureMinor"]);
  assert.deepEqual([...kept.ignoredDataFields], ["somethingFromAFutureMinor"]);
  assert.equal(
    (kept.event.data as Record<string, unknown>).iter,
    1,
    "a `data` field the catalogue knows survives",
  );

  // Negative control: nothing is ignored where every field is known.
  const clean = ignoreUnknownFields({
    schema: SCHEMA,
    v: MAJOR,
    seq: 1,
    ts: "2026-10-01T00:00:00.000Z",
    type: "pass.started",
    runId: "run-137",
    launchId: "launch-137",
    data: { iter: 1 },
  });
  assert.deepEqual([...clean.ignoredFields], []);
  assert.deepEqual([...clean.ignoredDataFields], []);
});

/* ------------------------------------------------------------------ *
 * CT-111-137/b — an unknown TYPE is ignored; a torn last line tolerated.
 * ------------------------------------------------------------------ */

test("CT-111-137/b: a reader ignores a type it does not know and tolerates a torn last line", () => {
  const dir = workdir();
  const file = soundFile(dir);

  // A type no catalogue of this build holds, then a torn last line: the bytes
  // of an append that a crash cut in half.
  appendFileSync(
    file,
    `{"schema":"${SCHEMA}","v":${MAJOR},"seq":4,"ts":"2026-10-01T00:00:00.000Z",` +
      `"type":"something.nobody.knows","runId":"run-137","launchId":"launch-137","data":{}}\n`,
  );
  appendFileSync(file, '{"schema":"specstride.event/1","v":1,"seq":5,"ts":"2026-');

  const read = readTolerantly(file);
  assert.deepEqual(
    read.events.map((e) => e.type),
    ["pass.started", "tool.call", "pass.ended"],
    "the three known types are read and the unknown one is ignored",
  );
  assert.deepEqual([...read.ignoredTypes], ["something.nobody.knows"]);
  assert.equal(read.tornLastLine, true, "the half line is reported, not thrown on");
  assert.equal(read.lastCompleteSeq, 4, "the last COMPLETE line is the unknown type's");

  assert.equal(isKnownType("pass.started"), true);
  assert.equal(isKnownType("something.nobody.knows"), false);

  // Negative control: a file with no torn line and no unknown type.
  const sound = readTolerantly(soundFile(workdir()));
  assert.equal(sound.tornLastLine, false);
  assert.deepEqual([...sound.ignoredTypes], []);
  assert.equal(sound.events.length, 3);
});

/* ------------------------------------------------------------------ *
 * CT-111-137/c — `x.` is free, never projected, never changes the read model.
 * ------------------------------------------------------------------ */

test("CT-111-137/c: a type that starts with `x.` is read, never projected and never changes the read model", () => {
  const dir = workdir();
  const file = soundFile(dir);
  appendFileSync(
    file,
    `{"schema":"${SCHEMA}","v":${MAJOR},"seq":4,"ts":"2026-10-01T00:00:00.000Z",` +
      `"type":"x.audit","runId":"run-137","launchId":"launch-137","data":{"whatever":true}}\n`,
  );

  assert.equal(THIRD_PARTY_PREFIX, "x.");
  assert.equal(isNeverProjected("x.audit"), true);
  assert.equal(isNeverProjected("pass.started"), false, "a catalogue type IS projected");
  assert.equal(changesTheReadModel("x.audit"), false);
  assert.equal(changesTheReadModel("pass.started"), true);

  const read = readTolerantly(file);
  // An `x.` type is FREE: it is not an unknown type and it is not dropped as
  // one. It is simply never projected.
  assert.deepEqual([...read.ignoredTypes], [], "`x.audit` is free, not unknown");
  assert.deepEqual(
    read.projected.map((e) => e.type),
    ["pass.started", "tool.call", "pass.ended"],
    "the `x.` event is in the file and in no projection",
  );
  assert.deepEqual(
    read.thirdParty.map((e) => e.type),
    ["x.audit"],
  );
  assert.equal(
    readFileSync(file, "utf8").includes('"x.audit"'),
    true,
    "the event stays in the primary file: only the projection leaves it out",
  );
});

/* ------------------------------------------------------------------ *
 * CT-111-137/d — a major outside the range warns and never fails a run.
 * ------------------------------------------------------------------ */

test("CT-111-137/d: an event whose major is outside the accepted range gives a doctor warning and no failure", () => {
  const accepted = { from: MAJOR, to: MAJOR };

  const inRange = majorRangeFinding(MAJOR, accepted);
  assert.equal(inRange, null, "negative control: an event in range gives no finding");

  const finding = majorRangeFinding(MAJOR + 3, accepted);
  assert.ok(finding !== null);
  assert.equal(finding.id, DOCTOR_FINDING_MAJOR_OUT_OF_RANGE);
  assert.equal(finding.severity, DOCTOR_SEVERITY_MAJOR_OUT_OF_RANGE);
  assert.equal(finding.severity, "warn");
  assert.ok(
    DOCTOR_SEVERITIES.includes(finding.severity),
    "the severity is a member of the closed set of feature 100",
  );
  assert.equal(MAJOR_OUT_OF_RANGE_FAILS_THE_RUN, false);
  assert.ok(
    !DOCTOR_SEVERITIES.slice(DOCTOR_SEVERITIES.indexOf("fail")).includes(finding.severity),
    "the finding is never a `fail`",
  );

  // The reader goes on: the event out of range is read and warned about.
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  writeFileSync(
    file,
    `{"schema":"${SCHEMA}","v":${MAJOR + 3},"seq":1,"ts":"2026-10-01T00:00:00.000Z",` +
      `"type":"pass.started","runId":"run-137","launchId":"launch-137","data":{}}\n`,
  );
  const read = readTolerantly(file, { acceptsMajors: accepted });
  assert.equal(read.events.length, 1, "the run goes on and the line is read");
  assert.deepEqual(
    read.findings.map((f) => f.id),
    [DOCTOR_FINDING_MAJOR_OUT_OF_RANGE],
  );
  assert.equal(read.failed, false);
});

/* ------------------------------------------------------------------ *
 * CT-111-138 — the roles come from the registry of the run.
 * ------------------------------------------------------------------ */

/** The resolved registry of a run, in the shape of annex C §C.6. */
const registry = Object.freeze({
  roles: Object.freeze([
    Object.freeze({
      id: "proposer",
      capabilityLevelRequired: "proposer",
      independenceConstraints: Object.freeze([]),
      budgetKey: "b",
    }),
    Object.freeze({
      id: "critic",
      capabilityLevelRequired: "completion",
      independenceConstraints: Object.freeze([]),
      budgetKey: "b",
    }),
    Object.freeze({
      id: "diagnostician",
      capabilityLevelRequired: "completion",
      independenceConstraints: Object.freeze([]),
      budgetKey: "b",
    }),
  ]),
  harnesses: Object.freeze([
    Object.freeze({ id: "harness-a" }),
    Object.freeze({ id: "harness-b" }),
  ]),
});

test("CT-111-138/a: the roles of a run are the registry's, plus `supervisor` and `host`", () => {
  assert.deepEqual([...ROLES_BESIDE_THE_REGISTRY], ["supervisor", "host"]);
  // Row 72 of annex X §X.6 holds exactly those two literals; the rest of the
  // set is the registry of the run, which is why the row is open.
  assert.deepEqual([...eventRoles.members], ["supervisor", "host"]);
  assert.equal(eventRoles.number, 72);

  const roles = rolesOfTheRun(registry);
  assert.deepEqual(
    [...roles],
    ["critic", "diagnostician", "proposer", "supervisor", "host"],
    "the registry's roles, sorted, then the two of the row",
  );

  // Negative control: a run whose registry declares no role still has the two.
  assert.deepEqual([...rolesOfTheRun({ roles: [] })], ["supervisor", "host"]);
});

test("CT-111-138/b: an unknown role is kept as text", () => {
  assert.equal(UNKNOWN_ROLE_IS_KEPT_AS_TEXT, true);

  const known = roleOf("proposer", registry);
  assert.equal(known.role, "proposer");
  assert.equal(known.known, true);
  assert.equal(known.source, "registry");

  const ofTheRow = roleOf("supervisor", registry);
  assert.equal(ofTheRow.known, true);
  assert.equal(ofTheRow.source, "row-72");

  const stranger = roleOf("an-unregistered-role", registry);
  assert.equal(stranger.role, "an-unregistered-role", "the text is kept, byte for byte");
  assert.equal(stranger.known, false);
  assert.equal(stranger.source, "kept-as-text");
  assert.equal(UNKNOWN_ROLE_CELL, "Kept as text", "the cell of row 72, verbatim");
  assert.equal(eventRoles.onUnknown("an-unregistered-role").cell, UNKNOWN_ROLE_CELL);

  // Negative control: an unknown role is not mapped onto a known one and not
  // dropped.
  assert.notEqual(stranger.role, "proposer");
  assert.notEqual(stranger.role, undefined);
});

test("CT-111-138/c: a sink enumerates no harness by name — it reads the registry", () => {
  assert.equal(NO_HARNESS_IS_ENUMERATED_BY_NAME, true);
  assert.deepEqual([...harnessIdsFromTheRegistry(registry)], ["harness-a", "harness-b"]);
  // A run with other harnesses gives other ids from the same call: the list is
  // never a literal of this package.
  assert.deepEqual(
    [...harnessIdsFromTheRegistry({ harnesses: [{ id: "only-this-one" }] })],
    ["only-this-one"],
  );
  assert.deepEqual([...harnessIdsFromTheRegistry({})], []);

  // Negative control over the SOURCE of this module: no harness id of the
  // registry of the repository is written in `unknown.ts`.
  const source = readFileSync(new URL("../src/dispatcher/unknown.ts", import.meta.url), "utf8");
  for (const id of ["claude", "codex", "gemini", "dsh", "prime", "pi"]) {
    assert.equal(
      new RegExp(`["'\`]${id}["'\`]`).test(source),
      false,
      `the source names no harness: ${id}`,
    );
  }
});
