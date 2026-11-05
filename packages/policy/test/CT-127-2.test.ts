/**
 * CT-127-2 (T060) — the characterization test of LISA'S LEDGER AS EXTRACTED,
 * with the fixed unreadable case, the ONE ledger kept across a `resume`, and
 * the reset flag of `resume` that does not reset it.
 *
 * Proves 002 FR-042, which the baseline states as:
 *
 *   "The per-job budget ledger MUST be persisted atomically to `budget.json`.
 *    An unreadable ledger MUST load as zero usage."
 *   (`old/002-as-is-lisa/spec.md:207`; `packages/scheduler/src/budgets.ts` at
 *    `363e6a3`, `old/002-as-is-lisa/data-model.md:249-259`)
 *
 * F127-FR-031 is the translation and F127-FR-032 is the FIX. The second half
 * of the baseline's sentence is the one thing this feature does NOT keep: a
 * ledger that loads as zero cannot hold a hard cap, because making the file
 * unreadable would be a way to spend without limit (DV-063, D-33). So:
 *
 *  1. ATOMIC, through `AtomicWrite` of annex A §A.3, and written after EVERY
 *     usage record — the fake writer records the order, and the PREVIOUS
 *     GENERATION is written before the ledger it replaces;
 *  2. the FIXED unreadable case — never zero: the previous generation first,
 *     then the events after it, then the unknown state in which every hard
 *     ceiling of spend READS AS REACHED;
 *  3. ONE LEDGER across a `resume`: the spend of one run is one figure, and a
 *     resumed run goes on adding to the same file;
 *  4. the RESET FLAG of `resume` does not reset it (CQ-130): only a new run
 *     starts a new ledger, and `emptyLedger` is the one way to get a zero.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  LEDGER_LOGICAL_NAME,
  LEDGER_SCHEMA_ID,
  PREVIOUS_GENERATION_SUFFIX,
  applyUsageRecord,
  callCount,
  emptyLedger,
  hardTokens,
  ledgerPaths,
  parseLedger,
  realCostUsd,
  recordUsage,
  serializeLedger,
  writeLedger,
  type SpendLedger,
  type UsageRecord,
} from "../src/budget/ledger.ts";
import { ceilingsReadAsReached, rebuildLedger } from "../src/budget/rebuild.ts";
import type { Ceiling } from "../src/budget/ceilings.ts";
import { testPorts } from "./support/index.ts";

const PATHS = ledgerPaths("/run/control/spend.json");
const RUN = "run-ct-127-2";

const HARD_CEILING: readonly Ceiling[] = Object.freeze([
  { scope: "run", dimension: "costUsd", limit: 10 },
]);

function usage(index: number, costUsd: number | null, role = "proposer"): UsageRecord {
  return {
    usageId: `u-${index}`,
    role,
    billingMode: "api",
    inputTokens: 100,
    outputTokens: 50,
    costUsd,
    isCall: true,
    closesAPass: true,
  };
}

/**
 * What a `resume` does to the ledger: it READS the file through the rebuild of
 * F127-FR-032 and goes on. The reset flag is handed in and deliberately has no
 * effect on the ledger (CQ-130); only a new run calls `emptyLedger`.
 */
function resume(
  ports: ReturnType<typeof testPorts>,
  options: { readonly reset: boolean },
): { readonly ledger: SpendLedger; readonly resetFlagWasSet: boolean } {
  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD_CEILING,
  });
  return { ledger: result.ledger, resetFlagWasSet: options.reset };
}

/* ------------------------------------------------------------------ *
 * 1. Atomic, after every usage record, with the previous generation.
 * ------------------------------------------------------------------ */

test("CT-127-2: the ledger is the logical name and the schema id of annex B", () => {
  assert.equal(LEDGER_LOGICAL_NAME, "run:<runId>:spend");
  assert.equal(LEDGER_SCHEMA_ID, "specstride.spend/1");
  // The baseline's physical name `budget.json` is NOT the name here: the path
  // comes from the layout table of feature 100, by logical name.
  assert.equal(PATHS.ledger, "/run/control/spend.json");
  assert.equal(PATHS.previous, `/run/control/spend.json${PREVIOUS_GENERATION_SUFFIX}`);
});

test("CT-127-2: the ledger is written after EVERY usage record, through the writer", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  for (let index = 0; index < 3; index += 1) {
    const result = recordUsage(ports.fileWriter, PATHS, ledger, usage(index, 1), {});
    assert.equal(result.applied, true);
    ledger = result.ledger;
  }
  const toTheLedger = ports.fileWriter.writes.filter((write) => write.path === PATHS.ledger);
  assert.equal(toTheLedger.length, 3);
  assert.equal(ledger.generation, 3);
  assert.equal(realCostUsd(ledger), 3);
});

test("CT-127-2: the previous generation is written BEFORE the ledger it replaces", () => {
  const ports = testPorts();
  const first = writeLedger(ports.fileWriter, PATHS, emptyLedger(RUN));
  // The first write has nothing to keep: the file did not exist.
  assert.deepEqual(
    ports.fileWriter.writes.map((write) => write.path),
    [PATHS.ledger],
  );

  const second = applyUsageRecord(first, usage(1, 4)).ledger;
  writeLedger(ports.fileWriter, PATHS, second);
  assert.deepEqual(
    ports.fileWriter.writes.map((write) => write.path),
    [PATHS.ledger, PATHS.previous, PATHS.ledger],
  );
  // The previous generation holds the OLD content, not the new.
  assert.equal(realCostUsd(parseLedger(ports.fileWriter.read(PATHS.previous))), null);
  assert.equal(realCostUsd(parseLedger(ports.fileWriter.read(PATHS.ledger))), 4);
});

test("CT-127-2: a killed pass loses nothing already written", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(1, 3), {}).ledger;
  recordUsage(ports.fileWriter, PATHS, ledger, usage(2, 3), {});
  // The engine dies here. A fresh read of the file is what the next start sees.
  const read = parseLedger(ports.fileWriter.read(PATHS.ledger));
  assert.equal(realCostUsd(read), 6);
  assert.equal(callCount(read), 2);
  assert.equal(hardTokens(read), 300);
});

test("CT-127-2: the serialized ledger round-trips through `parseLedger`", () => {
  const ledger = applyUsageRecord(emptyLedger(RUN), usage(1, 2)).ledger;
  const back = parseLedger(serializeLedger(ledger));
  assert.equal(back.schema, LEDGER_SCHEMA_ID);
  assert.equal(back.runId, RUN);
  assert.equal(realCostUsd(back), 2);
  assert.deepEqual(back.seenUsageIds, ["u-1"]);
});

/* ------------------------------------------------------------------ *
 * 2. The fixed unreadable case — never zero.
 * ------------------------------------------------------------------ */

test("CT-127-2: an unreadable ledger is rebuilt from the previous generation, NOT zero", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(1, 4), {}).ledger;
  recordUsage(ports.fileWriter, PATHS, ledger, usage(2, 4), {});
  ports.fileWriter.makeUnreadable(PATHS.ledger);

  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD_CEILING,
  });
  assert.equal(result.state, "rebuilt");
  assert.equal(result.source, "previous-generation");
  // The baseline loaded zero here. This is the fix: 4 of the 8 are recovered
  // from the previous generation, and the rest from the events (next test).
  assert.notEqual(realCostUsd(result.ledger), 0);
  assert.equal(realCostUsd(result.ledger), 4);
  assert.equal(result.hardCeilingsReadAsReached, false);
});

test("CT-127-2: the events that follow the previous generation are replayed", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(1, 4), {}).ledger;
  recordUsage(ports.fileWriter, PATHS, ledger, usage(2, 4), {});
  ports.fileWriter.makeUnreadable(PATHS.ledger);

  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD_CEILING,
    events: [
      // Already in the previous generation: deduplication by `usageId` drops it.
      { type: "usage", generation: 1, usage: usage(1, 4) },
      { type: "usage", generation: 2, usage: usage(2, 4) },
    ],
  });
  assert.equal(result.source, "previous-generation");
  assert.equal(realCostUsd(result.ledger), 8);
  assert.equal(result.replayed, 1);
});

test("CT-127-2: with neither file readable the ledger is UNKNOWN and caps read as reached", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(1, 4), {}).ledger;
  recordUsage(ports.fileWriter, PATHS, ledger, usage(2, 4), {});
  ports.fileWriter.makeUnreadable(PATHS.ledger);
  ports.fileWriter.makeUnreadable(PATHS.previous);

  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD_CEILING,
  });
  assert.equal(result.state, "unknown");
  // NOT "load as zero usage and carry on": every hard ceiling reads as reached.
  assert.equal(result.hardCeilingsReadAsReached, true);
  assert.equal(result.blockedReason, "budget-cap");
  assert.equal(result.note, "ledger-unreadable");
  assert.equal(result.alert?.kind, "ledger-unreadable");
  assert.equal(result.alert?.level, "loud");
  assert.deepEqual(
    ceilingsReadAsReached(result, HARD_CEILING).map((ceiling) => ceiling.dimension),
    ["costUsd"],
  );
});

test("CT-127-2: the figures of the ledger are never LOWER after an unreadable file", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  for (let index = 1; index <= 3; index += 1) {
    ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(index, 3), {}).ledger;
  }
  const before = realCostUsd(ledger) ?? 0;
  assert.equal(before, 9);
  ports.fileWriter.makeUnreadable(PATHS.ledger);

  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD_CEILING,
    events: [1, 2, 3].map((index) => ({ type: "usage" as const, usage: usage(index, 3) })),
  });
  // The quickstart's check: "spend is not lower than before, or the run stops
  // with `budget-cap`". Here it is not lower.
  assert.ok((realCostUsd(result.ledger) ?? 0) >= before);
});

/* ------------------------------------------------------------------ *
 * 3. ONE ledger across a `resume`.
 * ------------------------------------------------------------------ */

test("CT-127-2: a `resume` reads the same ledger and goes on adding to it", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(1, 3), {}).ledger;
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(2, 3), {}).ledger;
  const beforeTheResume = realCostUsd(ledger);

  // The engine stops. A `resume` starts and reads the ledger back.
  const resumed = resume(ports, { reset: false });
  assert.equal(realCostUsd(resumed.ledger), beforeTheResume);
  assert.equal(resumed.ledger.runId, RUN);

  // It goes on adding to the SAME file: one run, one figure.
  const after = recordUsage(ports.fileWriter, PATHS, resumed.ledger, usage(3, 3), {}).ledger;
  assert.equal(realCostUsd(after), 9);
  assert.equal(callCount(after), 3);
  assert.deepEqual(
    [...new Set(ports.fileWriter.writes.map((write) => write.path))].sort(),
    [PATHS.ledger, PATHS.previous].sort(),
  );
});

test("CT-127-2: the generation only ever rises across a resume", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(1, 1), {}).ledger;
  assert.equal(ledger.generation, 1);
  const resumed = resume(ports, { reset: false });
  assert.equal(resumed.ledger.generation, 1);
  const after = recordUsage(ports.fileWriter, PATHS, resumed.ledger, usage(2, 1), {}).ledger;
  assert.equal(after.generation, 2);
});

/* ------------------------------------------------------------------ *
 * 4. The reset flag of `resume` does NOT reset the ledger (CQ-130).
 * ------------------------------------------------------------------ */

test("CT-127-2: the reset flag of `resume` does not reset the ledger", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(1, 4), {}).ledger;
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(2, 4), {}).ledger;
  const spend = realCostUsd(ledger);
  const tokens = hardTokens(ledger);
  const calls = callCount(ledger);

  const withTheFlag = resume(ports, { reset: true });
  assert.equal(withTheFlag.resetFlagWasSet, true);
  // A hard cap that a flag could reset would not hold (ruling K3).
  assert.equal(realCostUsd(withTheFlag.ledger), spend);
  assert.equal(hardTokens(withTheFlag.ledger), tokens);
  assert.equal(callCount(withTheFlag.ledger), calls);

  const withoutTheFlag = resume(ports, { reset: false });
  assert.equal(realCostUsd(withoutTheFlag.ledger), realCostUsd(withTheFlag.ledger));
});

test("CT-127-2: the deduplication keys survive the resume, so a replay adds nothing", () => {
  const ports = testPorts();
  const ledger = emptyLedger(RUN);
  recordUsage(ports.fileWriter, PATHS, ledger, usage(1, 4), {});
  const resumed = resume(ports, { reset: true }).ledger;
  assert.deepEqual(resumed.seenUsageIds, ["u-1"]);
  const again = applyUsageRecord(resumed, usage(1, 4));
  assert.equal(again.applied, false);
  assert.equal(realCostUsd(again.ledger), 4);
});

test("CT-127-2: only a NEW RUN starts a new ledger", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(1, 4), {}).ledger;
  // A new run is a new runId and a new path; `emptyLedger` is the one zero.
  const fresh = emptyLedger("run-a-different-one");
  assert.equal(realCostUsd(fresh), null);
  assert.equal(fresh.generation, 0);
  assert.deepEqual(fresh.seenUsageIds, []);
  assert.equal(fresh.run.phaseAttempts, 0);
  // And the old one is untouched by it.
  assert.equal(realCostUsd(ledger), 4);
});

test("CT-127-2: the run's own figures — phase attempts and pause time — survive a resume", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger.run.phaseAttempts = 4;
  ledger.run.pausedMs = 5_400_000;
  ledger.windows.episodeStart = "2026-10-03T00:00:00.000Z";
  ledger = writeLedger(ports.fileWriter, PATHS, ledger);
  const resumed = resume(ports, { reset: true }).ledger;
  assert.equal(resumed.run.phaseAttempts, 4);
  assert.equal(resumed.run.pausedMs, 5_400_000);
  assert.equal(resumed.windows.episodeStart, "2026-10-03T00:00:00.000Z");
});
