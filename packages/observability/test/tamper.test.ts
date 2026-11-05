/**
 * T013 — CT-111-121: tampering is detected and not prevented (F111-FR-021).
 *
 * F111-FR-021: *The event file MUST be in the control plane, in the location
 * that the logical name `run:<runId>:events` names. Tampering MUST be detected
 * and not prevented: a reader MUST find a gap, a repeat or a fall of `seq` and
 * report it, the doctor MUST warn, and the run MUST NOT be stopped.*
 *
 * The detection is by `seq` ALONE: the envelope of feature 100 carries no hash
 * of the previous record, which is the reading CQ-034 (research D-10).
 *
 * The three shapes are each tested on the BYTES of a real file that a writer
 * of this package wrote and a hand then edited — which is what tampering is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOGICAL_NAME } from "@specstride/contracts/envelope/event";
import { DOCTOR_SEVERITIES } from "@specstride/contracts/codes/doctor-and-collisions";
import {
  DOCTOR_FINDING_ID,
  EVENTS_LOGICAL_NAME,
  TAMPERING_IS_PREVENTED,
  TAMPERING_STOPS_THE_RUN,
  TAMPER_KINDS,
  checkEventFile,
  checkSeq,
  doctorFindingsOf,
  eventsLogicalNameOf,
} from "../src/writer/check.ts";
import { PrimaryWriter } from "../src/writer/writer.ts";

function workdir(): string {
  return mkdtempSync(join(tmpdir(), "ct-111-121-"));
}

/** A real file of five events, written by the one writer of the run. */
function soundFile(): string {
  const file = join(workdir(), "events.jsonl");
  const writer = PrimaryWriter.open({
    file,
    runId: "run-ct-111-121",
    launchId: "launch-ct-111-121",
    holder: "writer-a",
  });
  for (let i = 1; i <= 5; i += 1) writer.append({ type: "commit.made", data: { phase: i } });
  writer.close();
  return file;
}

/** Tamper with the file: rewrite the lines a hand chose. */
function rewrite(file: string, change: (lines: string[]) => string[]): void {
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
  writeFileSync(file, change(lines).join("\n") + "\n");
}

/* ------------------------------------------------------------------ *
 * Where the file is, and what the check is not.
 * ------------------------------------------------------------------ */

test("CT-111-121 the event file is the logical name `run:<runId>:events`", () => {
  assert.equal(EVENTS_LOGICAL_NAME, "run:<runId>:events");
  assert.equal(
    EVENTS_LOGICAL_NAME,
    LOGICAL_NAME,
    "the name is feature 100's, not a second one written here",
  );
  assert.equal(eventsLogicalNameOf("run-7"), "run:run-7:events");
});

test("CT-111-121 tampering is DETECTED and not PREVENTED, and never stops the run", () => {
  assert.equal(TAMPERING_IS_PREVENTED, false);
  assert.equal(TAMPERING_STOPS_THE_RUN, false);
  assert.deepEqual([...TAMPER_KINDS], ["gap", "repeat", "fall"]);
});

/* ------------------------------------------------------------------ *
 * A gap, a repeat and a fall.
 * ------------------------------------------------------------------ */

test("CT-111-121 a GAP of `seq` is reported and the run goes on", () => {
  const file = soundFile();
  // A hand deleted the third line.
  rewrite(file, (lines) => lines.filter((_, index) => index !== 2));
  const report = checkEventFile(file);
  assert.equal(report.tampered, true);
  assert.equal(report.stopsTheRun, false);
  assert.deepEqual(
    report.findings.map((f) => ({ kind: f.kind, expected: f.expected, found: f.found })),
    [{ kind: "gap", expected: 3, found: 4 }],
  );
  assert.equal(report.checked, 4);
});

test("CT-111-121 a REPEAT of `seq` is reported and the run goes on", () => {
  const file = soundFile();
  // A hand duplicated the second line.
  rewrite(file, (lines) => [...lines.slice(0, 2), lines[1] as string, ...lines.slice(2)]);
  const report = checkEventFile(file);
  assert.equal(report.tampered, true);
  assert.equal(report.stopsTheRun, false);
  assert.deepEqual(
    report.findings.map((f) => f.kind),
    ["repeat"],
    "the repeat is reported once; the genuine numbers that follow it are not noise",
  );
  assert.equal(report.findings[0]?.found, 2);
  assert.equal(report.findings[0]?.expected, 3);
});

test("CT-111-121 a FALL of `seq` is reported and the run goes on", () => {
  const file = soundFile();
  // A hand put the fourth line back to 2.
  rewrite(file, (lines) =>
    lines.map((line, index) => (index === 3 ? line.replace('"seq":4', '"seq":2') : line)),
  );
  const report = checkEventFile(file);
  assert.equal(report.tampered, true);
  assert.equal(report.stopsTheRun, false);
  assert.equal(report.findings[0]?.kind, "fall");
  assert.equal(report.findings[0]?.found, 2);
  assert.equal(report.findings[0]?.expected, 4);
});

test("CT-111-121 a sound file gives no finding", () => {
  const file = soundFile();
  const report = checkEventFile(file);
  assert.equal(report.tampered, false);
  assert.deepEqual(report.findings, []);
  assert.equal(report.checked, 5);
  assert.deepEqual(report.doctorFindings, []);
});

test("CT-111-121 the three shapes, as a pure check of the numbers", () => {
  assert.deepEqual(checkSeq([1, 2, 3]), []);
  assert.deepEqual(
    checkSeq([1, 2, 4]).map((f) => f.kind),
    ["gap"],
  );
  assert.deepEqual(
    checkSeq([1, 2, 2]).map((f) => f.kind),
    ["repeat"],
  );
  assert.deepEqual(
    checkSeq([1, 5, 3]).map((f) => f.kind),
    ["gap", "fall"],
  );
  assert.deepEqual(
    checkSeq([2, 3]).map((f) => f.kind),
    ["gap"],
    "`seq` starts at 1 for each run; a file that starts at 2 has lost its head",
  );
  assert.deepEqual(checkSeq([]), [], "an empty file is not tampered with");
});

/* ------------------------------------------------------------------ *
 * The doctor warns.
 * ------------------------------------------------------------------ */

test("CT-111-121 the doctor WARNS and does not block the launch", () => {
  const file = soundFile();
  rewrite(file, (lines) => lines.filter((_, index) => index !== 2));
  const report = checkEventFile(file);
  const findings = doctorFindingsOf(report);
  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.ok(finding);
  assert.equal(finding.id, DOCTOR_FINDING_ID);
  assert.equal(finding.severity, "warn");
  assert.ok(
    (DOCTOR_SEVERITIES as readonly string[]).includes(finding.severity),
    "the severity is one of feature 100's",
  );
  assert.equal(finding.lb, false, "the finding is not launch-blocking: the run is not stopped");
  assert.ok(finding.message.length > 0 && finding.message.length <= 200);
  assert.ok(finding.fix.length > 0);
  // The evidence names the numbers and no content of any event.
  assert.ok(finding.evidence.includes("3"));
  assert.equal(report.doctorFindings.length, 1);
});

test("CT-111-121 the check of a file that is not there is no finding and no error", () => {
  const report = checkEventFile(join(workdir(), "nothing.jsonl"));
  assert.equal(report.tampered, false);
  assert.equal(report.checked, 0);
  assert.equal(report.stopsTheRun, false);
  assert.deepEqual(report.doctorFindings, []);
});

test("CT-111-121 a torn last line is not tampering", () => {
  const file = soundFile();
  writeFileSync(file, readFileSync(file, "utf8") + '{"schema":"specstride.event","v":1,"seq');
  const report = checkEventFile(file);
  assert.equal(report.tampered, false, "a half-written append is not a gap, a repeat or a fall");
  assert.equal(report.tornLastLine, true);
  assert.equal(report.stopsTheRun, false);
});
