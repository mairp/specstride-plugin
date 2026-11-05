/**
 * T014 — the tamper check, as a READER operation (F111-FR-021).
 *
 * *The event file MUST be in the control plane, in the location that the
 * logical name `run:<runId>:events` names. Tampering MUST be detected and not
 * prevented: a reader MUST find a gap, a repeat or a fall of `seq` and report
 * it, the doctor MUST warn, and the run MUST NOT be stopped.*
 *
 * It is a reader operation and nothing else: this module opens no lock, writes
 * no byte and returns no decision. It reads the file, compares the numbers and
 * hands back findings. Whoever asked decides what to do with them — and
 * F111-FR-021 fixes the only answer the product gives: WARN, do not stop.
 * `TAMPERING_STOPS_THE_RUN` is `false` as a constant so that a later change of
 * mind has to edit a line a test reads.
 *
 * Detection is by `seq` ALONE. The envelope of feature 100 carries no hash of
 * the previous record, so a chain cannot be checked; this is the reading
 * CQ-034 and the decision D-10 of `research.md`. What `seq` does catch is the
 * three shapes a hand leaves behind: a line removed (a GAP), a line copied (a
 * REPEAT), a number put back (a FALL).
 *
 * A TORN LAST LINE is not tampering: it is half of one append that a death
 * interrupted, which F111-FR-018 tells the reader to tolerate. It is reported
 * separately and gives no finding.
 */
import { LOGICAL_NAME } from "@specstride/contracts/envelope/event";
import type { DoctorSeverity } from "@specstride/contracts/codes/doctor-and-collisions";
import { FIRST_SEQ, readEvents } from "./seq.ts";

/** The location of the event file, as feature 100's table names it. */
export const EVENTS_LOGICAL_NAME = LOGICAL_NAME;

/** The logical name of the event file of one run. */
export function eventsLogicalNameOf(runId: string): string {
  return EVENTS_LOGICAL_NAME.replace("<runId>", runId);
}

/** F111-FR-021: tampering is detected, not prevented. */
export const TAMPERING_IS_PREVENTED = false as const;

/** F111-FR-021: the run is not stopped. */
export const TAMPERING_STOPS_THE_RUN = false as const;

/** The three shapes a `seq` that was tampered with takes. */
export const TAMPER_KINDS = ["gap", "repeat", "fall"] as const;
export type TamperKind = (typeof TAMPER_KINDS)[number];

/** One finding: what was expected at that position, and what was found. */
export type TamperFinding = {
  readonly kind: TamperKind;
  /** The position in the file, from 1. */
  readonly at: number;
  readonly expected: number;
  readonly found: number;
  readonly message: string;
};

function finding(kind: TamperKind, at: number, expected: number, found: number): TamperFinding {
  const what =
    kind === "gap"
      ? `a gap: ${found} follows ${expected - 1}`
      : kind === "repeat"
        ? `a repeat: ${found} is written twice`
        : `a fall: ${found} follows ${expected - 1}`;
  return Object.freeze({
    kind,
    at,
    expected,
    found,
    message: `line ${at} of the event file shows ${what}`,
  });
}

/**
 * The findings of a run of numbers (F111-FR-021). `seq` rises by one from 1,
 * so at each position the number that is expected is known; anything else is
 * one of the three shapes. An empty file is not tampered with.
 */
export function checkSeq(seqs: readonly number[]): readonly TamperFinding[] {
  const findings: TamperFinding[] = [];
  let expected = FIRST_SEQ;
  let previous: number | undefined;
  for (const [index, found] of seqs.entries()) {
    if (found === expected) {
      previous = found;
      expected = found + 1;
      continue;
    }
    if (previous !== undefined && found === previous) {
      findings.push(finding("repeat", index + 1, expected, found));
    } else if (found < expected) {
      findings.push(finding("fall", index + 1, expected, found));
    } else {
      findings.push(finding("gap", index + 1, expected, found));
    }
    previous = found;
    expected = found + 1;
  }
  return Object.freeze(findings);
}

/** One finding of the doctor (annex G §G.7): `id`, `severity`, `lb`, `message`, `fix`, `evidence`. */
export type DoctorFinding = {
  readonly id: string;
  readonly severity: DoctorSeverity;
  /** Launch-blocking. Always false here: the run is not stopped (F111-FR-021). */
  readonly lb: false;
  readonly message: string;
  readonly fix: string;
  readonly evidence: string;
};

/** The id of the doctor check that reports a tampered event file. */
export const DOCTOR_FINDING_ID = "events.seq_broken" as const;

/** The severity: the doctor WARNS (F111-FR-021). */
export const DOCTOR_SEVERITY: DoctorSeverity = "warn";

/** What a reader found in one event file. */
export type TamperReport = {
  readonly file: string;
  /** How many complete, readable events the file holds. */
  readonly checked: number;
  readonly findings: readonly TamperFinding[];
  readonly tampered: boolean;
  /** F111-FR-021: always false. */
  readonly stopsTheRun: false;
  /** True where the last line was half written: tolerated, and no finding. */
  readonly tornLastLine: boolean;
  readonly doctorFindings: readonly DoctorFinding[];
};

/**
 * The warning the doctor shows for a report (F111-FR-021). A sound file gives
 * none. The evidence names positions and numbers only: no event's content ever
 * enters a finding (F111-FR-016).
 */
export function doctorFindingsOf(report: TamperReport): readonly DoctorFinding[] {
  if (report.findings.length === 0) return Object.freeze([]);
  const kinds = [...new Set(report.findings.map((f) => f.kind))].join(", ");
  const where = report.findings
    .slice(0, 5)
    .map((f) => `line ${f.at}: expected ${f.expected}, found ${f.found}`)
    .join("; ");
  return Object.freeze([
    Object.freeze({
      id: DOCTOR_FINDING_ID,
      severity: DOCTOR_SEVERITY,
      lb: false as const,
      message:
        `the event file shows ${report.findings.length} break(s) of \`seq\` (${kinds}); ` +
        `the stream was changed after it was written`,
      fix:
        "read the run from a copy of the file that was not edited, or accept the gap; " +
        "the run is not stopped and nothing is repaired in place",
      evidence: `${EVENTS_LOGICAL_NAME}: ${where}`,
    }),
  ]);
}

/**
 * Check one event file (F111-FR-021). A file that is not there, or that cannot
 * be read, gives an empty report rather than an error: a reader never fails the
 * run (Principle V).
 */
export function checkEventFile(file: string): TamperReport {
  const read = readEvents(file);
  const findings = checkSeq(read.events.map((event) => event.seq));
  const report: TamperReport = Object.freeze({
    file,
    checked: read.events.length,
    findings,
    tampered: findings.length > 0,
    stopsTheRun: TAMPERING_STOPS_THE_RUN,
    tornLastLine: read.tornLastLine !== null,
    doctorFindings: Object.freeze([]),
  });
  return Object.freeze({ ...report, doctorFindings: doctorFindingsOf(report) });
}
