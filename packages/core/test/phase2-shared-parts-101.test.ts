/**
 * The shared parts of phase 2 of feature 101 — T012 to T018.
 *
 * | Deliverable | Requirement | Module |
 * |---|---|---|
 * | T012 the single writer of the records of the phase gate | F101-FR-028 | `src/gate/writers.ts` |
 * | T013 the nonce | F101-FR-006 | `src/gate/nonce.ts` |
 * | T014 signature, gist and reason of a feedback | F101-FR-019, F101-FR-012 | `src/gate/feedback.ts` |
 * | T015 the boundaries | F101-FR-040 | `src/engine/boundaries.ts` |
 * | T016 the terminal record and the end of the run | F101-FR-036 | `src/engine/terminal.ts` |
 * | T017 the emitters of the events and their as-is rows | F101-FR-038 | `src/gate/events.ts` |
 * | T018 the as-is lines | F101-FR-039 | `src/gate/lines.ts` |
 *
 * Every write is witnessed through an INDEPENDENT read path (`readFileSync`,
 * `readdirSync`, `statSync`) and never through the return value of the write,
 * and every record is validated against the schema of feature 100 rather than
 * compared with a shape this test invented.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { atomicWrite } from "@specstride/kernel/atomic-write";
import { canonicalRecordHash, contentHash } from "@specstride/kernel/hasher";
import { validate } from "@specstride/contracts/records/compile";
import { STOP_REASONS, isTransient } from "@specstride/contracts/codes/stop-reasons";

import {
  ATOMIC_WRITE_STEPS,
  RECORDS_OF_THE_PHASE_GATE,
  RECORDS_WHOSE_FAILED_WRITE_IS_A_WARNING,
  WRITERS,
  gateWriter,
  isWarning,
  temporaryNameFor,
} from "../src/gate/writers.ts";
import {
  NONCE_BITS,
  NONCE_BYTES,
  NONCE_LENGTH,
  isNonce,
  newNonce,
  withNonce,
} from "../src/gate/nonce.ts";
import {
  EMPTY_REPLY,
  GIST_MAX,
  REASON_MAX,
  criteriaOfAccelerationStart,
  feedbackHeading,
  feedbackLead,
  gistOf,
  reasonOf,
  idStandsInTheText,
  signatureHoldsTaskIds,
  signatureOfUnmetCriteria,
  taskIdsOf,
  unmetReportInstruction,
  unmetTaskIdsOfTheReport,
  withoutVerdictLines,
} from "../src/gate/feedback.ts";
import {
  BOUNDARIES,
  BOUNDARY_COUNT,
  OWNER_LOST,
  WHEN_THE_OWNER_IS_LOST,
  checkBoundaries,
  checkBoundary,
  stopped,
} from "../src/engine/boundaries.ts";
import {
  EXITS_WITHOUT_A_STOP_REASON,
  SCHEMA_ID as TERMINAL_SCHEMA_ID,
  WORK_OF_THE_END_OF_THE_RUN,
  endOfRunRegistry,
  endTheRun,
  retryableFor,
  terminalRecord,
  validatesAgainstTheSchema,
} from "../src/engine/terminal.ts";
import {
  AS_IS_EVENT_ROWS,
  EVENT_CATALOGUE_FILE,
  EVENTS_THAT_PROJECT_TO_NOTHING,
  FIELDS_THAT_CARRY_AN_EXCERPT,
  ForbiddenEventContentError,
  TYPES_EMITTED,
  emit,
  emitRow,
  holdsForbiddenContent,
  projectToAsIs,
  projectsToAnAsIsEvent,
  rowsOfType,
  typeOf,
} from "../src/gate/events.ts";
import * as lines from "../src/gate/lines.ts";

/** A sandbox on the real file system. */
function sandbox(): { dir: string; done(): void } {
  const dir = mkdtempSync(join(tmpdir(), "f101-phase2-"));
  return { dir, done: (): void => rmSync(dir, { recursive: true, force: true }) };
}

/** The service the composition root hands a core package (F100-FR-234). */
function service(): {
  write(path: string, content: string | Uint8Array): void;
  read(path: string): string;
  exists(path: string): boolean;
} {
  return {
    write: (path, content) => atomicWrite(path, content, { createDirectory: true }),
    read: (path) => readFileSync(path, "utf8"),
    exists: (path) => {
      try {
        statSync(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * T012 — the single writer of the records of the phase gate.
 * ------------------------------------------------------------------ */

test("T012: the writer names the two writers of the feature and no third (F101-FR-028)", () => {
  assert.deepEqual(
    [...WRITERS],
    ["packages/core/src/gate/writers.ts", "packages/core/src/approval/record.ts"],
  );
  // The import-boundary rule of T005 forbids both to every loop layer.
  const rule = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../../tools/import-boundary/rules/gate-writers.json"),
      "utf8",
    ),
  ) as { forbid: string[]; from: string[] };
  assert.deepEqual([...rule.forbid].sort(), [...WRITERS].sort());
  assert.ok(rule.from.length > 0, "the rule names the packages of the loop layers");
});

test("T012: every record of F101-FR-028 is written to a temporary name and renamed (effect witnessed)", () => {
  const box = sandbox();
  try {
    const writer = gateWriter(service());
    assert.deepEqual(
      [...ATOMIC_WRITE_STEPS],
      ["write-temporary-in-the-same-directory", "fsync", "rename"],
    );
    // One file per record of F101-FR-028: eleven names, twelve rows (the archive
    // at approval and the archived evidence are both files of the archive).
    const written: string[] = [];
    for (const [index, record] of RECORDS_OF_THE_PHASE_GATE.entries()) {
      const path = join(box.dir, "records", `record-${index}.txt`);
      const body = `the ${record}, written by T012\n`;
      const outcome = writer.text(record, path, body);
      // Witnessed through an independent read, not through the return value.
      assert.equal(readFileSync(path, "utf8"), body, record);
      assert.equal(statSync(path).isFile(), true, record);
      assert.equal(outcome.bytes, Buffer.byteLength(body, "utf8"), record);
      assert.equal(outcome.record, record);
      // A durable identity that could not exist before the write.
      assert.equal(
        createHash("sha256").update(readFileSync(path)).digest("hex"),
        contentHash(body),
        `${record}: the content hash of the bytes on disk is the hash of the body`,
      );
      written.push(`record-${index}.txt`);
      // The temporary name is a hidden sibling in the SAME directory.
      const temporary = temporaryNameFor(path);
      assert.equal(dirname(temporary), dirname(path), record);
      assert.match(temporary.slice(dirname(temporary).length + 1), /^\./, record);
    }
    // Every record landed, and no temporary name is left behind.
    const onDisk = readdirSync(join(box.dir, "records")).sort();
    assert.deepEqual(onDisk, written.sort());
    assert.equal(RECORDS_OF_THE_PHASE_GATE.length, 12);
  } finally {
    box.done();
  }
});

test("T012: a record written as JSON lands in the canonical form of the one hasher", () => {
  const box = sandbox();
  try {
    const writer = gateWriter(service());
    const path = join(box.dir, "verdict.json");
    const record = { b: 2, a: 1, nested: { y: true, x: null } };
    writer.json("verdict record", path, record);
    const text = readFileSync(path, "utf8");
    assert.equal(text.endsWith("\n"), true, "the file ends in a line end");
    // The bytes ON DISK are exactly the bytes the canonical record hash is taken
    // over: the canonical text plus the one line end. So the file and its hash
    // can never drift apart.
    assert.equal(contentHash(text), canonicalRecordHash(record));
    assert.equal(contentHash(readFileSync(path)), canonicalRecordHash(record));
    // And they parse back to the record.
    assert.deepEqual(JSON.parse(text), record);
  } finally {
    box.done();
  }
});

test("T012: a failed write of the verdict record or the feedback is a warning only (F101-FR-012)", () => {
  assert.deepEqual([...RECORDS_WHOSE_FAILED_WRITE_IS_A_WARNING], ["verdict record", "feedback"]);
  const failing = gateWriter({
    write: () => {
      throw new Error("the medium is full");
    },
    read: () => {
      throw new Error("not used");
    },
    exists: () => false,
  });
  for (const record of RECORDS_WHOSE_FAILED_WRITE_IS_A_WARNING) {
    const result = failing.tolerant(record, "/nowhere/at/all", "body");
    assert.equal(isWarning(result), true, record);
    if (isWarning(result)) {
      assert.match(result.message, /the medium is full/);
      assert.equal(result.record, record);
    }
  }
  // The strict path still throws: a record whose loss is not tolerated says so.
  assert.throws(() => failing.text("approval record", "/nowhere", "body"), /the medium is full/);
});

/* ------------------------------------------------------------------ *
 * T013 — the nonce. (CT-101-7 is the characterization test; these are the
 * facts F101-FR-006 adds over 002 FR-018.)
 * ------------------------------------------------------------------ */

test("T013: 8 bytes of the secure random source as 16 lower-case hexadecimal characters", async () => {
  assert.equal(NONCE_BYTES, 8);
  assert.equal(NONCE_BITS, 64);
  assert.equal(NONCE_LENGTH, 16);
  const held = await withNonce(async (holder) => holder.value());
  assert.equal(isNonce(held), true);
  assert.equal(held, held.toLowerCase());
  assert.notEqual(newNonce(), newNonce());
});

/* ------------------------------------------------------------------ *
 * T014 — the signature, the gist and the reason of a feedback.
 * ------------------------------------------------------------------ */

/** The ids the one grammar owner parsed for the phase (annex C §C.7, `SpecTask.id`). */
const KNOWN = ["T006", "T009", "T012", "T014", "T108"] as const;

/** The reader of the one grammar owner, as the composition root would wire it. */
const findTaskIds = (text: string): readonly string[] => text.match(/\bT\d+[A-Za-z]?\b/g) ?? [];

test("T014: the signature is the sorted list of task ids without repeats (F101-FR-019)", () => {
  const feedback = [
    "# Phase 2 — critic feedback (REJECTED)",
    "T014 is not met: the gist is not implemented.",
    "T012 is not substantiated.",
    "T014 again: still not met.",
    "T009 lacks a witness.",
  ].join("\n");
  // The ids come from the grammar owner; this module recognises them.
  assert.deepEqual([...taskIdsOf(feedback, { knownTaskIds: KNOWN })], ["T009", "T012", "T014"]);
  assert.equal(signatureOfUnmetCriteria(feedback, { knownTaskIds: KNOWN }), "T009,T012,T014");
  assert.equal(signatureHoldsTaskIds("T009,T012,T014"), true);
  // The order in the text does not matter; the signature is sorted.
  const reordered = "T014 and T009 and T012 are not met";
  assert.equal(signatureOfUnmetCriteria(reordered, { knownTaskIds: KNOWN }), "T009,T012,T014");
  // The reader of the grammar owner gives the as-is reading of the baseline, and
  // it also sees an id that is NOT a task of this phase.
  assert.equal(signatureOfUnmetCriteria("T999 and T012 are not met", { findTaskIds }), "T012,T999");
  assert.equal(
    signatureOfUnmetCriteria("T999 and T012 are not met", { knownTaskIds: KNOWN }),
    "T012",
    "without the reader of the grammar owner, only a task of this phase is recognised",
  );
});

test("T014: the unmet report — the ids the critic reports unmet, and only those", () => {
  // The feedback of a REAL critic (the dsh run of the narrowing fixture,
  // `results/step-2.done` reviewer's note), VERBATIM: it names T002 in its
  // prose to say the task STANDS, which the as-is signature reads as unmet.
  // The status lines it was told to write say which task is which.
  const feedbackOfARealCritic = [
    "# Phase 1 — critic feedback (REJECTED)",
    "",
    "The following must be addressed before re-writing GATE1-EVIDENCE.md:",
    "",
    "Judging each task against the evidence:",
    "",
    "- **T001: Unmet.** The implementer's own evidence shows `GO-AHEAD` does not exist (`cat: GO-AHEAD: No such file or directory`), and consequently `src/token.txt` was not written (`ls src` shows only `prep.js`). The task requires `src/token.txt` to hold exactly the trimmed content of `GO-AHEAD`; that condition cannot be satisfied without the marker, so the task remains open and the phase is not complete. (The implementer's restraint per R1 is correct behavior, but it does not make the task done.)",
    "- **T002: Met.** The working-tree diff shows `src/prep.js` exporting `ready()`, and the runtime test confirms it returns `true` in an ESM context. However, it is uncommitted and tasks.md is unticked — minor process gaps, but the code criterion itself is satisfied.",
    "",
    "Since T001 is unmet, phase 1 is not fully done.",
    "",
    "VERDICT d8294168ec310488: REJECTED",
    "",
  ].join("\n");
  // The same text through the ids of ANOTHER phase: no status line of those
  // ids stands in it, so the reader parses nothing and the caller falls back.
  assert.equal(unmetTaskIdsOfTheReport(feedbackOfARealCritic, { knownTaskIds: KNOWN }), undefined);
  // The same text through the ids of ITS phase (T001 and T002 are not of
  // KNOWN above; the caller hands in the phase's own ids).
  assert.deepEqual(
    unmetTaskIdsOfTheReport(feedbackOfARealCritic, { knownTaskIds: ["T001", "T002"] }),
    ["T001"],
    "the met task the critic names in prose is not in the set",
  );
  // The bare form, as the instruction teaches it.
  assert.deepEqual(
    unmetTaskIdsOfTheReport("T001: UNMET the test was not run.\nT002: MET\n", {
      knownTaskIds: ["T001", "T002"],
    }),
    ["T001"],
  );
  // No status line at all: prose only. The reader parses nothing; the caller
  // falls back and says so in an event.
  assert.equal(
    unmetTaskIdsOfTheReport("T001 is not met: the test was not run.", {
      knownTaskIds: ["T001", "T002"],
    }),
    undefined,
  );
  // A line that merely mentions the id is not a status line.
  assert.equal(
    unmetTaskIdsOfTheReport("Since T001 is unmet, phase 1 is not fully done.", {
      knownTaskIds: ["T001", "T002"],
    }),
    undefined,
  );
  // Every status line says MET: for a rejection that is no unmet set either.
  assert.equal(
    unmetTaskIdsOfTheReport("T001: MET\nT002: Met.\n", { knownTaskIds: ["T001", "T002"] }),
    undefined,
  );
  // An id that is no task of the phase is not recognised, with or without
  // the form (the ids come from the one grammar owner).
  assert.equal(
    unmetTaskIdsOfTheReport("T999: UNMET no such task\n", { knownTaskIds: ["T001", "T002"] }),
    undefined,
  );
  // A task line of a specification is not a status line.
  assert.equal(
    unmetTaskIdsOfTheReport("- [ ] T001 do it\n- [ ] T002 also do it\n", {
      knownTaskIds: ["T001", "T002"],
    }),
    undefined,
  );
  // The instruction names the form, so a prompt can teach it.
  assert.match(unmetReportInstruction(), /`<task id>: UNMET <one short reason>`/);
  assert.match(unmetReportInstruction(), /`<task id>: MET`/);
});

test("T014: this module holds no task-line grammar of its own (F104-SC-001)", () => {
  // The grammar of a specification has ONE owner, and the kernel's hasher is the
  // single named exception. A core package may import neither a grammar nor that
  // owner, so the source of this module holds no such pattern and imports only
  // the two packages the package graph allows a core package.
  const source = readFileSync(join(import.meta.dirname, "../src/gate/feedback.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(
    /T\\d\+/.test(code),
    false,
    "the code of feedback.ts holds no task-line pattern (the doc comment may name one)",
  );
  // Every import of the module, from the code and not from the prose.
  const imported = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string);
  assert.deepEqual(imported, ["@specstride/kernel/hasher"]);
  const graph = JSON.parse(
    readFileSync(join(import.meta.dirname, "../../contracts/data/package-graph.json"), "utf8"),
  ) as { packages: { name: string; mayImport?: string[]; forbidden?: string[] }[] };
  const core = graph.packages.find((entry) => entry.name === "@specstride/core");
  assert.notEqual(core, undefined);
  for (const specifier of imported) {
    const owner = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier;
    assert.ok(
      (core?.mayImport ?? []).includes(owner),
      `${specifier} is a package a core package may import`,
    );
  }
  // An id is recognised as a WHOLE token, so a shorter id never matches a longer.
  assert.equal(idStandsInTheText("T01", "T012 is not met"), false);
  assert.equal(idStandsInTheText("T012", "T012 is not met"), true);
  assert.equal(idStandsInTheText("T012", "- [ ] T012 do it"), true);
  assert.equal(idStandsInTheText("T012", "xT012"), false);
  assert.equal(idStandsInTheText("T012", "T012a"), false);
  assert.equal(idStandsInTheText("T012", "(T012)"), true);
  assert.equal(idStandsInTheText("T012", ""), false);
  assert.equal(idStandsInTheText("", "anything"), false);
  // An id that stands only later in the text is still found.
  assert.equal(idStandsInTheText("T012", "T0123 and then T012"), true);
});

test("T014: feedback without a task id gets `text:` and the hash of the canonical hasher (F101-FR-019)", () => {
  const feedback = "# Phase 2 — critic feedback (REJECTED)\nThe evidence is not substantiated.\n";
  const signature = signatureOfUnmetCriteria(feedback, { knownTaskIds: KNOWN });
  assert.match(signature, /^text:[0-9a-f]{64}$/);
  assert.equal(signatureHoldsTaskIds(signature), false);
  // The hash comes from the one hasher of the product, over the text WITHOUT
  // verdict lines — no feature hashes for itself (F104-FR-027).
  assert.equal(signature, `text:${contentHash(withoutVerdictLines(feedback))}`);
});

test("T014: the nonce of a call does not make equal feedback look new (F101-FR-019)", () => {
  const body = "The evidence is not substantiated.";
  const first = `${body}\nVERDICT 0123456789abcdef: REJECTED\n`;
  const second = `${body}\nVERDICT fedcba9876543210: REJECTED\n`;
  assert.notEqual(first, second, "the two feedbacks differ only in the nonce");
  assert.equal(
    signatureOfUnmetCriteria(first, { knownTaskIds: KNOWN }),
    signatureOfUnmetCriteria(second, { knownTaskIds: KNOWN }),
    "equal feedback with different nonces has ONE signature, so an oscillation can be found",
  );
  // And a feedback whose text really changed has a different signature.
  assert.notEqual(
    signatureOfUnmetCriteria(first, { knownTaskIds: KNOWN }),
    signatureOfUnmetCriteria(`something else entirely\nVERDICT 0123456789abcdef: REJECTED\n`, {
      knownTaskIds: KNOWN,
    }),
  );
  // Every kind of verdict line comes out, in every case and at any indent.
  for (const line of [
    "VERDICT 0123456789abcdef: APPROVED",
    "   verdict 0123456789abcdef : rejected",
    "\tVeRdIcT deadbeefdeadbeef: APPROVED",
  ]) {
    assert.equal(withoutVerdictLines(`${body}\n${line}\n`).includes("VERDICT"), false, line);
    assert.equal(
      withoutVerdictLines(`${body}\n${line}\n`).toUpperCase().includes("VERDICT"),
      false,
    );
  }
});

test("T014: `criteria` of accelerator_start is the signature without its last comma (B-0094)", () => {
  assert.equal(criteriaOfAccelerationStart("T009,T012,"), "T009,T012");
  assert.equal(criteriaOfAccelerationStart("T009,T012"), "T009,T012");
  assert.equal(criteriaOfAccelerationStart(""), "");
});

test("T014: the gist is chosen in the order F101-FR-019 gives (F101-FR-019)", () => {
  // 1. the first line that says something is not met / verified / substantiated.
  const first = [
    "# Phase 2 — critic feedback (REJECTED)",
    "> the reply was malformed",
    "The following must be addressed before re-writing GATE2-EVIDENCE.md:",
    "- check IR-01 FAILED",
    "Criterion T014 is NOT MET: no witness.",
  ].join("\n");
  assert.equal(gistOf(first, 2), "Criterion T014 is NOT MET: no witness.");
  for (const word of ["not met", "not verified", "not substantiated", "NOT MET", "Not Verified"]) {
    assert.equal(gistOf(`# heading\nthe thing is ${word} here`, 2), `the thing is ${word} here`);
  }

  // 2. else the first roster line of a failed or errored check.
  const second = [
    "# Phase 2 — critic feedback (REJECTED)",
    "The following must be addressed before re-writing GATE2-EVIDENCE.md:",
    "- CMD-abc FAILED exit 1",
    "- CMD-def passed",
  ].join("\n");
  assert.equal(gistOf(second, 2), "- CMD-abc FAILED exit 1");

  // 3. else the first line that is no heading, no quotation and not the lead.
  const third = [
    "# Phase 2 — critic feedback (REJECTED)",
    "> a quotation",
    "The following must be addressed before re-writing GATE2-EVIDENCE.md:",
    "Please cite the file.",
  ].join("\n");
  assert.equal(gistOf(third, 2), "Please cite the file.");

  // The cut.
  const long = `x${"y".repeat(400)} is not met`;
  assert.equal(gistOf(long, 2).length, GIST_MAX);
  // Nothing to choose: the empty text, never a line invented here.
  assert.equal(gistOf("", 2), "");
  assert.equal(gistOf("# only a heading\n> only a quotation", 2), "");
});

test("T014: the reason is the first non-verdict line, cut to 120, else the detail (F101-FR-012)", () => {
  assert.equal(
    reasonOf("- The evidence does not show T012.\nVERDICT 0123456789abcdef: REJECTED", "ok"),
    "The evidence does not show T012.",
  );
  // Leading list and heading marks come off.
  assert.equal(reasonOf("### A heading first", "ok"), "A heading first");
  assert.equal(reasonOf("  *  starred  ", "ok"), "starred");
  // A verdict line is never the reason.
  assert.equal(
    reasonOf("VERDICT 0123456789abcdef: REJECTED\nthe real reason", "ok"),
    "the real reason",
  );
  // The cut.
  assert.equal(reasonOf("z".repeat(400), "ok").length, REASON_MAX);
  // No such line: the detail of the parse.
  assert.equal(reasonOf("", "no verdict line found"), "no verdict line found");
  assert.equal(reasonOf(null, "no verdict line found"), "no verdict line found");
  assert.equal(
    reasonOf("VERDICT 0123456789abcdef: REJECTED", "multiple verdict lines (2)"),
    "multiple verdict lines (2)",
  );
});

test("T014: the as-is texts of a feedback (B-0879, B-0881)", () => {
  assert.equal(feedbackHeading(2, "REJECTED"), "# Phase 2 — critic feedback (REJECTED)");
  assert.equal(feedbackHeading(7, "MALFORMED"), "# Phase 7 — critic feedback (MALFORMED)");
  assert.equal(
    feedbackLead(2),
    "The following must be addressed before re-writing GATE2-EVIDENCE.md:",
  );
  assert.equal(EMPTY_REPLY, "(no critic output)");
});

/* ------------------------------------------------------------------ *
 * T015 — the boundaries.
 * ------------------------------------------------------------------ */

/** A lock whose `verify` answers as the test says, or throws. */
function lock(answer: boolean | "throw"): { verify(): Promise<boolean> } {
  return {
    verify: async (): Promise<boolean> => {
      if (answer === "throw") throw new Error("the provider of the lock failed");
      return answer;
    },
  };
}

const noStop = { requested: () => ({ stop: false }) };

test("T015: the six boundaries of F101-FR-040, in the order of the requirement", () => {
  assert.equal(BOUNDARY_COUNT, 6);
  assert.deepEqual(
    [...BOUNDARIES],
    [
      "before-a-phase-starts",
      "before-a-phase-attempt-starts",
      "before-the-verification-gate",
      "before-a-critic-class-call",
      "before-the-approval-record-is-written",
      "before-the-steps-after-an-approval",
    ],
  );
});

test("T015: a live owner clears every boundary", async () => {
  for (const boundary of BOUNDARIES) {
    const result = await checkBoundary(boundary, {
      lock: lock(true),
      token: "token",
      stopRequest: noStop,
    });
    assert.equal(stopped(result), false, boundary);
    assert.equal(result.boundary, boundary);
  }
});

test("T015: a lost owner stops every boundary with exit 6 and `stop_flag` (F101-FR-040, F100-FR-147)", async () => {
  for (const boundary of BOUNDARIES) {
    const result = await checkBoundary(boundary, {
      lock: lock(false),
      token: "token",
      stopRequest: noStop,
    });
    assert.equal(stopped(result), true, boundary);
    if (stopped(result)) {
      assert.equal(result.because, "owner-lost");
      assert.equal(result.outcome?.exitCode, 6);
      assert.equal(result.outcome?.stopReason, "stop_flag");
      assert.equal(result.outcome?.cause, "owner-lost");
      assert.equal(result.outcome?.causedBy, "crash");
      assert.equal(result.outcome?.retryable, false);
      assert.equal(result.outcome?.runsThePhaseGate, false);
    }
  }
  assert.equal(WHEN_THE_OWNER_IS_LOST.runsThePhaseGate, false);
  assert.equal(WHEN_THE_OWNER_IS_LOST.writesTheApprovalRecord, false);
  assert.equal(WHEN_THE_OWNER_IS_LOST.exitCode, OWNER_LOST.exitCode);
});

test("T015: a provider that fails in `verify` makes the engine treat the owner as lost (§F.5)", async () => {
  const result = await checkBoundary("before-a-critic-class-call", {
    lock: lock("throw"),
    token: "token",
    stopRequest: noStop,
  });
  assert.equal(stopped(result), true);
  if (stopped(result)) {
    assert.equal(result.because, "verify-failed");
    assert.equal(result.outcome?.exitCode, 6);
    assert.equal(result.outcome?.cause, "owner-lost");
  }
});

test("T015: the stop request is read at the boundary, after the lease", async () => {
  const result = await checkBoundary("before-a-phase-starts", {
    lock: lock(true),
    token: "token",
    stopRequest: { requested: () => ({ stop: true, reason: "the operator asked" }) },
  });
  assert.equal(stopped(result), true);
  if (stopped(result)) {
    assert.equal(result.because, "stop-requested");
    assert.equal(result.stopReasonGiven, "the operator asked");
    assert.equal(result.outcome, undefined, "a clean stop is not the owner-lost outcome");
  }
  // A lost owner outranks a stop request: the stronger fact decides the exit.
  const both = await checkBoundary("before-a-phase-starts", {
    lock: lock(false),
    token: "token",
    stopRequest: { requested: () => ({ stop: true }) },
  });
  assert.equal(stopped(both) && both.because, "owner-lost");
});

test("T015: the boundaries stop at the FIRST one that fails, so no later gate runs", async () => {
  let verifies = 0;
  const counting = {
    verify: async (): Promise<boolean> => {
      verifies += 1;
      return false;
    },
  };
  const result = await checkBoundaries(BOUNDARIES, {
    lock: counting,
    token: "token",
    stopRequest: noStop,
  });
  assert.equal(stopped(result), true);
  assert.equal(result.boundary, BOUNDARIES[0]);
  assert.equal(verifies, 1, "the second boundary was never reached");
});

/* ------------------------------------------------------------------ *
 * T016 — the terminal record and the work of the end of the run.
 * ------------------------------------------------------------------ */

const STOP_BASE = {
  runId: "run-1",
  launchId: "launch-1",
  engineStartId: "engine-1",
  at: "2026-10-03T12:00:00.000Z",
} as const;

test("T016: every stop reason of §E.3 gives a record that validates against specstride.terminal/1", () => {
  for (const stopReason of STOP_REASONS) {
    const record = terminalRecord({
      ...STOP_BASE,
      exitCode: 2,
      stopReason,
      cause: "normal",
      causedBy: "self",
      phase: 3,
      attemptId: "attempt-3-1-1",
    });
    assert.equal(record.schema, TERMINAL_SCHEMA_ID);
    assert.equal(
      validatesAgainstTheSchema(record),
      true,
      `${stopReason}: ${JSON.stringify(validate(record))}`,
    );
  }
});

test("T016: an exit with no member of the enumeration carries no stop reason (CQ-174)", () => {
  for (const exitCode of EXITS_WITHOUT_A_STOP_REASON) {
    const record = terminalRecord({
      ...STOP_BASE,
      exitCode,
      stopReason: null,
      cause: exitCode === 70 ? "crash" : "normal",
      causedBy: exitCode === 70 ? "crash" : "self",
      retryable: true,
    });
    assert.equal(record.stopReason, null, `exit ${exitCode} carries no stop reason`);
    assert.equal(record.retryable, false, `exit ${exitCode} is not retryable`);
    assert.equal(validatesAgainstTheSchema(record), true, `exit ${exitCode}`);
  }
});

test("T016: `retryable` is decided for the one stop and never true for a stop that is not transient (F101-FR-036)", () => {
  for (const stopReason of STOP_REASONS) {
    // Even when the caller asks for true, a stop reason that is not transient
    // can never be relaunched.
    assert.equal(
      retryableFor(stopReason, true),
      isTransient(stopReason),
      `${stopReason}: asked for true`,
    );
    // And a caller that decided false is believed, whatever the attribute says.
    assert.equal(retryableFor(stopReason, false), false, `${stopReason}: asked for false`);
    assert.equal(retryableFor(stopReason, undefined), false, `${stopReason}: not decided`);
  }
  assert.equal(retryableFor(null, true), false);
  // At least one transient reason exists, so the test is not vacuous.
  assert.ok(
    STOP_REASONS.some((r) => isTransient(r)),
    "some stop reason of §E.3 is transient",
  );
  assert.ok(
    STOP_REASONS.some((r) => !isTransient(r)),
    "some stop reason of §E.3 is not",
  );
});

test("T016: a blocked run carries its reason and what is needed (F101-FR-036)", () => {
  const record = terminalRecord({
    ...STOP_BASE,
    exitCode: 4,
    stopReason: "paused_quota_ceiling",
    cause: "normal",
    causedBy: "self",
    blocked: { reason: "quota-wait-ceiling", needed: "a person raises the quota" },
  });
  assert.deepEqual(record.blocked, {
    reason: "quota-wait-ceiling",
    needed: "a person raises the quota",
  });
  assert.equal(validatesAgainstTheSchema(record), true);
  // A field that does not apply is ABSENT, never null (annex B, §B.4).
  const plain = terminalRecord({
    ...STOP_BASE,
    exitCode: 0,
    stopReason: null,
    cause: "normal",
    causedBy: "self",
  });
  assert.equal(Object.hasOwn(plain, "blocked"), false);
  assert.equal(Object.hasOwn(plain, "phase"), false);
  assert.equal(Object.hasOwn(plain, "attemptId"), false);
});

test("T016: the record is written before the work, and the work runs in the order of registration (F101-FR-036)", async () => {
  const box = sandbox();
  try {
    const path = join(box.dir, "terminal.json");
    const order: string[] = [];
    const registry = endOfRunRegistry();
    // Registered in an order that is NOT the order of the list of three, to
    // show the order of REGISTRATION is what counts.
    registry.register({
      name: "summarize-learning",
      run: () => {
        order.push("summarize-learning");
      },
    });
    registry.register({
      name: "release-the-lock-in-standalone",
      run: () => {
        // A step that fails must not keep the others from running.
        order.push("release-the-lock-in-standalone");
        throw new Error("the lock was already gone");
      },
    });
    registry.register({
      name: "end-the-presenter",
      run: async () => {
        order.push("end-the-presenter");
      },
    });

    const outcome = await endTheRun(
      {
        ...STOP_BASE,
        exitCode: 0,
        stopReason: null,
        cause: "normal",
        causedBy: "self",
      },
      path,
      service(),
      registry.steps,
    );

    // The record is on disk, witnessed through an independent read, and valid.
    const onDisk = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(onDisk.schema, TERMINAL_SCHEMA_ID);
    assert.equal(validate(onDisk).ok, true);
    assert.deepEqual(onDisk, JSON.parse(JSON.stringify(outcome.record)));

    // Every step ran, in the order of registration, and the failure of one did
    // not stop the others.
    assert.deepEqual(order, [
      "summarize-learning",
      "release-the-lock-in-standalone",
      "end-the-presenter",
    ]);
    assert.equal(outcome.everyStepRan, true);
    assert.deepEqual(
      outcome.steps.map((s) => [s.name, s.registeredAt, s.failed !== undefined]),
      [
        ["summarize-learning", 1, false],
        ["release-the-lock-in-standalone", 2, true],
        ["end-the-presenter", 3, false],
      ],
    );
    assert.match(outcome.steps[1]?.failed ?? "", /the lock was already gone/);
    // The three steps F101-FR-036 names are the ones a standalone run registers.
    assert.deepEqual(
      [...WORK_OF_THE_END_OF_THE_RUN].sort(),
      outcome.steps.map((s) => s.name).sort(),
    );
  } finally {
    box.done();
  }
});

/* ------------------------------------------------------------------ *
 * T017 — the emitters of the events and their as-is rows.
 * ------------------------------------------------------------------ */

test("T017: the table of as-is events holds every row of the spec, with its item", () => {
  const expected = [
    ["run_start", "B-0086"],
    ["phase_start", "B-0093"],
    ["critic_start", "B-0855"],
    ["verdict", "B-0858"],
    ["verdict", "B-0859"],
    ["reject", "B-0105"],
    ["critic_malformed", "B-0106"],
    ["gate_oscillation", "B-0107"],
    ["attempt_archived", "B-0090"],
    ["diagnostician_trigger", "B-0089"],
    ["diagnostician_start", "B-0851"],
    ["diagnostician_done", "B-0853"],
    ["diagnostician_error", "B-0852"],
    ["accelerator_start", "B-0094"],
    ["acceleration_note", "B-0098"],
    ["phase_done", "B-0102"],
    ["tasks_ticked", "B-0103"],
    ["git_checkpoint", "B-0088"],
    ["run_stop", "B-0151 to B-0154"],
    ["run_end", "B-0141, B-0155"],
  ];
  assert.deepEqual(
    AS_IS_EVENT_ROWS.map((row) => [row.asIs, row.item]),
    expected,
  );
  // The as-is fields of a few rows, in the order of the table.
  assert.deepEqual([...rowsOfType("critic.started")[0]!.fields], ["phase", "attempt", "provider"]);
  assert.deepEqual(
    [...rowsOfType("gate.oscillation")[0]!.fields],
    ["phase", "attempt", "criterion", "reappears"],
  );
  assert.deepEqual([...rowsOfType("tasks.ticked")[0]!.fields], ["phase", "count"]);
  // `verdict` has two rows: one approving and one not.
  const verdictRows = rowsOfType("verdict.recorded");
  assert.equal(verdictRows.length, 2);
  assert.deepEqual([...verdictRows[0]!.fields], ["phase", "attempt", "result", "title"]);
  assert.deepEqual(
    [...verdictRows[1]!.fields],
    ["phase", "attempt", "result", "reason", "title", "max_rejects"],
  );
});

test("T017: the typing note of D-25 is kept per row", () => {
  // The engine script wrote every value as text; the critic module wrote typed
  // values. The projection keeps both.
  const engineScript = AS_IS_EVENT_ROWS.filter((r) => r.writer === "engine-script");
  const criticModule = AS_IS_EVENT_ROWS.filter((r) => r.writer === "critic-module");
  assert.ok(engineScript.length > 0 && criticModule.length > 0);
  for (const row of engineScript) assert.equal(row.typing, "every-value-as-text", row.asIs);
  for (const row of criticModule) assert.equal(row.typing, "typed-values", row.asIs);
  // An engine-script row renders its values as text.
  const ticked = rowsOfType("tasks.ticked")[0]!;
  assert.deepEqual(projectToAsIs(ticked, { phase: 2, count: 7 }), {
    event: "tasks_ticked",
    fields: { phase: "2", count: "7" },
  });
  // A critic-module row keeps them typed.
  const start = rowsOfType("critic.started")[0]!;
  assert.deepEqual(projectToAsIs(start, { phase: 2, attempt: 1, provider: "p" }), {
    event: "critic_start",
    fields: { phase: 2, attempt: 1, provider: "p" },
  });
});

test("T017: `run_end` goes without `phases` where every phase was approved before (B-0141)", () => {
  const row = rowsOfType("run.ended").find((r) => r.asIs === "run_end")!;
  assert.deepEqual(projectToAsIs(row, { outcome: "all_approved", phases: 3 }), {
    event: "run_end",
    fields: { outcome: "all_approved", phases: "3" },
  });
  assert.deepEqual(projectToAsIs(row, { outcome: "all_approved" }), {
    event: "run_end",
    fields: { outcome: "all_approved" },
  });
});

test("T017: the events with no as-is equivalent project to nothing", () => {
  assert.deepEqual(
    [...EVENTS_THAT_PROJECT_TO_NOTHING],
    ["verdict.adjudicated", "critic.grounding_gap", "integrity.noted", "blocked"],
  );
  for (const type of EVENTS_THAT_PROJECT_TO_NOTHING) {
    assert.equal(projectsToAnAsIsEvent(type), false, type);
  }
  for (const row of AS_IS_EVENT_ROWS) {
    assert.equal(projectsToAnAsIsEvent(typeOf(row)), true, typeOf(row));
  }
});

test("T017: every type this feature emits is a row of the event catalogue of feature 111", () => {
  // The catalogue is the ONE source of the event types (F101-FR-038, row 73 of
  // annex X §X.6). This feature names a type only as the two parts of a row of
  // that catalogue, and the join must be found there — so a drift of either side
  // is a failing test and not a silent divergence.
  const tsv = readFileSync(join(import.meta.dirname, "../../..", EVENT_CATALOGUE_FILE), "utf8");
  const catalogued = new Set(
    tsv
      .split("\n")
      .slice(1)
      .map((line) => line.split("\t")[0]?.trim() ?? "")
      .filter((type) => type !== ""),
  );
  assert.ok(catalogued.size > 50, `the catalogue holds ${catalogued.size} types`);
  assert.ok(TYPES_EMITTED.length >= 20, `${TYPES_EMITTED.length} types are emitted`);
  for (const type of TYPES_EMITTED) {
    assert.equal(catalogued.has(type), true, `${type} is a row of ${EVENT_CATALOGUE_FILE}`);
  }
  // And the as-is fields of a row are drawn from the `data` fields of its
  // catalogue row or are an as-is renaming of one; the count never grows beyond
  // what the catalogue carries.
  const dataFieldsOf = new Map<string, number>();
  for (const line of tsv.split("\n").slice(1)) {
    const parts = line.split("\t");
    const type = parts[0]?.trim();
    if (type === undefined || type === "") continue;
    dataFieldsOf.set(type, (parts[3] ?? "").split(",").filter((f) => f !== "").length);
  }
  for (const row of AS_IS_EVENT_ROWS) {
    const carried = dataFieldsOf.get(typeOf(row));
    assert.notEqual(carried, undefined, typeOf(row));
    assert.ok(
      row.fields.length <= (carried ?? 0),
      `${row.asIs}: ${row.fields.length} as-is fields, ${String(carried)} in the catalogue`,
    );
  }
});

test("T017: a type with two as-is forms says under which condition each applies", () => {
  // `verdict.recorded` has one row for an approval and one for a rejection;
  // `attempt.started` projects to `accelerator_start` only for an accelerated
  // phase attempt, and to nothing for a phase attempt of the proposer.
  const byType = new Map<string, number>();
  for (const row of AS_IS_EVENT_ROWS) {
    byType.set(typeOf(row), (byType.get(typeOf(row)) ?? 0) + 1);
  }
  for (const [type, count] of byType) {
    if (count === 1) continue;
    for (const row of rowsOfType(type)) {
      assert.notEqual(
        row.onlyWhen,
        undefined,
        `${row.asIs} shares the type ${type}, so it names its condition`,
      );
    }
  }
  assert.equal(byType.get("verdict.recorded"), 2);
  assert.equal(byType.get("run.ended"), 2);
  // `emitRow` emits with the row's own type, so a caller cannot pick another.
  const envelope = emitRow(rowsOfType("gate.oscillation")[0]!, {
    seq: 9,
    ts: STOP_BASE.at,
    identity: { runId: "run-1", launchId: "launch-1" },
    data: { phase: 2, attempt: 4, criterion: "T012", reappears: 2 },
  });
  assert.equal(envelope.type, "gate.oscillation");
});

test("T017: no event holds a nonce, a prompt or a reply in full (F101-FR-038, T-05)", () => {
  const identity = { runId: "run-1", launchId: "launch-1" };
  // An event the requirement allows.
  const ok = emit({
    type: "phase.start",
    seq: 1,
    ts: STOP_BASE.at,
    identity,
    data: { phase: 2, title: "Foundational", total: 8 },
  });
  assert.equal(ok.type, "phase.start");
  assert.equal(ok.schema, "specstride.event");
  assert.equal(ok.v, 1);
  assert.deepEqual(ok.data, { phase: 2, title: "Foundational", total: 8 });

  // The forbidden keys.
  for (const key of ["nonce", "prompt", "reply", "promptText", "replyText"]) {
    assert.equal(holdsForbiddenContent({ [key]: "x" }), key);
    assert.throws(
      () =>
        emit({ type: "critic.start", seq: 2, ts: STOP_BASE.at, identity, data: { [key]: "x" } }),
      ForbiddenEventContentError,
      key,
    );
  }
  // A nonce smuggled under another key is caught by its shape.
  const smuggled = { token: "0123456789abcdef" };
  assert.match(holdsForbiddenContent(smuggled) ?? "", /^token \(a value in the form of a nonce\)$/);
  assert.throws(
    () => emit({ type: "critic.start", seq: 3, ts: STOP_BASE.at, identity, data: smuggled }),
    ForbiddenEventContentError,
  );
  // A real nonce of a call, under any key, cannot be emitted.
  assert.throws(
    () =>
      emit({
        type: "verdict.recorded",
        seq: 4,
        ts: STOP_BASE.at,
        identity,
        data: { whatever: newNonce() },
      }),
    ForbiddenEventContentError,
  );
  // The three fields that carry an excerpt are named, so a caller knows which
  // values must have passed the one ingress (F101-FR-052).
  assert.deepEqual([...FIELDS_THAT_CARRY_AN_EXCERPT], ["reason", "error", "note"]);
  for (const field of FIELDS_THAT_CARRY_AN_EXCERPT) {
    const row = AS_IS_EVENT_ROWS.find((r) => r.fields.includes(field));
    assert.notEqual(row, undefined, `${field} is an as-is field of some row`);
  }
});

/* ------------------------------------------------------------------ *
 * T018 — the as-is lines.
 * ------------------------------------------------------------------ */

test("T018: every line of the table, byte for byte (F101-FR-039)", () => {
  assert.equal(lines.allPhasesAlreadyApproved(), "# All phases already approved. Nothing to do.");
  assert.equal(
    lines.phaseStart(2, "Foundational", "12:00:00"),
    "===== PHASE 2 — Foundational  (12:00:00) =====",
  );
  assert.equal(lines.criticStart(2, 1, "claude"), "----- critic: phase 2 attempt 1 (claude) -----");
  assert.equal(lines.phaseApproved(2, 3), "===== PHASE 2 APPROVED (attempt 3) =====");
  assert.equal(
    lines.tasksTicked(7, 2, "specs/101/tasks.md"),
    "      ticked 7 task checkbox(es) of phase 2 in specs/101/tasks.md",
  );
  assert.equal(
    lines.tasksNotTicked(2, "specs/101/tasks.md"),
    "      WARN: could not tick phase 2 task checkboxes in specs/101/tasks.md (approval stands)",
  );
  assert.equal(lines.gitCheckpoint(2), "----- git checkpoint: phase 2 approved -----");
  assert.equal(lines.criticConfigError(), ">>> critic config/usage error (exit 3) — halting.");
  assert.equal(lines.phaseRejected(2, 3, 8), "----- phase 2 REJECTED on attempt 3/8 -----");
  assert.equal(
    lines.criticNoUsableVerdict(3, 3),
    ">>> critic returned no usable verdict (MALFORMED 3/3)",
  );
  assert.equal(
    lines.diagnosticianStart(2, 4),
    "----- diagnostician: phase 2 attempt 4 (unmet set changed) -----",
  );
  assert.equal(
    lines.acceleratorStart(2, 5, 8, "codex", "T012,T014"),
    "----- accelerator: phase 2 attempt 5/8 (codex) — acting on the hint for T012,T014 -----",
  );
  assert.equal(lines.done(3, "12:00:00"), "# DONE — all 3 phase(s) approved. 12:00:00");
  assert.equal(lines.theOneWordOfTheCriticCall("MALFORMED"), "MALFORMED");
  assert.equal(lines.hintWritten(), "HINT-WRITTEN");
  assert.equal(lines.FILE_DUMP_MARKERS.begin("a.ts"), "----- BEGIN a.ts -----");
  assert.equal(lines.FILE_DUMP_MARKERS.end("a.ts"), "----- END a.ts -----");
  // Not one of these lines carries a line end: the log writer adds it.
  for (const line of [
    lines.allPhasesAlreadyApproved(),
    lines.phaseStart(1, "t", "0"),
    lines.done(1, "0"),
    lines.hintWritten(),
  ]) {
    assert.equal(line.includes("\n"), false, JSON.stringify(line));
  }
});

test("T018: a critic-class warning or fatal carries the logical component name `critic` (B-0883)", () => {
  assert.equal(lines.CRITIC_COMPONENT, "critic");
  assert.equal(lines.warning("the reply was empty"), "critic: WARN: the reply was empty");
  assert.equal(lines.fatal("no credential"), "critic: FATAL: no credential");
  // The baseline named the implementation file; the new line names the component.
  for (const line of [lines.warning("x"), lines.fatal("x")]) {
    assert.equal(line.startsWith("critic:"), true, line);
    assert.equal(/critic\.py|\.ts\b/.test(line), false, `${line} names no implementation file`);
  }
});

test("T018: the halt banner of B-0231, framed by lines of `#`", () => {
  const full = lines.haltBanner({
    phase: 2,
    maxRejects: 8,
    latestEvidence: "gates/GATE2-EVIDENCE.md",
    latestFeedback: "gates/GATE2-FEEDBACK.md",
    diagnosticianHint: "gates/GATE2-HINT.md",
    accelerationNote: "gates/GATE2-ACCEL.md",
    attemptHistory: "8 attempts",
    rejectionTrail: ["attempt 1: T012", "attempt 2: T012"],
  });
  assert.equal(full[0], lines.BANNER_FRAME);
  assert.equal(full.at(-1), lines.BANNER_FRAME);
  assert.match(full[0] ?? "", /^#+$/);
  assert.equal(full[1], "# HALT — phase 2 exceeded MAX_REJECTS (8). Human needed.");
  const body = full.join("\n");
  for (const section of lines.BANNER_SECTIONS) {
    assert.ok(body.includes(section), `the banner holds "${section}"`);
  }
  assert.ok(body.includes("attempt 1: T012"), "the rejection trail is in the banner");

  // The two optional sections are absent where they do not apply.
  const lean = lines.haltBanner({
    phase: 2,
    maxRejects: 8,
    latestEvidence: "e",
    latestFeedback: "f",
    attemptHistory: "h",
    rejectionTrail: [],
  });
  const leanBody = lean.join("\n");
  for (const optional of lines.OPTIONAL_BANNER_SECTIONS) {
    assert.equal(
      leanBody.includes(optional),
      false,
      `"${optional}" is absent where it does not apply`,
    );
  }
  assert.ok(leanBody.includes("attempt history"), "the required sections stand");
});

test("T018: under the `parity` profile nothing without an as-is equivalent is printed (F101-FR-039)", () => {
  assert.equal(lines.PRINTS_A_LINE_WITHOUT_AN_AS_IS_EQUIVALENT_UNDER_PARITY, false);
  assert.equal(lines.AS_IS_LINE_COUNT, 18);
  assert.equal(lines.AS_IS_LINE_IDS.length, lines.AS_IS_LINE_COUNT);
  for (const id of lines.AS_IS_LINE_IDS) assert.equal(lines.hasAnAsIsEquivalent(id), true, id);
  for (const id of ["a-line-of-our-own", "", "phase-start-v2"]) {
    assert.equal(lines.hasAnAsIsEquivalent(id), false, id);
  }
  // Every row names its behaviour item, so the oracle can find the evidence line.
  for (const row of lines.AS_IS_LINES) {
    assert.match(row.item, /^B-\d{4}/, row.id);
    assert.ok(row.when.length > 0, row.id);
  }
  assert.deepEqual(lines.NORMALIZATION_RULES, { paths: "N-02", times: "N-04" });
});
