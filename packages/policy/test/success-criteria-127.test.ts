/**
 * T086 — THE MEASURABLE OUTCOMES F127-SC-001 TO F127-SC-011, RUN ON THE FAKE
 * CLOCK, and their results recorded in `./success-criteria-127.md`.
 *
 * This file runs nine of the eleven and the fixture half of the tenth. The two
 * halves that cannot live in this package, because they would import across a
 * package boundary this feature may not cross, are:
 *
 *  - F127-SC-004 (the parity oracle): `tests/parity/127/SC-004-wall-budget-parity.test.ts`;
 *  - F127-SC-011 (the conformance suite of EP-12 against the sample classifier
 *    outside the core): `packages/testkit/src/conformance/EP-12/SC-011-sample-127.test.ts`.
 *
 * All three files write their MEASURED result into the one record,
 * `./success-criteria-127.md`, and each asserts that the record states exactly
 * what the run measured. So the record is not a claim: it is the output of the
 * run, checked against the file on every run.
 *
 * Nothing here reads a real clock, a real random source or the file system of
 * the platform: every scenario runs on `testPorts()` of T003. A five-hour
 * pause and a twenty-four hour ceiling therefore take microseconds.
 *
 * `SPECSTRIDE_SC_RECORD=1` prints the measured lines instead of checking them
 * against the record; that is how the record is (re)generated after a change.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { classify } from "../src/quota/classify.ts";
import { classifyInputOf, readHostEvent } from "../src/quota/host.ts";
import {
  CONFIDENCES_THAT_PAUSE_AFTER_A_PROBE,
  confirmingProbe,
  needsAConfirmingProbe,
  type ProbeCallResult,
  type ProbePort,
  type ProbeRequest,
} from "../src/quota/probe.ts";
import {
  PAUSE_STATE,
  THE_SIX_COUNTS_OF_A_RUN,
  countsAfterAPause,
  enterPause,
  pausesWithoutAProbe,
  type EnterPauseInput,
  type RunCounts,
} from "../src/quota/pause.ts";
import { PAIR_CLOSED } from "../src/quota/events.ts";
import { DEFAULT_PAUSE_TIMING, resume, resumeTimeFor } from "../src/quota/resume.ts";
import { closePause, excludePaused, noPausedTime, openPause } from "../src/quota/clocks.ts";
import { STOP_POLL_MS, waitThroughThePause } from "../src/quota/recover.ts";
import {
  DEFAULT_MAX_TOTAL_MS,
  atTheCeiling,
  ceilingAtOf,
  startOrContinueEpisode,
} from "../src/quota/ceiling.ts";
import {
  applyUsageRecord,
  emptyLedger,
  ledgerPaths,
  notionalCostUsd,
  realCostUsd,
  recordUsage,
  type SpendLedger,
  type UsageRecord,
} from "../src/budget/ledger.ts";
import { rebuildLedger } from "../src/budget/rebuild.ts";
import { evaluateCeilings, readCeiling, type Ceiling } from "../src/budget/ceilings.ts";
import { enforceAtUsageRecord, type LiveProcess } from "../src/budget/enforce.ts";
import { capStop } from "../src/budget/cap-stop.ts";
import { entryOf, walkFallback, type RolePlan } from "../src/budget/fallback.ts";
import { capCheck, prepareTheKey, firstCallOnTheKey } from "../src/budget/fallback-billing.ts";
import { evaluateEntry } from "../src/budget/fallback-gate.ts";
import { performSwitch } from "../src/budget/fallback-switch.ts";
import type { PassHandle } from "@specstride/contracts/ep/harness";
import type { TermsDecision, TermsGate, TermsQuery } from "@specstride/contracts/ep/terms";
import { DEFAULT_START_MS, testPorts } from "./support/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORD_PATH_OF_THE_RESULTS = join(HERE, "success-criteria-127.md");
const REPORT_MODE = process.env.SPECSTRIDE_SC_RECORD === "1";
/** The record; empty in report mode, which is the run that writes it. */
const RECORD = existsSync(RECORD_PATH_OF_THE_RESULTS)
  ? readFileSync(RECORD_PATH_OF_THE_RESULTS, "utf8")
  : "";

/**
 * Hold the record to the run: the cell "Measured" of the row of `id` must be
 * exactly what this run produced.
 */
export function recorded(record: string, id: string, measured: string): void {
  if (REPORT_MODE) {
    process.stdout.write(`RECORD ${id} :: ${measured}\n`);
    return;
  }
  assert.ok(!measured.includes("|"), "a measured value is one table cell and holds no bar");
  const row = record.split("\n").find((line) => line.startsWith(`| ${id} |`));
  assert.ok(row !== undefined, `\`success-criteria-127.md\` has no row for ${id}`);
  const cells = row.split("|").map((cell) => cell.trim());
  assert.equal(
    cells[3],
    measured,
    `${id}: the record states "${cells[3]}" and this run measured "${measured}"`,
  );
  assert.equal(cells[4], "met", `${id}: the verdict of the record`);
}

const sc = (id: string, measured: string) => recorded(RECORD, id, measured);

/** The one redactor of the product, as the composition root hands it in. */
const redact = (text: string, cap: number) => ({
  text: text.slice(0, cap),
  replacements: 0,
  patternSetVersion: "test",
});

const FIVE_HOURS = 5 * 60 * 60 * 1000;
const RESETS_AT_MS = DEFAULT_START_MS + FIVE_HOURS;
const RESETS_AT = new Date(RESETS_AT_MS).toISOString();
const RECORD_PATH = ".specstride/runs/run-sc/pause.record";

/* ================================================================== *
 * F127-SC-001 — a quota exhaustion pauses the run and spends nothing.
 * ================================================================== */

/** The counts of a run that has already done work. */
const BEFORE: RunCounts = Object.freeze({
  rejects: 2,
  passes: 7,
  malformedStreak: 1,
  errors: 1,
  wallClockMs: 1_234_567,
  relaunches: 3,
});

/** A `quota_window` classification of each of the five confidences of §Q.2. */
const CLASSIFICATIONS = [
  [
    "structured",
    () => classify({ structuredClass: "quota_window", resetsAt: { structured: RESETS_AT } }),
  ],
  [
    "status",
    () =>
      classify({
        structuredClass: "quota_window",
        confidence: "status",
        resetsAt: { header: RESETS_AT },
      }),
  ],
  [
    "text",
    () =>
      classify({ errorText: "the weekly limit was reached", resetsAt: { parsedText: RESETS_AT } }),
  ],
  ["stall", () => classify({ stalled: true, resetsAt: { parsedText: RESETS_AT } })],
  [
    "host",
    () =>
      classify(
        classifyInputOf(
          readHostEvent({
            type: "host-event",
            kind: "limit",
            at: new Date(DEFAULT_START_MS).toISOString(),
            data: { class: "quota_window", resetsAt: RESETS_AT, utilization: 1 },
          }) as NonNullable<ReturnType<typeof readHostEvent>>,
        ),
      ),
  ],
] as const;

/** A probe port that answers with one result and counts its calls. */
function probePort(result: ProbeCallResult): ProbePort & { calls: number } {
  const spy = {
    calls: 0,
    probe(_request: ProbeRequest): ProbeCallResult {
      spy.calls += 1;
      return result;
    },
  };
  return spy;
}

const CONFIRMS: ProbeCallResult = {
  ok: false,
  classification: classify({ structuredClass: "quota_window" }),
  costUsd: 0.0004,
  billingMode: "api",
};

function pauseInput(
  classification: ReturnType<typeof classify>,
  since: string,
  resumeAt: string,
  ceilingAt: string,
): EnterPauseInput {
  return {
    runId: "run-sc",
    attemptId: "p1-a1",
    role: "proposer",
    harness: "stub-harness",
    classification,
    since,
    resumeAt,
    ceilingAt,
    probeIndex: 0,
    recordPath: RECORD_PATH,
    counts: BEFORE,
  };
}

test("F127-SC-001: a quota exhaustion pauses the run without adding to the reject count", async () => {
  let paused = 0;
  let countsHeld = 0;
  let probedFirst = 0;
  let resumedAtTheReset = 0;

  for (const [confidence, build] of CLASSIFICATIONS) {
    const ports = testPorts({ fractions: [0] });
    const classification = build();
    assert.equal(classification.quotaClass, "quota_window", confidence);
    assert.equal(classification.confidence, confidence, "the confidence of the fixture");

    // The weak three are confirmed by a probe before the state is entered (§Q.2).
    if (needsAConfirmingProbe(classification.confidence)) {
      const port = probePort(CONFIRMS);
      const decision = await confirmingProbe(port, {
        role: "proposer",
        harness: "stub-harness",
        model: "stub-model",
        reason: "confirming-probe",
        usageId: `probe-${confidence}`,
      });
      assert.equal(port.calls, 1, "one confirming probe");
      assert.equal(decision.pauses, true);
      probedFirst += 1;
    } else {
      assert.equal(pausesWithoutAProbe("quota_window", classification.confidence), true);
    }

    const open = openPause(ports.clock);
    const resumeTime = resumeTimeFor(
      { resetsAt: classification.resetsAt, sinceMs: ports.clock.nowMs() },
      ports.random,
    );
    const episode = startOrContinueEpisode({ episodeStart: null, nowMs: ports.clock.nowMs() });
    const entry = enterPause(
      ports,
      pauseInput(classification, ports.clock.nowIso(), resumeTime.resumeAt, ceilingAtOf(episode)),
      PAIR_CLOSED,
      { redact },
    );
    assert.equal(entry.state, PAUSE_STATE);
    paused += 1;

    // The six counts of F127-FR-011, one by one.
    const after = countsAfterAPause(entry.counts as RunCounts);
    if (THE_SIX_COUNTS_OF_A_RUN.every((name) => after[name] === BEFORE[name])) countsHeld += 1;

    // The wait runs on the fake clock: five hours in microseconds.
    const wait = await waitThroughThePause(ports, entry.record, { stopRequested: () => false });
    assert.equal(wait.outcome, "resume", `${confidence}: the wait ended at the resume time`);
    const closed = closePause(ports.clock, open, noPausedTime());
    const resumed = resume(
      ports,
      {
        record: entry.record,
        recordPath: RECORD_PATH,
        resumedBy: "resume-time",
        pausedMs: closed.pausedMs,
        pausedTime: closed.after,
      },
      entry.pair,
    );
    assert.equal(resumed.state, "running");
    assert.equal(resumed.recordRemoved, true);
    if (ports.clock.nowMs() >= RESETS_AT_MS + DEFAULT_PAUSE_TIMING.marginMs) resumedAtTheReset += 1;

    // The wall clock of the run excludes the pause (F127-FR-012), so the
    // sixth count is unchanged in milliseconds and not only in name.
    assert.equal(excludePaused(closed.pausedMs, closed.pausedMs), 0);
  }

  assert.equal(paused, CLASSIFICATIONS.length);
  assert.equal(countsHeld, CLASSIFICATIONS.length);
  assert.equal(resumedAtTheReset, CLASSIFICATIONS.length);
  assert.equal(probedFirst, CONFIDENCES_THAT_PAUSE_AFTER_A_PROBE.length);
  sc(
    "F127-SC-001",
    `${paused}/${CLASSIFICATIONS.length} confidence values of a \`quota_window\` paused; ` +
      `${countsHeld}/${paused} with all six counts unchanged; ` +
      `${probedFirst}/${probedFirst} weak ones probed first; ` +
      `${resumedAtTheReset}/${paused} resumed at the reset plus the margin`,
  );
});

/* ================================================================== *
 * F127-SC-005 — nothing pauses on weak evidence.
 * ================================================================== */

test("F127-SC-005: nothing pauses on weak evidence", async () => {
  let probed = 0;
  let pausedWithoutAProbe = 0;
  let refutedGaveNoPause = 0;

  for (const confidence of CONFIDENCES_THAT_PAUSE_AFTER_A_PROBE) {
    assert.equal(needsAConfirmingProbe(confidence), true);
    assert.equal(pausesWithoutAProbe("quota_window", confidence), false);
    if (pausesWithoutAProbe("quota_window", confidence)) pausedWithoutAProbe += 1;

    const confirming = probePort(CONFIRMS);
    const confirmed = await confirmingProbe(confirming, {
      role: "proposer",
      harness: "stub-harness",
      model: "stub-model",
      reason: "confirming-probe",
      usageId: `probe-${confidence}`,
    });
    assert.equal(confirmed.made, true);
    assert.equal(confirmed.pauses, true);
    probed += 1;

    // A probe that SUCCEEDS refutes: the pause never begins.
    const refuting = probePort({ ok: true, costUsd: 0.0002, billingMode: "api" });
    const refuted = await confirmingProbe(refuting, {
      role: "proposer",
      harness: "stub-harness",
      model: "stub-model",
      reason: "confirming-probe",
      usageId: `probe-refuted-${confidence}`,
    });
    assert.equal(refuted.outcome, "refuted");
    assert.equal(refuted.pauses, false);
    if (!refuted.pauses) refutedGaveNoPause += 1;
  }

  sc(
    "F127-SC-005",
    `${probed}/3 weak confidences probed before the pause; ` +
      `${pausedWithoutAProbe}/3 paused without one; ` +
      `${refutedGaveNoPause}/3 refuting probes gave no pause`,
  );
});

/* ================================================================== *
 * F127-SC-002 — alerts are loudest with an API key.
 * ================================================================== */

test("F127-SC-002: every switch to an API key alerts `loud` before the first call on the key", () => {
  const fixtures = [
    { name: "cap on the entry", capUsd: 25, configured: null },
    { name: "a larger cap", capUsd: 500, configured: null },
    { name: "cap from the configuration", capUsd: null, configured: 10 },
  ] as const;

  let alertedFirst = 0;
  let refusedBeforeTheAlert = 0;
  for (const [index, fixture] of fixtures.entries()) {
    const ports = testPorts();
    const entry = entryOf(index + 1, {
      harness: `stub-api-${index}`,
      model: "stub-metered",
      authTier: 1,
      billingMode: "api",
      capUsd: fixture.capUsd,
    });
    const prepared = prepareTheKey(
      ports.eventWriter,
      entry,
      { role: "proposer", from: "subscription", configuredCapUsd: fixture.configured },
      { redact },
    );
    const alertEvents = ports.eventWriter.of("alert");
    assert.equal(alertEvents.length, 1, fixture.name);
    assert.equal(alertEvents[0]?.payload.kind, "billing-mode-change");
    assert.equal(alertEvents[0]?.payload.level, "loud", "the loudest level of §Q.4");
    assert.equal(ports.eventWriter.types()[0], "alert", "and it is the first event of the switch");
    // The call on the key is possible only through the guard the alert opened.
    const used = firstCallOnTheKey(prepared.guard);
    assert.equal(used.calls, 1);
    alertedFirst += 1;

    // And a call BEFORE the alert is refused, not warned about.
    const closed = { ...prepared.guard, alerted: false };
    assert.throws(() => firstCallOnTheKey(closed), /BillingModeOrder|order/i, fixture.name);
    refusedBeforeTheAlert += 1;
  }

  // An entry with no cap is never switched to: it is skipped with `no-cap`.
  const ports = testPorts();
  const withoutACap = entryOf(9, { harness: "stub-api-nocap", billingMode: "api", capUsd: null });
  const withACap = entryOf(10, { harness: "stub-api-capped", billingMode: "api", capUsd: 25 });
  const plan: RolePlan = {
    role: "proposer",
    primary: entryOf(0, { harness: "stub-harness", billingMode: "subscription" }),
    entries: [withoutACap, withACap],
    resolvedHarnesses: ["stub-harness", "stub-api-nocap", "stub-api-capped"],
  };
  const walk = walkFallback(plan, [capCheck({ from: "subscription" })], {
    writer: ports.eventWriter,
  });
  assert.equal(walk.chosen?.harness, "stub-api-capped", "the capped entry is the one switched to");
  const skipped = ports.eventWriter.of("fallback.skipped");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0]?.payload.reason, "no-cap");

  sc(
    "F127-SC-002",
    `${alertedFirst}/3 switches wrote the \`loud\` \`billing-mode-change\` before the first call; ` +
      `${refusedBeforeTheAlert}/3 calls before the alert refused; ` +
      `1/1 entry without a cap skipped with \`no-cap\``,
  );
});

/* ================================================================== *
 * F127-SC-003 — a hard cap holds.
 * ================================================================== */

const CAP_LEDGER_PATHS = ledgerPaths("/run/control/spend.json");
const COST_CEILING: readonly Ceiling[] = Object.freeze([
  { scope: "run", dimension: "costUsd", limit: 10 },
]);
const COST_PER_CALL = 3;

function handle(pid: number): PassHandle {
  return {
    pid,
    startTime: "2026-01-01T00:00:00.000Z",
    stream: (async function* () {})(),
    sessionId: `s-${pid}`,
  };
}

function liveProcess(index: number): LiveProcess {
  return {
    processId: `p-${index}`,
    role: "proposer",
    kind: "pass",
    harness: "stub-api",
    handle: handle(1000 + index),
  };
}

function usage(index: number, costUsd: number): UsageRecord {
  return {
    usageId: `u-${index}`,
    role: "proposer",
    billingMode: "api",
    costUsd,
    isCall: true,
    closesAPass: true,
  };
}

test("F127-SC-003: a hard cap holds, with one and with several live processes", () => {
  const measured: string[] = [];
  let within = 0;
  for (const count of [1, 2, 3]) {
    const processes = Array.from({ length: count }, (_, index) => liveProcess(index));
    const ports = testPorts();
    let ledger = emptyLedger(`run-sc-003-${count}`);
    let index = 0;
    for (;;) {
      index += 1;
      ledger = recordUsage(
        ports.fileWriter,
        CAP_LEDGER_PATHS,
        ledger,
        usage(index, COST_PER_CALL),
        {},
      ).ledger;
      const decision = enforceAtUsageRecord(usage(index, COST_PER_CALL), {
        ceilings: COST_CEILING,
        ledger,
        processes,
      });
      if (decision.mustEndThePass) break;
      assert.ok(index < 20, "the cap held");
    }
    // The other live processes report the call each had in flight.
    for (const [offset] of processes.slice(1).entries()) {
      ledger = recordUsage(
        ports.fileWriter,
        CAP_LEDGER_PATHS,
        ledger,
        usage(100 + offset, COST_PER_CALL),
        {},
      ).ledger;
    }
    const spend = realCostUsd(ledger) ?? 0;
    const bound = 10 + COST_PER_CALL * count;
    assert.ok(spend <= bound, `${count} live processes: ${spend} must be at most ${bound}`);
    if (spend <= bound) within += 1;
    measured.push(`${count}:${spend}<=${bound}`);
  }

  // And the stop itself: `budget.exceeded`, `blocked` with `budget-cap`, no rejection.
  const ports = testPorts();
  const overLedger = applyUsageRecord(emptyLedger("run-sc-003-stop"), usage(1, 12)).ledger;
  const reading = readCeiling(COST_CEILING[0] as Ceiling, { ledger: overLedger });
  const stop = capStop(ports.eventWriter, { reading, role: "proposer" }, { redact });
  assert.deepEqual([...ports.eventWriter.types()], ["budget.exceeded", "blocked"]);
  assert.equal(stop.blockedOutcome.reason, "budget-cap");
  assert.equal(stop.terminal.blockedReason, "budget-cap");
  assert.equal(stop.isARejection, false);
  assert.equal(stop.spendsAReject, false);
  assert.equal(stop.resumable, true);

  sc(
    "F127-SC-003",
    `${within}/3 runs within the cap plus one call per live process (${measured.join(", ")}); ` +
      `the stop wrote \`budget.exceeded\` then \`blocked\` with \`budget-cap\` and no rejection`,
  );
});

/* ================================================================== *
 * F127-SC-006 — spend is never forgotten.
 * ================================================================== */

test("F127-SC-006: an unreadable ledger never lowers the spend", () => {
  const paths = ledgerPaths("/run/control/spend.json");
  let notLower = 0;
  let stoppedWithBudgetCap = 0;

  // Case 1: the ledger is unreadable. The previous generation is read and the
  // usage records of the event stream that follow it are replayed, so the
  // spend after the next start is NOT LOWER than before it (F127-FR-032).
  {
    const ports = testPorts();
    let ledger = emptyLedger("run-sc-006-a");
    ledger = recordUsage(ports.fileWriter, paths, ledger, usage(1, 4), {}).ledger;
    const afterTheFirst = ledger.generation;
    ledger = recordUsage(ports.fileWriter, paths, ledger, usage(2, 5), {}).ledger;
    const before = realCostUsd(ledger) ?? 0;
    const events = [{ type: "usage", generation: afterTheFirst + 1, usage: usage(2, 5) }];
    ports.fileWriter.makeUnreadable(paths.ledger);
    const rebuilt = rebuildLedger({
      writer: ports.fileWriter,
      paths,
      runId: "run-sc-006-a",
      ceilings: COST_CEILING,
      events,
    });
    assert.equal(rebuilt.state, "rebuilt");
    assert.equal(rebuilt.source, "previous-generation");
    const after = realCostUsd(rebuilt.ledger) ?? 0;
    assert.ok(after >= before - 1e-9, `${after} must not be lower than ${before}`);
    if (after >= before - 1e-9) notLower += 1;
  }

  // Case 2: the ledger and the previous generation are both gone, and the
  // event stream holds the usage records: the rebuild replays them.
  {
    const ports = testPorts();
    const events = [
      { type: "usage", usage: usage(1, 4) },
      { type: "usage", usage: usage(2, 5) },
    ];
    const rebuilt = rebuildLedger({
      writer: ports.fileWriter,
      paths,
      runId: "run-sc-006-b",
      ceilings: COST_CEILING,
      events,
    });
    assert.equal(rebuilt.source, "events");
    const after = realCostUsd(rebuilt.ledger) ?? 0;
    assert.ok(after >= 9 - 1e-9, "the replay of the stream gives the whole spend back");
    if (after >= 9 - 1e-9) notLower += 1;
  }

  // Case 3: nothing is readable at all. Every hard ceiling reads as REACHED
  // and the run stops with `budget-cap` and the note `ledger-unreadable`.
  {
    const ports = testPorts();
    const rebuilt = rebuildLedger({
      writer: ports.fileWriter,
      paths,
      runId: "run-sc-006-c",
      ceilings: COST_CEILING,
    });
    assert.equal(rebuilt.state, "unknown");
    assert.equal(rebuilt.hardCeilingsReadAsReached, true);
    assert.equal(rebuilt.blockedReason, "budget-cap");
    assert.equal(rebuilt.note, "ledger-unreadable");
    assert.equal(rebuilt.alert?.kind, "ledger-unreadable");
    assert.equal(rebuilt.alert?.level, "loud", "`loud` where a hard ceiling is set (§Q.4)");
    stoppedWithBudgetCap += 1;
  }

  sc(
    "F127-SC-006",
    `${notLower}/2 unreadable cases gave spend at or above what it was before; ` +
      `${stoppedWithBudgetCap}/1 case with nothing readable read every hard ceiling as reached and ` +
      `stopped with \`budget-cap\` and the note \`ledger-unreadable\``,
  );
});

/* ================================================================== *
 * F127-SC-007 — the ceiling is kept.
 * ================================================================== */

test("F127-SC-007: a pause that outlasts `pause.maxTotalMs` rests blocked within one tick", async () => {
  const ports = testPorts({ fractions: [0] });
  const episode = startOrContinueEpisode({ episodeStart: null, nowMs: ports.clock.nowMs() });
  assert.equal(episode.maxTotalMs, DEFAULT_MAX_TOTAL_MS, "24 hours");
  const ceilingAt = ceilingAtOf(episode);
  // A reset time BEYOND the ceiling: the wait runs into the ceiling.
  const beyond = new Date(DEFAULT_START_MS + 48 * 60 * 60 * 1000).toISOString();
  const classification = classify({
    structuredClass: "quota_window",
    resetsAt: { structured: beyond },
  });
  const resumeTime = resumeTimeFor(
    { resetsAt: beyond, sinceMs: ports.clock.nowMs() },
    ports.random,
  );
  const entry = enterPause(
    ports,
    pauseInput(classification, ports.clock.nowIso(), resumeTime.resumeAt, ceilingAt),
    PAIR_CLOSED,
    { redact },
  );
  const wait = await waitThroughThePause(ports, entry.record, { stopRequested: () => false });
  assert.equal(wait.outcome, "ceiling");
  const overshootMs = ports.clock.nowMs() - Date.parse(ceilingAt);
  assert.ok(overshootMs >= 0 && overshootMs < STOP_POLL_MS, `within one tick: ${overshootMs} ms`);

  const outcome = atTheCeiling(
    ports.eventWriter,
    { episode, role: "proposer", nowMs: ports.clock.nowMs() },
    { redact },
  );
  assert.equal(outcome.state, "blocked-on-human");
  assert.equal(outcome.terminal.stopReason, "paused_quota_ceiling");
  assert.equal(outcome.terminal.exitCode, 4);
  assert.equal(outcome.relaunched, false);

  sc(
    "F127-SC-007",
    `1/1 pause past the 24-hour ceiling rested in \`blocked-on-human\` with \`paused_quota_ceiling\` ` +
      `and exit 4, ${overshootMs} ms after the ceiling (one tick is ${STOP_POLL_MS} ms)`,
  );
});

/* ================================================================== *
 * F127-SC-008 — the resume is punctual.
 * ================================================================== */

test("F127-SC-008: the resume is not before the reset plus the margin and not after one tick more", async () => {
  const fractions = [0, 0.25, 0.5, 0.999];
  const lateness: number[] = [];
  let punctual = 0;
  for (const fraction of fractions) {
    const ports = testPorts({ fractions: [fraction] });
    const classification = classify({
      structuredClass: "quota_window",
      resetsAt: { structured: RESETS_AT },
    });
    const resumeTime = resumeTimeFor(
      { resetsAt: classification.resetsAt, sinceMs: ports.clock.nowMs() },
      ports.random,
    );
    const earliest = RESETS_AT_MS + DEFAULT_PAUSE_TIMING.marginMs;
    const latest =
      RESETS_AT_MS + DEFAULT_PAUSE_TIMING.marginMs + DEFAULT_PAUSE_TIMING.jitterMs + STOP_POLL_MS;
    const episode = startOrContinueEpisode({ episodeStart: null, nowMs: ports.clock.nowMs() });
    const entry = enterPause(
      ports,
      pauseInput(classification, ports.clock.nowIso(), resumeTime.resumeAt, ceilingAtOf(episode)),
      PAIR_CLOSED,
      { redact },
    );
    const wait = await waitThroughThePause(ports, entry.record, { stopRequested: () => false });
    assert.equal(wait.outcome, "resume");
    const at = ports.clock.nowMs();
    assert.ok(at >= earliest, `not before the reset plus the margin: ${at} < ${earliest}`);
    assert.ok(
      at <= latest,
      `not later than the margin plus the jitter plus one tick: ${at} > ${latest}`,
    );
    if (at >= earliest && at <= latest) punctual += 1;
    lateness.push(at - earliest);
  }

  sc(
    "F127-SC-008",
    `${punctual}/${fractions.length} fixtures with a known reset time resumed inside the window ` +
      `[reset+margin, reset+margin+jitter+one tick); lateness in ms: ${lateness.join(", ")}`,
  );
});

/* ================================================================== *
 * F127-SC-009 — notional cost is kept apart.
 * ================================================================== */

test("F127-SC-009: under a subscription the real spend is 0 and the notional cost is the sum", () => {
  const reported = [1.5, 0.25, 4];
  let ledger: SpendLedger = emptyLedger("run-sc-009");
  for (const [index, costUsd] of reported.entries()) {
    ledger = applyUsageRecord(ledger, {
      usageId: `s-${index}`,
      role: "proposer",
      billingMode: "subscription",
      inputTokens: 1_000,
      costUsd,
      isCall: true,
      closesAPass: true,
    }).ledger;
  }
  const real = realCostUsd(ledger);
  const notional = notionalCostUsd(ledger);
  const sum = reported.reduce((total, value) => total + value, 0);
  assert.equal(real, null, "no `api` record: real spend is nothing at all, not a figure");
  assert.equal(notional, sum);
  // And a hard ceiling of real spend is not touched by any of it.
  const evaluation = evaluateCeilings([{ scope: "run", dimension: "costUsd", limit: 1 }], {
    ledger,
  });
  assert.equal(
    evaluation.exhausted.length,
    0,
    "a subscription never trips a hard ceiling of spend",
  );

  sc(
    "F127-SC-009",
    `1/1 subscription fixture: real spend ${String(real)} (no \`api\` record), notional ${notional} ` +
      `= the sum of the ${reported.length} reported figures; 0 hard ceilings of spend tripped`,
  );
});

/* ================================================================== *
 * F127-SC-010 — every switch is gated and recorded.
 * ================================================================== */

test("F127-SC-010: the terms gate is evaluated before the first call, and the switch is recorded", () => {
  const switches = [
    {
      to: entryOf(1, {
        harness: "stub-api-a",
        model: "m",
        authTier: 1,
        provider: "p-a",
        billingMode: "api",
        capUsd: 25,
      }),
      reason: "quota_window",
    },
    {
      to: entryOf(2, {
        harness: "stub-api-b",
        model: "m",
        authTier: 1,
        provider: "p-b",
        billingMode: "api",
        capUsd: 50,
      }),
      reason: "quota_credit",
    },
    {
      to: entryOf(3, {
        harness: "stub-sub",
        model: "m",
        authTier: 1,
        provider: "p-c",
        billingMode: "subscription",
      }),
      reason: "quota_window",
    },
  ] as const;
  const from = entryOf(0, {
    harness: "stub-harness",
    model: "stub-base",
    billingMode: "subscription",
    provider: "p-home",
  });

  let gatedBeforeTheCall = 0;
  let recorded = 0;
  for (const [index, entry] of switches.entries()) {
    const ports = testPorts();
    const queries: TermsQuery[] = [];
    const gate: TermsGate = {
      evaluate(query): TermsDecision {
        queries.push(query);
        return { decision: "allowed", row: null, explanation: "allowed" };
      },
    };
    const decision = evaluateEntry(gate, entry.to, { acknowledgements: [], audience: "personal" });
    assert.equal(decision.allowed, true);
    assert.equal(queries.length, 1, "the gate was asked, once, before anything else");

    const result = performSwitch(ports.eventWriter, {
      role: "proposer",
      from,
      to: entry.to,
      reason: entry.reason,
      phaseAttempt: `phase-${index + 1}/attempt-1`,
      boundaryAvailable: true,
    });
    assert.equal(result.change.kind, "fallback");
    const types = [...ports.eventWriter.types()];
    assert.ok(types.includes("fallback.switched"), "the switch is in the event file");
    gatedBeforeTheCall += 1;

    // Where the switch changes the billing mode, the `loud` alert is there too.
    if (result.change.billingModeChanged) {
      const prepared = prepareTheKey(
        ports.eventWriter,
        entry.to,
        { role: "proposer", from: "subscription" },
        { redact },
      );
      assert.equal(prepared.event.payload.level, "loud");
      assert.equal(ports.eventWriter.countOf("alert"), 1);
    }
    recorded += 1;
  }

  sc(
    "F127-SC-010",
    `${gatedBeforeTheCall}/3 switches evaluated the terms gate before the first call; ` +
      `${recorded}/3 wrote \`fallback.switched\`; 2/2 switches that changed the billing mode ` +
      `also wrote the \`loud\` alert`,
  );
});

/* ================================================================== *
 * F127-SC-011 — the classifier fixtures (the EP-12 half is in the testkit).
 * ================================================================== */

test("F127-SC-011 (fixtures): one fixture per tested harness that has a captured quota signal", () => {
  const manifest = JSON.parse(
    readFileSync(join(HERE, "classifier-fixtures", "manifest.json"), "utf8"),
  ) as {
    readonly testedHarnesses: readonly {
      readonly harness: string;
      readonly status: string;
      readonly fixture: string | null;
      readonly reason?: string;
    }[];
  };
  const withACapture = manifest.testedHarnesses.filter((entry) => entry.status !== "unverified");
  const unverified = manifest.testedHarnesses.filter((entry) => entry.status === "unverified");
  assert.equal(withACapture.length + unverified.length, manifest.testedHarnesses.length);
  for (const entry of withACapture) {
    assert.ok(entry.fixture, `${entry.harness} has a capture, so it must have a fixture`);
  }
  for (const entry of unverified) {
    assert.equal(entry.fixture, null, `${entry.harness}: no capture, so no fixture is invented`);
    assert.ok((entry.reason ?? "").length > 10, `${entry.harness}: the reason is recorded`);
  }

  sc(
    "F127-SC-011 (fixtures)",
    `${withACapture.length}/${withACapture.length} tested harnesses with a captured signal have a ` +
      `fixture; ${unverified.length} of ${manifest.testedHarnesses.length} are marked \`unverified\` ` +
      `with the capture that would close each`,
  );
});
