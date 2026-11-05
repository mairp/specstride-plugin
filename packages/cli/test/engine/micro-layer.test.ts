/**
 * The per-attempt machine of the layer `micro` (feature 115) at the edge:
 * the checkpoint of a pass is read after the pass exits and accepted, the
 * inner check runs through the check runner with `check.started` and
 * `check.ended` events, a kept unit on a changed tree is given back, the caps
 * trip `off:micro` through the router with the announcement and the
 * `route.decided` event, an empty inner set leaves every unit `unchecked`
 * and goes off by `no-check`, and the state of an attempt continues on the
 * same ordinal.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMicroAttempt, writeCheckManifest } from "../../src/engine/micro-layer.ts";

/** The machine's fingerprint seam: the test moves the tree by hand. */
type Tree = { now: string };

const fixture = (commands: readonly { argv: readonly string[] }[] | undefined) => {
  const root = mkdtempSync(join(tmpdir(), "specstride-micro-"));
  const outbox = join(root, "outbox");
  const control = join(root, "control");
  mkdirSync(outbox);
  mkdirSync(control);
  const tree: Tree = { now: "tree-0" };
  const events: { type: string; fields: Record<string, unknown> }[] = [];
  const lines: string[] = [];
  const manifestPath = join(root, "manifest.json");
  const statePath = join(root, "micro", "phase1.json");
  // The launch writes a manifest per phase, an EMPTY one where the phase
  // declares no test script (F115-FR-021).
  writeCheckManifest({
    manifestPath,
    phase: 1,
    commands: (commands ?? []).map((command, index) => ({
      id: `check-${String(index + 1)}`,
      argv: command.argv,
      cwd: root,
      timeoutSec: 60,
    })),
    searchPath: process.env.PATH ?? "",
    write: (path, text) => {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, text);
    },
  });
  return { root, outbox, control, tree, events, lines, manifestPath, statePath };
};

const machineOf = (
  fx: ReturnType<typeof fixture>,
  attempt = 1,
  caps = { repairs: 2, cyclesExtra: 6, cyclesMin: 12, unresolvedUnits: 2 },
  runId = "run-test",
) =>
  createMicroAttempt({
    runId,
    phase: 1,
    attempt,
    outboxPath: fx.outbox,
    controlPlanePath: fx.control,
    statePath: fx.statePath,
    manifestPath: fx.manifestPath,
    phaseTaskIds: ["T001", "T002"],
    caps,
    closingCheckOn: true,
    emit: (type, fields) => fx.events.push({ type, fields: { ...fields } }),
    say: (line) => fx.lines.push(line),
    fingerprint: () => fx.tree.now,
  });

const writeCheckpoint = (fx: ReturnType<typeof fixture>, unitId: string, tasks: string[]): void => {
  writeFileSync(
    join(fx.outbox, `${unitId}.checkpoint.json`),
    JSON.stringify({ schema: "specstride.checkpoint/1", tasks }),
  );
};

const PASSING = [{ argv: [process.execPath, "-e", "process.exit(0)"] }];
const FAILING = [{ argv: [process.execPath, "-e", "process.exit(1)"] }];

test("a pass with a valid checkpoint: accepted, the check runs, the unit is kept and given back", async () => {
  const fx = fixture(PASSING);
  const machine = machineOf(fx);
  try {
    assert.match(machine.contractBlockText(), /## Checkpoint contract/);
    assert.match(machine.passInstruction("u1"), /u1\.checkpoint\.json/);
    machine.beforePass("u1");
    machine.nextUnitId();
    writeCheckpoint(fx, "u1", ["T001"]);
    fx.tree.now = "tree-1"; // the pass changed the tree
    const outcome = await machine.afterPass({
      unitId: "u1",
      passStartedAtMs: 0,
      passKilled: false,
      yieldInPass: false,
    });
    assert.equal(outcome.result, "accept");
    assert.equal(outcome.validCheckpoint, true);
    assert.equal(outcome.outcome, "kept");
    assert.equal(outcome.givenBack, true, "a changed tree gives the pass back");
    assert.equal(outcome.exemptShortPass, true);
    // The events of the layer, in order.
    assert.deepEqual(
      fx.events.map((event) => event.type),
      ["checkpoint.accepted", "check.started", "check.ended", "route.decided", "microloop.unit"],
    );
    assert.deepEqual(fx.events[0]?.fields.taskIds, ["T001"]);
    assert.equal(fx.events[1]?.fields.runner, "runtime");
    assert.equal(fx.events[2]?.fields.result, "pass");
    assert.equal(fx.events[4]?.fields.result, "kept");
    // The checkpoint moved into the control plane; the outbox file is gone.
    assert.ok(existsSync(join(fx.control, "unit:u1:checkpoint")));
    assert.ok(!existsSync(join(fx.outbox, "u1.checkpoint.json")));
    // The state persisted under the micro namespace.
    const state = JSON.parse(readFileSync(fx.statePath, "utf8")) as { cyclesSpent: number };
    assert.equal(state.cyclesSpent, 1);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("a checkpoint left over from an earlier pass is removed with the event", async () => {
  const fx = fixture(PASSING);
  const machine = machineOf(fx);
  try {
    writeCheckpoint(fx, "u1", ["T001"]);
    machine.beforePass("u1");
    assert.deepEqual(
      fx.events.map((event) => event.type),
      ["checkpoint.removed"],
    );
    assert.ok(!existsSync(join(fx.outbox, "u1.checkpoint.json")));
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("the caps trip off:micro: the announcement is said, the route.decided event names the rule", async () => {
  const fx = fixture(FAILING);
  const machine = machineOf(fx, 1, {
    repairs: 0,
    cyclesExtra: 6,
    cyclesMin: 12,
    unresolvedUnits: 1,
  });
  try {
    machine.nextUnitId();
    writeCheckpoint(fx, "u1", ["T001"]);
    const outcome = await machine.afterPass({
      unitId: "u1",
      passStartedAtMs: 0,
      passKilled: false,
      yieldInPass: false,
    });
    // The repairs are spent: the unit is unresolved; one unresolved unit is
    // over the cap of 1: the router returns off:micro by loop.caps.
    assert.equal(outcome.outcome, "unresolved");
    assert.equal(outcome.givenBack, false, "an off pass is accounted by the classic loop");
    const route = fx.events.find((event) => event.type === "route.decided");
    assert.equal(route?.fields.ruleId, "loop.caps");
    assert.equal(route?.fields.choice, "off:micro");
    assert.ok(
      fx.lines.some((line) => line.includes("layer micro off for the phase-attempt: caps")),
    );
    const unit = fx.events.find((event) => event.type === "microloop.unit");
    assert.equal(unit?.fields.layerOff, "caps");
    // The layer stays off for the attempt: the next pass is accounted classic.
    const next = await machine.afterPass({
      unitId: "u2",
      passStartedAtMs: 0,
      passKilled: false,
      yieldInPass: false,
    });
    assert.equal(next.result, "none");
    assert.equal(machine.counts().off, true);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("an empty inner set leaves every unit unchecked and goes off by no-check", async () => {
  const fx = fixture([]); // a phase without a test script: an EMPTY inner set
  const machine = machineOf(fx);
  try {
    for (const unit of ["u1", "u2"]) {
      machine.nextUnitId();
      writeCheckpoint(fx, unit, ["T001"]);
      const outcome = await machine.afterPass({
        unitId: unit,
        passStartedAtMs: 0,
        passKilled: false,
        yieldInPass: false,
      });
      assert.equal(outcome.outcome, "unchecked");
    }
    const route = fx.events.filter((event) => event.type === "route.decided").at(-1);
    assert.equal(route?.fields.ruleId, "loop.no-check");
    assert.equal(route?.fields.choice, "off:micro");
    assert.ok(fx.lines.some((line) => line.includes("no-check")));
    assert.equal(machine.counts().unchecked, 2);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("a refused checkpoint (a foreign task id) emits checkpoint.refused and changes no counter", async () => {
  const fx = fixture(PASSING);
  const machine = machineOf(fx);
  try {
    machine.nextUnitId();
    writeCheckpoint(fx, "u1", ["T999"]);
    const outcome = await machine.afterPass({
      unitId: "u1",
      passStartedAtMs: 0,
      passKilled: false,
      yieldInPass: false,
    });
    assert.equal(outcome.result, "refuse");
    assert.equal(outcome.exemptShortPass, false);
    assert.equal(fx.events[0]?.type, "checkpoint.refused");
    assert.equal(fx.events[0]?.fields.reason, "foreign-id");
    assert.equal(machine.counts().cycles, 0);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("the state continues on the same attempt ordinal and starts fresh on a new one", async () => {
  const fx = fixture(PASSING);
  try {
    machineOf(fx).nextUnitId();
    writeCheckpoint(fx, "u1", ["T001"]);
    fx.tree.now = "tree-1";
    await machineOf(fx).afterPass({
      unitId: "u1",
      passStartedAtMs: 0,
      passKilled: false,
      yieldInPass: false,
    });
    // A resume on the same ordinal continues the counts.
    assert.equal(machineOf(fx, 1).counts().cycles, 1);
    // A new ordinal starts fresh.
    assert.equal(machineOf(fx, 2).counts().cycles, 0);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("the loop-layer object registers the layer with its nine directives and five services", async () => {
  const fx = fixture(PASSING);
  try {
    const layer = machineOf(fx).loopLayer();
    assert.equal(layer.registration.id, "micro");
    assert.equal(layer.registration.ledgerNamespace, "micro");
    assert.equal(layer.registration.directives.length, 9);
    assert.deepEqual(layer.registration.services, [
      "check-runner",
      "router",
      "ledger-namespace:micro",
      "fingerprints",
      "fact-block-builder",
    ]);
    assert.equal(layer.contributePrompt({} as never).length, 1);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("a cap of one repair: the second failing unit of the task is unresolved and the layer goes off", async () => {
  // F115-FR-022 — the budget hands the repairs LEFT per task id (the cap
  // less the repairs already spent). With the cap at 1, the first failing
  // unit of T001 takes the one repair; the second has none left and is
  // unresolved, and one unresolved unit is over the cap of 1: off:micro.
  const fx = fixture(FAILING);
  const machine = machineOf(fx, 1, {
    repairs: 1,
    cyclesExtra: 6,
    cyclesMin: 12,
    unresolvedUnits: 1,
  });
  try {
    machine.nextUnitId();
    writeCheckpoint(fx, "u1", ["T001"]);
    const first = await machine.afterPass({
      unitId: "u1",
      passStartedAtMs: 0,
      passKilled: false,
      yieldInPass: false,
    });
    assert.equal(first.outcome, "repair", "the first failure takes the one repair");
    machine.nextUnitId();
    writeCheckpoint(fx, "u2", ["T001"]);
    const second = await machine.afterPass({
      unitId: "u2",
      passStartedAtMs: 0,
      passKilled: false,
      yieldInPass: false,
    });
    assert.equal(second.outcome, "unresolved", "no repair is left for T001");
    const route = fx.events.filter((event) => event.type === "route.decided").at(-1);
    assert.equal(route?.fields.ruleId, "loop.caps");
    assert.equal(route?.fields.choice, "off:micro");
    assert.equal(machine.counts().unresolved, 1);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("a new run at the same path starts the attempt fresh: no counter of the earlier run carries", async () => {
  // F115-FR-031 — resume reconstructs the counters of a phase attempt of
  // THIS run. A state file an earlier run left at the same path belongs to
  // an attempt that ended; a fresh run starts the attempt fresh.
  const fx = fixture(FAILING);
  const earlier = machineOf(fx, 1, {
    repairs: 1,
    cyclesExtra: 6,
    cyclesMin: 12,
    unresolvedUnits: 1,
  });
  try {
    earlier.nextUnitId();
    writeCheckpoint(fx, "u1", ["T001"]);
    const first = await earlier.afterPass({
      unitId: "u1",
      passStartedAtMs: 0,
      passKilled: false,
      yieldInPass: false,
    });
    assert.equal(first.outcome, "repair");
    assert.equal(earlier.nextUnitId(), "u2");

    const fresh = machineOf(
      fx,
      1,
      { repairs: 1, cyclesExtra: 6, cyclesMin: 12, unresolvedUnits: 1 },
      "run-later",
    );
    assert.equal(fresh.nextUnitId(), "u1", "the unit counter starts over");
    assert.equal(fresh.counts().units, 0);
    writeCheckpoint(fx, "u1", ["T001"]);
    const again = await fresh.afterPass({
      unitId: "u1",
      passStartedAtMs: 0,
      passKilled: false,
      yieldInPass: false,
    });
    assert.equal(again.outcome, "repair", "the repair budget of the earlier run did not carry");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
