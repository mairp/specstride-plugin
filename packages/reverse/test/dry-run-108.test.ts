/**
 * T025 — the tests of the dry run itself (F108-FR-005): the plan lines, the
 * engine command, the exit code, and the structural statement that this module
 * cannot launch anything.
 *
 * The parity test of T024 (`tests/parity/108/dry-run.test.ts`) drives the dry
 * run through the whole wrapper on FX-30/plan. These tests hold the module's
 * own pieces, including the cases the wrapper rarely reaches: an inventory with
 * no language and no framework, an oversize source, and the quoting of a path
 * with a space.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { dryRun, wrapper } from "../src/index.ts";
import type { PlanOutput, PlanResult } from "../src/plan/plan.ts";

const SRC = join(dirname(dirname(fileURLToPath(import.meta.url))), "src", "wrapper", "dry-run.ts");

/** A plan output with every key the dry run reads. */
function output(over: Partial<PlanOutput> = {}): PlanOutput {
  return {
    src: "/s",
    slug: "proj",
    feature: "reverse-proj",
    out: "/s/specs/001-as-is-proj",
    state_dir: "/c/state",
    run_state: "/c/state/run.json",
    inventory: "/c/inv.json",
    inventory_md: "/w/inv.md",
    driver: "/w/driver.md",
    verification_commands: "/c/commands.json",
    test_plan: "/w/test-plan.json",
    generate_tests: "/w/scaffolds",
    analysis: "/w/analysis.md",
    tasks_mode: "all",
    oversize: false,
    phases: [
      { n: 1, title: "Specification", lint_level: 1 },
      { n: 2, title: "Plan", lint_level: 2 },
    ],
    summary: {
      files: 12,
      skipped: 3,
      text_bytes: 4096,
      walk: "walk",
      git_head: null,
      languages: { typescript: 9, python: 3 },
      frameworks: ["node", "express"],
      units: 0,
      constitution: "to be written",
    },
    ...over,
  } as PlanOutput;
}

function result(over: Partial<PlanOutput> = {}): PlanResult {
  return {
    output: output(over),
    json: "{}",
    written: {},
    driver: "",
    phases: [],
    exitCode: 0,
  } as unknown as PlanResult;
}

describe("T025: the lines of the dry run (F108-FR-005)", () => {
  it("the heading, the ten labels, `phases:` and the orchestrator label are the as-is text", () => {
    assert.equal(
      dryRun.DRY_RUN_HEADING,
      "specstride reverse — dry run (no LLM call, nothing launched)",
    );
    assert.deepEqual(
      [...dryRun.DRY_RUN_LABELS],
      [
        "source",
        "inventory",
        "languages",
        "frameworks",
        "constitution",
        "output dir",
        "tasks mode",
        "inventory",
        "driver",
        "commands",
      ],
    );
    assert.equal(dryRun.DRY_RUN_PHASES_HEADING, "phases:");
    assert.equal(dryRun.DRY_RUN_ORCHESTRATOR_LABEL, "  orchestrator (not executed):");
    assert.equal(dryRun.DRY_RUN_EXIT_CODE, 0);
  });

  it("`labelled` is `<label>: <value>`", () => {
    assert.equal(dryRun.labelled("source", "/s"), "source: /s");
  });

  it("the `inventory` counts line names files, skipped, bytes, oversize and units", () => {
    assert.equal(
      dryRun.inventoryCountsOf({ files: 12, skipped: 3, text_bytes: 4096, units: 0 }, false),
      "12 files, 3 skipped, 4096 bytes, oversize false, 0 units",
    );
    assert.equal(
      dryRun.inventoryCountsOf({ files: 900, skipped: 7, text_bytes: 9_000_000, units: 4 }, true),
      "900 files, 7 skipped, 9000000 bytes, oversize true, 4 units",
    );
  });

  it("a phase line is `<n>. <title>  (lint --upto <level>)`, with TWO spaces", () => {
    assert.equal(
      dryRun.phaseLine({ n: 3, title: "Data model", lint_level: 2 }),
      "3. Data model  (lint --upto 2)",
    );
  });

  it("the lines come in the order of the requirement, and the command is LAST", () => {
    const lines = dryRun.dryRunLines({ result: result(), executable: "specstride", argv: ["--x"] });
    assert.deepEqual(
      [...lines],
      [
        "specstride reverse — dry run (no LLM call, nothing launched)",
        "source: /s",
        "inventory: 12 files, 3 skipped, 4096 bytes, oversize false, 0 units",
        "languages: python, typescript",
        "frameworks: node, express",
        "constitution: to be written",
        "output dir: /s/specs/001-as-is-proj",
        "tasks mode: all",
        "inventory: /c/inv.json",
        "driver: /w/driver.md",
        "commands: /c/commands.json",
        "phases:",
        "1. Specification  (lint --upto 1)",
        "2. Plan  (lint --upto 2)",
        "  orchestrator (not executed):",
        "    SPECSTRIDE_GIT_COMMITS=off specstride --x",
      ],
    );
  });

  it("the languages are SORTED and the frameworks keep the inventory's order", () => {
    const lines = dryRun.dryRunLines({
      result: result({
        summary: {
          ...output().summary,
          languages: { zig: 1, c: 2, typescript: 3 },
          frameworks: ["zod", "express"],
        },
      }),
      executable: "specstride",
      argv: [],
    });
    assert.ok(lines.includes("languages: c, typescript, zig"));
    assert.ok(lines.includes("frameworks: zod, express"));
  });

  it("an empty language or framework set prints `-` and never an empty value", () => {
    const lines = dryRun.dryRunLines({
      result: result({
        summary: { ...output().summary, languages: {}, frameworks: [] },
      }),
      executable: "specstride",
      argv: [],
    });
    assert.ok(lines.includes("languages: -"));
    assert.ok(lines.includes("frameworks: -"));
    assert.equal(dryRun.EMPTY_VALUE, "-");
  });

  it("one phase line per phase, however many the oversize plan made", () => {
    const phases = Array.from({ length: 9 }, (_, index) => ({
      n: index + 1,
      title: `Unit ${index + 1}`,
      lint_level: 0,
    }));
    const lines = dryRun.dryRunLines({
      result: result({ oversize: true, phases }),
      executable: "specstride",
      argv: [],
    });
    const at = lines.indexOf("phases:");
    assert.equal(lines.length, at + 1 + 9 + 2);
    assert.equal(lines[at + 9], "9. Unit 9  (lint --upto 0)");
  });
});

describe("T025: the engine command of the dry run (F108-FR-005)", () => {
  it("the command is indented, prefixed `SPECSTRIDE_GIT_COMMITS=off` and shell-quoted", () => {
    assert.equal(dryRun.COMMIT_SWITCH_VARIABLE, "SPECSTRIDE_GIT_COMMITS");
    assert.equal(dryRun.COMMIT_SWITCH_OFF, "off");
    assert.equal(dryRun.COMMIT_SWITCH_PREFIX, "SPECSTRIDE_GIT_COMMITS=off");
    assert.equal(
      dryRun.engineCommandLine("/usr/bin/specstride", ["--workdir", "/a b", "--feature", "r-x"]),
      "    SPECSTRIDE_GIT_COMMITS=off /usr/bin/specstride --workdir '/a b' --feature r-x",
    );
  });

  it("the printed prefix and the commit switch of the wrapper carry the SAME value", () => {
    // One spelling of `off`, so the printed command and the real start agree.
    assert.equal(wrapper.COMMIT_SWITCH_VALUE, dryRun.COMMIT_SWITCH_OFF);
    assert.equal(wrapper.COMMIT_SWITCH, "loop.gitCommits=off");
    assert.equal(wrapper.COMMIT_SWITCH_PREFIX, dryRun.COMMIT_SWITCH_PREFIX);
  });

  it("the command RENDERS the argument list it is given and never rebuilds it", () => {
    const argv = ["--workdir", "/s", "--set", "loop.gitCommits=off", "--verbose"];
    const line = dryRun.engineCommandLine("specstride", argv);
    assert.equal(line, `    SPECSTRIDE_GIT_COMMITS=off specstride ${argv.join(" ")}`);
  });
});

describe("T025: the dry run withholds the launch (F108-FR-005, principle XV)", () => {
  it("the outcome is the lines, exit 0 and `launched: false`", () => {
    const outcome = dryRun.dryRunOutcome({
      result: result(),
      executable: "specstride",
      argv: ["--workdir", "/s"],
    });
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.launched, false);
    assert.deepEqual(
      [...outcome.stdout],
      [
        ...dryRun.dryRunLines({
          result: result(),
          executable: "specstride",
          argv: ["--workdir", "/s"],
        }),
      ],
    );
  });

  it("the module holds NO way to start a process: no `child_process`, no spawn, no submitter", () => {
    const source = readFileSync(SRC, "utf8");
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(?:\*|\/\*|\/\/)/.test(line))
      .join("\n");
    for (const forbidden of [
      "child_process",
      "spawnSync",
      "spawn(",
      "execFile",
      "exec(",
      "submit",
      "foreground",
      "engineRunRequest",
    ]) {
      assert.equal(code.includes(forbidden), false, `dry-run.ts names ${forbidden}`);
    }
  });

  it("every exported function of the module returns strings only", () => {
    const values = Object.values(dryRun as Record<string, unknown>);
    assert.ok(values.length > 0);
    assert.equal(typeof dryRun.engineCommandLine("specstride", []), "string");
    assert.equal(typeof dryRun.labelled("a", "b"), "string");
    assert.equal(typeof dryRun.phaseLine({ n: 1, title: "t", lint_level: 0 }), "string");
    assert.ok(Array.isArray(dryRun.dryRunLines({ result: result(), executable: "s", argv: [] })));
    assert.ok(
      dryRun
        .dryRunLines({ result: result(), executable: "s", argv: [] })
        .every((line) => typeof line === "string"),
    );
  });

  it("the lines are frozen, so a caller cannot append a launch line to them", () => {
    const lines = dryRun.dryRunLines({ result: result(), executable: "s", argv: [] });
    assert.ok(Object.isFrozen(lines));
    assert.throws(() => (lines as string[]).push("reverse: launching s"));
  });
});
