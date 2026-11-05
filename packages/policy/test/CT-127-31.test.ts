/**
 * CT-127-31 (T067) — the characterization test of THE OVERSHOOT OF AT MOST ONE
 * CALL PER LIVE PROCESS, with ONE and with SEVERAL live processes
 * (F127-FR-033).
 *
 * This is the INDEPENDENT TEST of user story 3, in the form the quickstart
 * gives it: "A cost ceiling of 10 units, 3 units per call → real spend after
 * the stop is at most 12."
 *
 * Around it, the rest of F127-FR-033: the enforcement at every usage record
 * and at the four safe boundaries of §Q.3, the sum over every live harness
 * process, the end of the pass through the STOP OPERATION of the harness port
 * (polite first), the work kept as a claim with no verdict, and the remaining
 * headroom passed as a process-level spending limit.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { PassHandle, StopKind } from "@specstride/contracts/ep/harness";
import {
  ENFORCEMENT_POINTS,
  EnforcementPointError,
  GIVES_NO_VERDICT,
  KEEPS_THE_WORK_AS_A_CLAIM,
  POLITE_FIRST,
  SAFE_BOUNDARIES,
  STOP_KIND_ORDER,
  endLiveProcesses,
  enforce,
  enforceAtBoundary,
  enforceAtUsageRecord,
  headroomFor,
  headroomOf,
  isSafeBoundary,
  maxOvershootCalls,
  overshootIsWithinBound,
  overshootReport,
  readEnforcementPoint,
  spendingLimitForAPass,
  sumOverLiveProcesses,
  type LiveProcess,
} from "../src/budget/enforce.ts";
import {
  applyUsageRecord,
  emptyLedger,
  ledgerPaths,
  realCostUsd,
  recordUsage,
  type SpendLedger,
  type UsageRecord,
} from "../src/budget/ledger.ts";
import { readCeiling, type Ceiling } from "../src/budget/ceilings.ts";
import { testPorts } from "./support/index.ts";

const PATHS = ledgerPaths("/run/control/spend.json");
const RUN = "run-ct-127-31";

/** The quickstart's ceiling: 10 units, at the run scope. */
const COST_CEILING: readonly Ceiling[] = Object.freeze([
  { scope: "run", dimension: "costUsd", limit: 10 },
]);

/** The quickstart's call: 3 units. */
const COST_PER_CALL = 3;

function handle(pid: number): PassHandle {
  return {
    pid,
    startTime: "2026-10-03T00:00:00.000Z",
    stream: (async function* () {})(),
    sessionId: `s-${pid}`,
  };
}

function liveProcess(index: number, over: Partial<LiveProcess> = {}): LiveProcess {
  return {
    processId: `p-${index}`,
    role: "proposer",
    kind: "pass",
    harness: "stub-api",
    handle: handle(1000 + index),
    ...over,
  };
}

/** A harness port whose `stop` answers as a test asks, and records its calls. */
function stubPort(answers: readonly boolean[] = [true]) {
  const calls: { readonly pid: number; readonly kind: StopKind }[] = [];
  let index = 0;
  return {
    calls,
    async stop(passHandle: PassHandle, kind: StopKind): Promise<boolean> {
      calls.push({ pid: passHandle.pid, kind });
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      return answer;
    },
  };
}

function usage(index: number, costUsd: number, role = "proposer"): UsageRecord {
  return {
    usageId: `u-${role}-${index}`,
    role,
    billingMode: "api",
    costUsd,
    isCall: true,
    closesAPass: true,
  };
}

/**
 * The quickstart's run: calls of `COST_PER_CALL` go in until the engine ends
 * the live processes. Each live process has ONE call in flight when the cap is
 * reached, and reports it afterwards.
 */
function runUntilTheCapHolds(processes: readonly LiveProcess[]): {
  readonly ledger: SpendLedger;
  readonly stoppedAt: number;
} {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  let index = 0;
  let stoppedAt = 0;
  // The engine records a call, then enforces, as F127-FR-033 asks of EVERY record.
  for (;;) {
    index += 1;
    ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(index, COST_PER_CALL), {}).ledger;
    const decision = enforceAtUsageRecord(usage(index, COST_PER_CALL), {
      ceilings: COST_CEILING,
      ledger,
      processes,
    });
    if (decision.mustEndThePass) {
      stoppedAt = index;
      break;
    }
    if (index > 20) throw new Error("the cap never held");
  }
  // The call that brought the cap to its limit was one of the live processes'
  // own calls in flight; the OTHER live processes now report theirs too.
  for (const [offset, process] of processes.slice(1).entries()) {
    ledger = recordUsage(
      ports.fileWriter,
      PATHS,
      ledger,
      usage(100 + offset, COST_PER_CALL, process.role),
      {},
    ).ledger;
  }
  return { ledger, stoppedAt };
}

/* ------------------------------------------------------------------ *
 * The five points of enforcement.
 * ------------------------------------------------------------------ */

test("CT-127-31: the points are a usage record and the four safe boundaries of §Q.3", () => {
  assert.deepEqual(
    [...SAFE_BOUNDARIES],
    [
      "before-a-phase-attempt",
      "before-a-pass",
      "before-a-critic-class-call",
      "between-units-of-work",
    ],
  );
  assert.deepEqual([...ENFORCEMENT_POINTS], ["usage-record", ...SAFE_BOUNDARIES]);
  assert.equal(isSafeBoundary("usage-record" as never), false);
  for (const boundary of SAFE_BOUNDARIES) assert.equal(isSafeBoundary(boundary), true);
  assert.throws(() => readEnforcementPoint("whenever"), EnforcementPointError);
});

test("CT-127-31: the enforcement holds at every one of the five points", () => {
  const ledger = applyUsageRecord(emptyLedger(RUN), usage(1, 12)).ledger;
  const processes = [liveProcess(1)];
  const atRecord = enforceAtUsageRecord(usage(1, 12), {
    ceilings: COST_CEILING,
    ledger,
    processes,
  });
  assert.equal(atRecord.point, "usage-record");
  assert.equal(atRecord.mustEndThePass, true);
  for (const boundary of SAFE_BOUNDARIES) {
    const decision = enforceAtBoundary(boundary, {
      ceilings: COST_CEILING,
      ledger,
      processes,
    });
    assert.equal(decision.point, boundary);
    assert.equal(decision.mustEndThePass, true, `${boundary} must enforce`);
  }
});

test("CT-127-31: under the ceiling nothing is ended at any point", () => {
  const ledger = applyUsageRecord(emptyLedger(RUN), usage(1, 3)).ledger;
  for (const point of ENFORCEMENT_POINTS) {
    const decision = enforce({
      point,
      ceilings: COST_CEILING,
      ledger,
      processes: [liveProcess(1)],
    });
    assert.equal(decision.mustEndThePass, false, point);
    assert.deepEqual([...decision.toEnd], []);
  }
});

/* ------------------------------------------------------------------ *
 * The sum over every live harness process.
 * ------------------------------------------------------------------ */

test("CT-127-31: the sum is taken over every live harness process", () => {
  let ledger = emptyLedger(RUN);
  ledger = applyUsageRecord(ledger, usage(1, 4, "proposer")).ledger;
  ledger = applyUsageRecord(ledger, usage(2, 4, "critic")).ledger;
  const both = [
    liveProcess(1, { role: "proposer" }),
    liveProcess(2, { role: "critic", kind: "critic-class-call" }),
  ];
  // Each role is under 5 on its own; together they are 8.
  assert.equal(sumOverLiveProcesses("costUsd", both, { ledger }), 8);
  assert.equal(sumOverLiveProcesses("costUsd", [both[0]], { ledger }), 4);
});

test("CT-127-31: two live processes of the SAME role are not counted twice", () => {
  const ledger = applyUsageRecord(emptyLedger(RUN), usage(1, 6)).ledger;
  const two = [liveProcess(1), liveProcess(2)];
  assert.equal(sumOverLiveProcesses("costUsd", two, { ledger }), 6);
});

test("CT-127-31: a run-scope figure is read once, not once per process", () => {
  const ledger = emptyLedger(RUN);
  ledger.run.phaseAttempts = 4;
  const three = [liveProcess(1), liveProcess(2), liveProcess(3)];
  assert.equal(sumOverLiveProcesses("phaseAttempts", three, { ledger }), 4);
});

test("CT-127-31: a dimension nothing reported sums as unknown, not zero", () => {
  const ledger = applyUsageRecord(emptyLedger(RUN), {
    usageId: "u-1",
    role: "proposer",
    billingMode: "api",
    inputTokens: 100,
  }).ledger;
  assert.equal(sumOverLiveProcesses("costUsd", [liveProcess(1)], { ledger }), null);
});

/* ------------------------------------------------------------------ *
 * The overshoot bound: one call per live process.
 * ------------------------------------------------------------------ */

test("CT-127-31: ONE live process — a cost cap of 10 at 3 a call holds at 12", () => {
  const one = [liveProcess(1)];
  const { ledger, stoppedAt } = runUntilTheCapHolds(one);
  // Four calls of 3 reach 12, which is the first figure at or over 10.
  assert.equal(stoppedAt, 4);
  const spend = realCostUsd(ledger) ?? 0;
  // Nothing else was in flight, so the recorded figure is the quickstart's 12.
  assert.equal(spend, 12);
  // The quickstart's check, with the overshoot of the ONE call in flight.
  assert.equal(maxOvershootCalls(one), 1);
  assert.ok(
    overshootIsWithinBound({
      recorded: spend,
      limit: 10,
      costPerCall: COST_PER_CALL,
      processes: one,
    }),
    `recorded ${spend} must be within 10 + 1 call of 3 + the call that reached the cap`,
  );
});

test("CT-127-31: the recorded spend at the moment of the stop is at most 12", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  let index = 0;
  for (;;) {
    index += 1;
    ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(index, COST_PER_CALL), {}).ledger;
    if (
      enforceAtUsageRecord(usage(index, COST_PER_CALL), {
        ceilings: COST_CEILING,
        ledger,
        processes: [liveProcess(1)],
      }).mustEndThePass
    ) {
      break;
    }
  }
  // The quickstart: "Real spend after the stop is at most 12."
  assert.equal(realCostUsd(ledger), 12);
  assert.ok((realCostUsd(ledger) ?? 0) <= 12);
});

test("CT-127-31: SEVERAL live processes — the overshoot grows by one call each", () => {
  for (const count of [1, 2, 3, 5]) {
    const processes = Array.from({ length: count }, (_unused, index) =>
      liveProcess(index, { role: `role-${index}` }),
    );
    assert.equal(maxOvershootCalls(processes), count);
    // The cap is detected at 12 by one process's call; the other `count - 1`
    // processes then report one call each.
    const report = overshootReport({
      recorded: 12 + COST_PER_CALL * (count - 1),
      limit: 10,
      costPerCall: COST_PER_CALL,
      processes,
    });
    assert.equal(report.allowedCalls, count);
    assert.equal(report.allowedOvershoot, COST_PER_CALL * count);
    assert.ok(report.withinBound, `${count} live processes`);
  }
});

test("CT-127-31: an overshoot of MORE than one call per live process is outside the bound", () => {
  const one = [liveProcess(1)];
  // One process may pass 10 by at most one call of 3: 13 is the edge.
  assert.equal(
    overshootIsWithinBound({ recorded: 13, limit: 10, costPerCall: COST_PER_CALL, processes: one }),
    true,
  );
  assert.equal(
    overshootIsWithinBound({ recorded: 14, limit: 10, costPerCall: COST_PER_CALL, processes: one }),
    false,
  );
  const three = [liveProcess(1), liveProcess(2), liveProcess(3)];
  // Three processes may pass 10 by at most three calls of 3: 19 is the edge.
  assert.equal(
    overshootIsWithinBound({
      recorded: 19,
      limit: 10,
      costPerCall: COST_PER_CALL,
      processes: three,
    }),
    true,
  );
  assert.equal(
    overshootIsWithinBound({
      recorded: 20,
      limit: 10,
      costPerCall: COST_PER_CALL,
      processes: three,
    }),
    false,
  );
});

test("CT-127-31: three live processes each reporting one call in flight stay within bound", () => {
  const three = [
    liveProcess(1, { role: "proposer" }),
    liveProcess(2, { role: "critic", kind: "critic-class-call" }),
    liveProcess(3, { role: "diagnostician" }),
  ];
  const { ledger } = runUntilTheCapHolds(three);
  const spend = realCostUsd(ledger) ?? 0;
  assert.ok(
    overshootIsWithinBound({
      recorded: spend,
      limit: 10,
      costPerCall: COST_PER_CALL,
      processes: three,
    }),
    `recorded ${spend} with three live processes`,
  );
});

test("CT-127-31: the decision carries how many calls of overshoot are allowed", () => {
  const ledger = applyUsageRecord(emptyLedger(RUN), usage(1, 12)).ledger;
  const decision = enforce({
    point: "usage-record",
    ceilings: COST_CEILING,
    ledger,
    processes: [liveProcess(1), liveProcess(2)],
  });
  assert.equal(decision.allowedOvershootCalls, 2);
});

/* ------------------------------------------------------------------ *
 * Ending the pass through the stop operation, polite first.
 * ------------------------------------------------------------------ */

test("CT-127-31: the stop is tried POLITE FIRST", async () => {
  assert.equal(POLITE_FIRST, "polite");
  assert.deepEqual([...STOP_KIND_ORDER], ["polite", "terminate", "kill"]);
  const port = stubPort([true]);
  const outcomes = await endLiveProcesses(port, [liveProcess(1)]);
  assert.deepEqual(
    port.calls.map((call) => call.kind),
    ["polite"],
  );
  assert.equal(outcomes[0].stoppedBy, "polite");
  assert.equal(outcomes[0].stopped, true);
});

test("CT-127-31: a polite stop that does not work falls back to the next stronger kind", async () => {
  const port = stubPort([false, false, true]);
  const outcomes = await endLiveProcesses(port, [liveProcess(1)]);
  assert.deepEqual(
    port.calls.map((call) => call.kind),
    ["polite", "terminate", "kill"],
  );
  assert.equal(outcomes[0].stoppedBy, "kill");
  assert.deepEqual([...outcomes[0].tried], ["polite", "terminate", "kill"]);
});

test("CT-127-31: a `stop` that throws is read as a `false` of that kind", async () => {
  const calls: StopKind[] = [];
  const port = {
    async stop(_handle: PassHandle, kind: StopKind): Promise<boolean> {
      calls.push(kind);
      if (kind !== "kill") throw new Error("the process did not answer");
      return true;
    },
  };
  const outcomes = await endLiveProcesses(port, [liveProcess(1)]);
  assert.deepEqual(calls, ["polite", "terminate", "kill"]);
  assert.equal(outcomes[0].stoppedBy, "kill");
});

test("CT-127-31: EVERY live process is ended, each polite first", async () => {
  const port = stubPort([true]);
  const three = [liveProcess(1), liveProcess(2), liveProcess(3)];
  const outcomes = await endLiveProcesses(port, three);
  assert.equal(outcomes.length, 3);
  assert.deepEqual(
    port.calls.map((call) => call.kind),
    ["polite", "polite", "polite"],
  );
  assert.deepEqual(
    port.calls.map((call) => call.pid),
    [1001, 1002, 1003],
  );
});

test("CT-127-31: a process with no handle is reported, not silently skipped", async () => {
  const port = stubPort([true]);
  const outcomes = await endLiveProcesses(port, [liveProcess(1, { handle: undefined })]);
  assert.equal(outcomes[0].noHandle, true);
  assert.equal(outcomes[0].stopped, false);
  assert.deepEqual(port.calls, []);
});

test("CT-127-31: the work of the pass is kept as a claim and no verdict is given", () => {
  const ledger = applyUsageRecord(emptyLedger(RUN), usage(1, 12)).ledger;
  const decision = enforce({
    point: "usage-record",
    ceilings: COST_CEILING,
    ledger,
    processes: [liveProcess(1)],
  });
  assert.equal(decision.keepsTheWorkAsAClaim, true);
  assert.equal(decision.givesNoVerdict, true);
  assert.equal(KEEPS_THE_WORK_AS_A_CLAIM, true);
  assert.equal(GIVES_NO_VERDICT, true);
  assert.deepEqual([...decision.stopKinds], ["polite", "terminate", "kill"]);
});

/* ------------------------------------------------------------------ *
 * The remaining headroom as a process-level spending limit.
 * ------------------------------------------------------------------ */

test("CT-127-31: the headroom of a reading is what is left before the ceiling", () => {
  const ledger = applyUsageRecord(emptyLedger(RUN), usage(1, 4)).ledger;
  const reading = readCeiling({ scope: "run", dimension: "costUsd", limit: 10 }, { ledger });
  assert.equal(headroomOf(reading), 6);
  // Past the ceiling the headroom is 0, never negative.
  const past = readCeiling({ scope: "run", dimension: "costUsd", limit: 2 }, { ledger });
  assert.equal(headroomOf(past), 0);
  // An inactive ceiling has no headroom to give.
  const off = readCeiling({ scope: "run", dimension: "costUsd", limit: 0 }, { ledger });
  assert.equal(headroomOf(off), null);
});

test("CT-127-31: the remaining headroom is the SMALLEST of the active ceilings", () => {
  let ledger = emptyLedger(RUN);
  ledger = applyUsageRecord(ledger, usage(1, 4)).ledger;
  const headroom = headroomFor(
    "costUsd",
    [
      { scope: "run", dimension: "costUsd", limit: 10 },
      { scope: "role", role: "proposer", dimension: "costUsd", limit: 6 },
    ],
    { ledger },
  );
  // The role has 2 left, the run has 6: a pass may spend 2.
  assert.equal(headroom, 2);
});

test("CT-127-31: the headroom is passed ONLY where the descriptor declares the capability", () => {
  const ledger = applyUsageRecord(emptyLedger(RUN), usage(1, 4)).ledger;
  const without = spendingLimitForAPass(liveProcess(1), COST_CEILING, { ledger });
  assert.equal(without.declared, false);
  assert.equal(without.processSpendingLimit, null);
  assert.match(without.reason ?? "", /declares no process-level spending limit/);

  const withIt = spendingLimitForAPass(
    liveProcess(1, { declaresProcessSpendingLimit: true }),
    COST_CEILING,
    { ledger },
  );
  assert.equal(withIt.declared, true);
  assert.equal(withIt.processSpendingLimit, 6);
  assert.equal(withIt.reason, null);
});

test("CT-127-31: with no active cost ceiling there is no headroom to pass", () => {
  const ledger = applyUsageRecord(emptyLedger(RUN), usage(1, 4)).ledger;
  const decision = spendingLimitForAPass(
    liveProcess(1, { declaresProcessSpendingLimit: true }),
    [{ scope: "run", dimension: "costUsd", limit: 0 }],
    { ledger },
  );
  assert.equal(decision.processSpendingLimit, null);
  assert.match(decision.reason ?? "", /no active `costUsd` ceiling/);
});

test("CT-127-31: the decision reports the headroom of each cap of spend", () => {
  const ledger = applyUsageRecord(emptyLedger(RUN), usage(1, 4)).ledger;
  ledger.run.phaseAttempts = 1;
  const decision = enforce({
    point: "before-a-pass",
    ceilings: [
      { scope: "run", dimension: "costUsd", limit: 10 },
      { scope: "run", dimension: "calls", limit: 5 },
      { scope: "run", dimension: "phaseAttempts", limit: 3 },
    ],
    ledger,
    processes: [liveProcess(1)],
  });
  assert.equal(decision.headroom.costUsd, 6);
  assert.equal(decision.headroom.calls, 4);
  assert.equal(decision.headroom.phaseAttempts, 2);
  assert.equal(decision.headroom.tokens, null);
});

/* ------------------------------------------------------------------ *
 * The wall clock is reported apart, and ends no pass through this path.
 * ------------------------------------------------------------------ */

test("CT-127-31: a tripped `wallClock` is reported apart and ends no pass here", () => {
  const decision = enforce({
    point: "before-a-pass",
    ceilings: [{ scope: "run", dimension: "wallClock", limit: 30 }],
    ledger: emptyLedger(RUN),
    wallClockMinutes: 31,
    processes: [liveProcess(1)],
  });
  assert.equal(decision.wallClockTripped?.dimension, "wallClock");
  assert.equal(decision.mustEndThePass, false);
  assert.deepEqual([...decision.exhausted], []);
  assert.deepEqual([...decision.toEnd], []);
});
