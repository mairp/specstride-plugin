/**
 * T077 — contract tests CT-100-241 and CT-100-242 for the states and the
 * transitions of the run-state machine (annex E, §E.2; F100-FR-141,
 * F100-FR-142).
 *
 * The tests bind the implementation of T078 to the keys `states` and
 * `transitions` of `data/run-state-machine.json` and to the diagram of
 * "State transitions", "Run" of `data-model.md`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import machine from "../data/run-state-machine.json" with { type: "json" };
import { closedSets } from "../src/enums/all-sets.ts";
import {
  ANNEX_SECTION,
  DERIVED_RUN_CONDITIONS,
  LIVE_STATES,
  QUOTA_PAUSE_IS_A_STATE,
  QUOTA_PAUSE_IS_A_STOP,
  RESTING_STATES,
  RESTING_STATE_BLOCKED_ON_HUMAN,
  RUN_STATES,
  SCHEMA_ID,
  TRANSITIONS,
  TRANSITIONS_OF_A_HOST,
  TRANSITIONS_OF_THE_CLI,
  TRANSITION_IDS,
  isDerivedRunCondition,
  isRestingState,
  isRunState,
  mayWrite,
  runStateRow,
  runStateRows,
  runStateSet,
  transitionOf,
  transitionsFrom,
  transitionsTo,
  whyNotWritable,
  type WritingProcess,
} from "../src/state/run-state.ts";
import { STOP_REASONS } from "../src/codes/stop-reasons.ts";

const RAW = machine as {
  schema: string;
  states: Record<string, string>[];
  transitions: Record<string, string>[];
};

const bare = (cell: string): string =>
  cell
    .replace(/\(derived\)/gi, "")
    .replace(/`/g, "")
    .trim();

test("CT-100-241: the machine has the ten written states of §E.2 and no other", () => {
  assert.equal(SCHEMA_ID, "specstride.run-state/1");
  assert.equal(RAW.schema, SCHEMA_ID);
  assert.equal(ANNEX_SECTION, "annex E, §E.2");

  // The data file holds eleven rows: the ten written states and `dead`.
  assert.equal(RAW.states.length, 11);
  assert.equal(RUN_STATES.length, 10);
  const written = RAW.states
    .filter((row) => !/\(derived\)/i.test(row.State ?? ""))
    .map((row) => bare(row.State ?? ""));
  assert.deepEqual([...RUN_STATES], written);

  // Every row of the table has its three cells.
  assert.equal(runStateRows.length, 11);
  for (const row of runStateRows) {
    assert.notEqual(row.processAlive.trim(), "", `${row.state} says which process is alive`);
    assert.notEqual(row.lockHeld.trim(), "", `${row.state} says whether the lock is held`);
    assert.notEqual(row.meaning.trim(), "", `${row.state} has a meaning`);
  }

  // Exactly one of the ten holds at a time: `isRunState` accepts them and
  // nothing else, and a derived condition is not a state.
  for (const state of RUN_STATES) assert.ok(isRunState(state), state);
  for (const condition of DERIVED_RUN_CONDITIONS) {
    assert.equal(isRunState(condition), false, `${condition} is derived, never written`);
    assert.ok(isDerivedRunCondition(condition), condition);
  }
  assert.equal(isRunState("invented"), false);
});

test("CT-100-241: `dead`, `stale` and `launch-abandoned` are derived and never written", () => {
  assert.deepEqual([...DERIVED_RUN_CONDITIONS], ["dead", "stale", "launch-abandoned"]);
  // Row 2 of §X.6 holds the same three.
  const row2 = closedSets.get(2);
  assert.notEqual(row2, undefined);
  assert.deepEqual([...(row2?.members ?? [])], [...DERIVED_RUN_CONDITIONS]);

  // `dead` is the row the table marks "(derived)": never written.
  const dead = runStateRow("dead");
  assert.notEqual(dead, undefined);
  assert.equal(dead?.derived, true);
  assert.match(String(dead?.meaning), /Never written/);

  // Row 1 of §X.6 holds the ten written states, and not the derived ones.
  assert.equal(runStateSet.number, 1);
  assert.equal(runStateSet.byReference, true);
  assert.deepEqual([...runStateSet.members], [...RUN_STATES]);
  for (const condition of DERIVED_RUN_CONDITIONS) {
    assert.equal(runStateSet.has(condition), false, `${condition} is not a written state`);
  }
  assert.deepEqual([...(closedSets.get(1)?.members ?? [])], [...RUN_STATES]);
});

test("CT-100-241: a quota pause is a state and never a stop (F100-FR-141)", () => {
  assert.equal(QUOTA_PAUSE_IS_A_STATE, "paused-quota");
  assert.ok(isRunState(QUOTA_PAUSE_IS_A_STATE));
  assert.equal(QUOTA_PAUSE_IS_A_STOP, false);
  // It is not a member of the stop reasons of §E.3.
  assert.equal((STOP_REASONS as readonly string[]).includes("paused-quota"), false);
  // The row of the state says no budget of any kind is spent.
  assert.match(String(runStateRow("paused-quota")?.meaning), /No budget of any kind is spent/);
});

test("CT-100-241: `blocked-on-human` rests: no process, the lock released, left by `resume`", () => {
  const row = runStateRow("blocked-on-human");
  assert.notEqual(row, undefined);
  assert.equal(row?.processAlive, "None");
  assert.equal(row?.lockHeld, "No");
  assert.match(String(row?.meaning), /rests until `resume`/);

  assert.equal(RESTING_STATE_BLOCKED_ON_HUMAN.state, "blocked-on-human");
  assert.equal(RESTING_STATE_BLOCKED_ON_HUMAN.processAlive, false);
  assert.equal(RESTING_STATE_BLOCKED_ON_HUMAN.lockHeld, false);
  assert.equal(RESTING_STATE_BLOCKED_ON_HUMAN.leftOnlyBy, "resume");

  assert.ok(isRestingState("blocked-on-human"));
  assert.equal(isRestingState("running"), false);
  assert.deepEqual([...RESTING_STATES], ["blocked-on-human", "finished", "stopped", "failed"]);
  assert.equal(LIVE_STATES.length + RESTING_STATES.length, RUN_STATES.length);

  // It is left only by `resume`: T17 is the one transition that leaves it.
  const out = transitionsFrom("blocked-on-human");
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, "T17");
  assert.match(String(out[0]?.trigger), /`resume`/);
});

test("CT-100-242: the only transitions are T1 to T18, each as the data file holds it", () => {
  assert.equal(RAW.transitions.length, 18);
  assert.equal(TRANSITIONS.length, 18);
  assert.deepEqual(
    [...TRANSITION_IDS],
    Array.from({ length: 18 }, (_unused, index) => `T${index + 1}`),
  );

  for (const raw of RAW.transitions) {
    const id = raw["#"] ?? "";
    const row = transitionOf(id);
    assert.notEqual(row, undefined, `${id} has a row`);
    if (row === undefined) continue;
    assert.equal(row.fromCell, raw.From);
    assert.equal(row.to, bare(raw.To ?? ""));
    assert.equal(row.trigger, raw.Trigger);
    assert.equal(row.owner, raw.Owner);
    assert.equal(row.written, raw.Written);
    // Every state the "From" cell names in back-ticks is carried.
    const named = [...(raw.From ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
    assert.deepEqual([...row.from], named.length > 0 ? named : [...row.from]);
    // The target is a written state or a derived condition.
    assert.ok(
      isRunState(row.to) || isDerivedRunCondition(row.to),
      `${id} enters ${row.to}, which is a state or a derived condition`,
    );
  }

  // A transition the table does not hold is not a transition.
  assert.equal(transitionOf("T19"), undefined);
  assert.equal(transitionOf("T0"), undefined);
});

test("CT-100-242: the diagram of data-model.md — every state is reachable and leaves", () => {
  // T1 is the only transition with no "From": it creates the run.
  const roots = TRANSITIONS.filter((t) => t.from.length === 0);
  assert.equal(roots.length, 1);
  assert.equal(roots[0]?.id, "T1");
  assert.equal(roots[0]?.to, "created");

  // Every written state other than `created` is entered by a transition.
  for (const state of RUN_STATES) {
    if (state === "created") {
      assert.ok(transitionsTo(state).length >= 1, `${state} is entered by T1 and T17`);
      continue;
    }
    assert.ok(transitionsTo(state).length >= 1, `${state} is entered by a transition`);
  }
  // Every live state leaves again; every resting state is left by T17 alone
  // (`finished` rests for good: the run is done).
  for (const state of LIVE_STATES) {
    assert.ok(transitionsFrom(state).length >= 1, `${state} leaves again`);
  }
  for (const state of ["blocked-on-human", "stopped", "failed"] as const) {
    const out = transitionsFrom(state);
    assert.deepEqual(
      out.map((t) => t.id),
      ["T17"],
      `${state} is left by \`resume\` alone`,
    );
  }
  // `dead` is entered by T18 from any live state and left by T17.
  const t18 = transitionOf("T18");
  assert.deepEqual([...(t18?.from ?? [])], [...LIVE_STATES]);
  assert.equal(t18?.to, "dead");
  assert.equal(t18?.derived, true);
  assert.ok((transitionOf("T17")?.from ?? []).includes("dead"));
});

test("CT-100-242: `mayWrite` — a host never, the CLI only T1, T2, T3 and T17", () => {
  assert.deepEqual([...TRANSITIONS_OF_THE_CLI], ["T1", "T2", "T3", "T17"]);
  assert.deepEqual([...TRANSITIONS_OF_A_HOST], []);

  for (const id of TRANSITION_IDS) {
    // A host writes no transition at all (F100-FR-142).
    assert.equal(mayWrite(id, "host"), false, `a host may not write ${id}`);
    assert.match(String(whyNotWritable(id, "host")), /a host writes no transition of a run/);

    // The CLI writes only the four.
    const cliMay = (TRANSITIONS_OF_THE_CLI as readonly string[]).includes(id);
    assert.equal(mayWrite(id, "cli"), cliMay, `the CLI and ${id}`);
    if (!cliMay) {
      assert.match(String(whyNotWritable(id, "cli")), /the CLI writes only the transitions/);
    } else {
      assert.equal(whyNotWritable(id, "cli"), undefined);
    }
  }

  // Every transition the CLI may write is a transition into or out of
  // `created`, and no other transition of the table is owned by the CLI.
  for (const id of TRANSITIONS_OF_THE_CLI) {
    const row = transitionOf(id);
    assert.ok(row?.to === "created" || row?.from.includes("created"), `${id} touches \`created\``);
  }
  const ownedByTheCli = TRANSITIONS.filter((t) => t.owners.includes("cli")).map((t) => t.id);
  assert.deepEqual(ownedByTheCli, [...TRANSITIONS_OF_THE_CLI]);
});

test("CT-100-242: `mayWrite` follows the column Owner for the root and the engine", () => {
  for (const row of TRANSITIONS) {
    if (row.derived) {
      for (const process of ["cli", "root", "engine", "host", "nobody"] as WritingProcess[]) {
        assert.equal(mayWrite(row.id, process), false, `${row.id} is derived: nobody writes it`);
      }
      continue;
    }
    assert.equal(mayWrite(row.id, "root"), row.owners.includes("root"), `root and ${row.id}`);
    assert.equal(mayWrite(row.id, "engine"), row.owners.includes("engine"), `engine and ${row.id}`);
  }

  // §E.2 — in start mode `standalone` there is no root, and the engine owns
  // every transition the table gives to the root.
  for (const row of TRANSITIONS) {
    if (row.derived) continue;
    const expected = row.owners.includes("engine") || row.owners.includes("root");
    assert.equal(
      mayWrite(row.id, "engine", "standalone"),
      expected,
      `the engine in \`standalone\` and ${row.id}`,
    );
  }
  // In `child` the engine does not write a transition of the root: T4 is one.
  assert.equal(mayWrite("T4", "engine", "child"), false);
  assert.equal(mayWrite("T4", "engine", "standalone"), true);
  assert.equal(mayWrite("T4", "root"), true);
});
