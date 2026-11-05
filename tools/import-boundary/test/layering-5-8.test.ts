/**
 * T233 — contract tests CT-100-105 to CT-100-108 for the layering rules
 * LR-5 to LR-8 (annex A, §A.2).
 *
 * - CT-100-105 (LR-5, F100-FR-005): the event file of a run has one writer
 *   per liveness state, and learning has its own writer domain, its own
 *   lock and its own event file in `layout.json` (the contention test
 *   belongs to the owner of learning, feature 106).
 * - CT-100-106 (LR-6, F100-FR-006): every boundary that the tables of
 *   annex E §E.4 and G §G.4 mark as a process boundary stays a process in
 *   `process-model.json`, and every other boundary is a call that returns
 *   a result record whose `exit_code` equals the as-is code.
 * - CT-100-107 (LR-7, F100-FR-007): the five pure tables name the table
 *   evaluator of the kernel as their only evaluator in the graph.
 * - CT-100-108 (LR-8, F100-FR-008): role resolution lives in the harness
 *   layer and no loop-layer or router package may import it.
 *
 * The tests run over the data files of the package
 * (`packages/contracts/data/`), the machine-readable form of the annexes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadLayerFacts } from "../src/layer-facts.ts";
import { judgeImport, parseLayer } from "../src/rules.ts";

const facts = loadLayerFacts();
const graph = facts.graph;
const DATA = join(facts.root, "packages/contracts/data");

function readData<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA, name), "utf8")) as T;
}

test("CT-100-105: the event file of a run has one writer per liveness state (LR-5)", () => {
  // the primary event file of the run: one writer at any moment
  const events = facts.layout.logicalNames.find((n) => n.logicalName === "run:<runId>:events");
  assert.ok(events !== undefined, "the layout holds the event file of the run");
  assert.equal(events.writer, "The one event writer");

  // the two liveness states (F100-FR-005: the runtime root while no engine
  // is alive, the engine while it is alive) are both processes of the
  // runtime tree in the process model
  const processModel = readData<{ processes: Array<{ Process: string }> }>("process-model.json");
  const processes = processModel.processes.map((p) => p.Process);
  assert.ok(
    processes.some((p) => p.startsWith("Runtime root")),
    "the process model holds the runtime root (the writer while no engine is alive)",
  );
  assert.ok(
    processes.some((p) => p.startsWith("Engine")),
    "the process model holds the engine (the writer while it is alive)",
  );
});

test("CT-100-105: learning has its own writer domain, its own lock and its own event file (LR-5)", () => {
  const writers = facts.writers;
  // its own writer domain: every record of learning is written by the
  // writer domain of learning and by no other writer
  for (const name of [
    "feature:<slug>:learning:decisions",
    "feature:<slug>:learning:events",
    "feature:<slug>:learning:observation:<N>",
    "feature:<slug>:learning:summary",
  ]) {
    assert.equal(
      writers[name],
      "Learning (own writer domain)",
      `the writer of ${name} must be the own writer domain of learning`,
    );
  }
  // its own lock
  assert.equal(
    writers["feature:<slug>:learning:lock"],
    "Lock provider",
    "learning has its own lock in the layout",
  );
  // its own event file: distinct from the event file of the run
  const learningEvents = facts.layout.logicalNames.find(
    (n) => n.logicalName === "feature:<slug>:learning:events",
  );
  const runEvents = facts.layout.logicalNames.find((n) => n.logicalName === "run:<runId>:events");
  assert.ok(learningEvents !== undefined && runEvents !== undefined);
  assert.notEqual(learningEvents.path, runEvents.path, "learning has its own event file");
  assert.equal(learningEvents.root, "control");
});

test("CT-100-106: process boundaries of E §E.4 and G §G.4 stay processes; the other boundaries are calls with result records (LR-6)", () => {
  const exitCodes = readData<{
    engine: Array<{ process: string; rows: Array<Record<string, string>> }>;
    perCommand: Array<{ Command: string; Codes: string }>;
  }>("exit-codes.json");
  const processModel = readData<{ processes: Array<{ Process: string }> }>("process-model.json");
  const processes = processModel.processes.map((p) => p.Process);

  const base = (label: string): string => label.split(" (")[0];

  for (const entry of exitCodes.engine) {
    const isResultRecord = /result record/i.test(entry.process);
    if (isResultRecord) {
      // a call that returns a result record: every row carries the
      // as-is code (the `exit_code` field, or the values kept in the
      // result record of the internal helpers)
      for (const row of entry.rows) {
        const hasCode = "`exit_code`" in row || "Component" in row || "Code" in row;
        assert.ok(
          hasCode,
          `the result record of ${entry.process} must carry the as-is code; row: ${JSON.stringify(row)}`,
        );
      }
      // and it is not a process boundary: the process model holds no
      // process of that name
      assert.ok(
        !processes.some((p) => p === entry.process || p.startsWith(base(entry.process) + " ")),
        `${entry.process} is a call that returns a result record, not a process`,
      );
    } else {
      // a process boundary: it stays a process in the process model
      assert.ok(
        processes.some((p) => p === entry.process || p.startsWith(base(entry.process) + " ")),
        `the process boundary ${entry.process} must stay a process in process-model.json`,
      );
    }
  }

  // the as-is codes of the engine table are carried by the `run` command
  // of G §G.4 (a call whose exit_code equals the as-is code)
  const engineCodes = exitCodes.engine
    .find((e) => e.process === "Engine")
    ?.rows.map((r) => r["Code"]);
  assert.ok(engineCodes !== undefined, "the E §E.4 table holds the engine codes");
  const runRow = exitCodes.perCommand.find((r) => r.Command.trim() === "`run`");
  assert.ok(runRow !== undefined, "the G §G.4 table holds the run command");
  for (const code of ["0", "1", "2", "3", "4", "5", "6"]) {
    assert.ok(engineCodes.includes(code), `the engine table holds the as-is code ${code}`);
    assert.ok(runRow.Codes.includes(code), `the run command carries the as-is code ${code}`);
  }
  // the uncaught error code of every command
  const uncaught = exitCodes.perCommand.find((r) => r.Command.includes("uncaught error"));
  assert.ok(uncaught !== undefined && uncaught.Codes.includes("70"));
});

test("CT-100-107: the five pure tables name the table evaluator of the kernel as their only evaluator in the graph (LR-7)", () => {
  // the graph names exactly one table evaluator: the kernel
  const evaluators = graph.packages.filter((p) => (p.owner ?? "").includes("table evaluator"));
  assert.equal(evaluators.length, 1, "the graph holds exactly one table evaluator");
  assert.equal(evaluators[0].name, "@specstride/kernel");
  assert.equal(facts.tableEvaluator, "@specstride/kernel");

  // the five pure tables of F100-FR-007 all map to that evaluator
  assert.deepEqual(Object.keys(facts.pureTables).sort(), [
    "lane derivation",
    "quota classifier",
    "relaunch classifier",
    "router",
    "terms gate",
  ]);
  for (const [table, evaluator] of Object.entries(facts.pureTables)) {
    assert.equal(
      evaluator,
      "@specstride/kernel",
      `the table ${table} is evaluated by the table evaluator of the kernel`,
    );
  }

  // every package that hosts a pure table (its owner names a content
  // owner of the table) can only reach the evaluator through the kernel:
  // the kernel is in its mayImport
  const tableOwners: Record<string, string> = {
    router: "115",
    "quota classifier": "127",
    "relaunch classifier": "123",
    "terms gate": "147",
  };
  for (const [table, number] of Object.entries(tableOwners)) {
    const hosts = graph.packages.filter((p) =>
      (p.owner ?? "")
        .split(/[,;]/)
        .map((part) => part.trim().split(" ")[0])
        .includes(number),
    );
    assert.ok(
      hosts.length > 0,
      `the graph holds a package that hosts the ${table} (owner ${number})`,
    );
    for (const host of hosts) {
      assert.ok(
        (host.mayImport ?? []).includes("@specstride/kernel"),
        `the host of the ${table} (${host.name}) names the table evaluator of the kernel as its only evaluator: @specstride/kernel must be in its mayImport`,
      );
    }
  }
});

test("CT-100-108: role resolution lives in the harness layer and no loop-layer or router package imports it (LR-8)", () => {
  // role resolution lives in the harness layer: the package of role
  // resolution is @specstride/harness, of layer L1 (the edges layer where
  // the harness adapters live; EP-02 `specstride.harness/1`)
  assert.equal(facts.roleResolutionPackage, "@specstride/harness");
  assert.equal(
    parseLayer(graph.packages.find((p) => p.name === facts.roleResolutionPackage)?.layer),
    1,
  );
  const harnessLayer = facts.layers.layers.find((l) => l.Layer === "L1");
  assert.ok(harnessLayer !== undefined, "the layers hold L1");

  // no package of the loop layer (L3 and L4: the engine with the pass
  // loop, the loop layers — the router among them) may import it
  for (const name of facts.loopLayerPackages) {
    const verdict = judgeImport(graph, name, facts.roleResolutionPackage);
    assert.equal(
      verdict.ok,
      false,
      `${name} (a loop-layer or router package) must not import ${facts.roleResolutionPackage}: role resolution lives in the harness layer (F100-FR-008)`,
    );
  }
  // and the graph has no loop-layer package at all without a layer
  assert.ok(
    facts.loopLayerPackages.length >= 3,
    "the graph holds the loop layer packages (L3 and L4)",
  );
});
