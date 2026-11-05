/**
 * T027 — the unit tests of default output itself (F108-FR-034, F108-SC-006).
 *
 * `tests/characterization/108/budget.test.ts` drives default output from REAL
 * runs of the wrapper, the plan and the guard and measures the bytes. These
 * tests hold the module's own pieces, including the cases a run rarely reaches:
 * the elision arithmetic at the exact boundary of the cap, a command the cap
 * does not apply to, an empty failure, and the structural statement that no
 * line of this module names state by a physical path.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { defaultOutput } from "../src/index.ts";
import type { PlanOutput } from "../src/plan/plan.ts";

const SRC = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  "src",
  "wrapper",
  "default-output.ts",
);

/** A plan output with every key the lines of default output read. */
function output(over: Partial<PlanOutput> = {}): PlanOutput {
  return {
    src: "/s",
    slug: "proj",
    feature: "reverse-proj",
    out: "/s/specs/001-as-is-proj",
    state_dir: "/s/.specstride",
    run_state: "/s/.specstride/reverse/proj",
    inventory: "/c/inv.json",
    inventory_md: "/s/.specstride/reverse/proj/inventory.md",
    driver: "/s/.specstride/reverse/proj/driver.md",
    verification_commands: "/c/commands.json",
    test_plan: "/s/.specstride/reverse/proj/test-plan.json",
    generate_tests: "/s/.specstride/reverse/proj/scaffolds",
    analysis: "/s/.specstride/reverse/proj/analysis.md",
    tasks_mode: "done",
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
      languages: { typescript: 12 },
      frameworks: [],
      units: 0,
      constitution: "to be written",
    },
    ...over,
  } as PlanOutput;
}

describe("the cap and the budget it comes from", () => {
  it("the two caps are 1,120 and 2,240 bytes, and the failure cap is twice the other", () => {
    assert.equal(defaultOutput.BUDGET_BYTES, 1120);
    assert.equal(defaultOutput.FAILURE_BUDGET_BYTES, 2240);
    assert.equal(defaultOutput.FAILURE_BUDGET_BYTES, defaultOutput.BUDGET_BYTES * 2);
    assert.equal(defaultOutput.budgetOf("success"), 1120);
    assert.equal(defaultOutput.budgetOf("failure"), 2240);
  });

  it("the budget of the host skill is read from annex G §G.5 and not from a literal here", () => {
    assert.equal(defaultOutput.HOST_SKILL, "specstride-reverse");
    assert.equal(defaultOutput.hostSkillTokenBudget(), 7000);
    assert.equal(defaultOutput.hostSkillByteBudget(), Math.floor(7000 * 2.8));
    const source = readFileSync(SRC, "utf8");
    assert.match(source, /@specstride\/contracts\/data\/cli-protocol\.json/);
    assert.ok(
      !/7[,_]?000/.test(source.replace(/BYTES_PER_TOKEN = 2\.8/, "")),
      "the number 7,000 appears nowhere in the module: it is read from the contract",
    );
  });

  it("the bytes of an output are the lines with their line ends; nothing printed is zero", () => {
    assert.equal(defaultOutput.byteLengthOfOutput([]), 0);
    assert.equal(defaultOutput.byteLengthOfOutput(["ab"]), 3);
    assert.equal(defaultOutput.byteLengthOfOutput(["ab", "cd"]), 6);
    assert.equal(defaultOutput.byteLengthOfOutput(["é"]), 3, "bytes, not characters");
  });
});

describe("which commands the cap applies to", () => {
  it("the four commands between invocation and launch, and `reverse lint` outside", () => {
    assert.deepEqual(
      [...defaultOutput.COMMANDS_BETWEEN_INVOCATION_AND_LAUNCH],
      ["reverse", "reverse plan", "reverse inventory", "reverse guard"],
    );
    assert.deepEqual([...defaultOutput.COMMANDS_OUTSIDE_THE_CAP], ["reverse lint"]);
    assert.equal(defaultOutput.isInsideTheCap("reverse lint"), false);
    assert.equal(defaultOutput.isInsideTheCap("something else"), false);
  });

  it("a command outside the cap is measured but never bounded", () => {
    const items = Array.from({ length: 50 }, (_v, index) => ({
      item: `finding ${index}`,
      fix: "f",
    }));
    const lint = defaultOutput.defaultOutputOf({ command: "reverse lint", failingItems: items });
    assert.equal(lint.capped, false);
    assert.equal(lint.lines.length, 50);
    const capped = defaultOutput.defaultOutputOf({ command: "reverse guard", failingItems: items });
    assert.equal(capped.capped, true);
    assert.ok(capped.measure.within);
  });
});

describe("the failure output and its arithmetic", () => {
  it("no item is an empty output, and one item is one line", () => {
    assert.deepEqual([...defaultOutput.failureOutput([])], []);
    const one = defaultOutput.failureOutput([{ item: "changed: a", fix: "restore a" }]);
    assert.deepEqual([...one], ["reverse: changed: a — fix: restore a"]);
  });

  it("the bound holds for every budget from 0 to 400 bytes, with 40 items", () => {
    const items = Array.from({ length: 40 }, (_v, index) => ({
      item: `changed: src/module-${index}.ts`,
      fix: "restore the path to its baseline content",
    }));
    for (let budget = 0; budget <= 400; budget += 1) {
      const lines = defaultOutput.failureOutput(items, budget);
      assert.ok(
        defaultOutput.byteLengthOfOutput(lines) <= budget,
        `budget ${budget}: ${defaultOutput.byteLengthOfOutput(lines)} bytes`,
      );
    }
  });

  it("where items are left out, the last line counts them and says where they are", () => {
    const items = Array.from({ length: 10 }, (_v, index) => ({
      item: `changed: src/module-${index}.ts`,
      fix: "restore it",
    }));
    const lines = defaultOutput.failureOutput(items, 200);
    const last = lines[lines.length - 1] as string;
    assert.match(last, /^reverse: and \d+ more failing item\(s\); the whole list is in/);
    const left = Number(/and (\d+) more/.exec(last)?.[1]);
    assert.equal(lines.length - 1 + left, items.length, "every item is printed or counted");
  });

  it("every line of a failure is a failing item with its fix, or the count of the rest", () => {
    const items = Array.from({ length: 100 }, (_v, index) => ({
      item: `added: ${index}`,
      fix: "remove it",
    }));
    for (const line of defaultOutput.failureOutput(items)) {
      assert.ok(line.includes(" — fix: ") || line.startsWith("reverse: and "), line);
    }
  });

  it("`clampToBytes` never exceeds the limit and never cuts a character in two", () => {
    for (const text of ["ascii".repeat(100), "é".repeat(100), "🙂".repeat(100)]) {
      for (const limit of [0, 1, 2, 3, 4, 7, 11, 53, 100]) {
        const clamped = defaultOutput.clampToBytes(text, limit);
        assert.ok(Buffer.byteLength(clamped, "utf8") <= limit, `${text[0]} at ${limit}`);
        assert.equal(Buffer.from(clamped, "utf8").toString("utf8"), clamped);
      }
    }
    assert.equal(
      defaultOutput.clampToBytes("short", 100),
      "short",
      "a line that fits is untouched",
    );
  });
});

describe("the lines name state by logical name", () => {
  it("no line of default output carries a physical path of the run's state", () => {
    const out = output();
    const lines = [
      defaultOutput.planSuccessLine(out),
      defaultOutput.launchSuccessLine(out, false),
      defaultOutput.launchSuccessLine(out, true),
      defaultOutput.dryRunSuccessLine(out),
      defaultOutput.guardSuccessLine(out.slug),
      defaultOutput.inventorySuccessLine(out.slug, 12),
    ];
    const paths = [
      out.inventory,
      out.inventory_md,
      out.driver,
      out.verification_commands,
      out.analysis,
      out.state_dir,
      out.run_state,
      out.out,
    ];
    for (const line of lines) {
      for (const path of paths) {
        assert.ok(!line.includes(path), `\`${line}\` must not carry ${path}`);
      }
      assert.match(line, /^reverse: /);
    }
    // ... and each names the logical names it is about.
    assert.match(lines[0] as string, /reverse:proj:inventory, reverse:proj:inventory-summary/);
    assert.match(lines[1] as string, /reverse:proj:driver/);
    assert.match(lines[4] as string, /reverse:proj:output/);
  });

  it("the logical names come from the plan's own table, not from strings here", () => {
    assert.equal(defaultOutput.logicalNameOf("driver", "x"), "reverse:x:driver");
    assert.equal(defaultOutput.logicalNameOf("inventory_md", "x"), "reverse:x:inventory-summary");
    assert.equal(defaultOutput.outputLogicalName("x"), "reverse:x:output");
    assert.deepEqual(
      [...defaultOutput.PLAN_FILES_WRITTEN],
      ["inventory", "inventory_md", "driver", "verification_commands"],
    );
  });

  it("an oversize run says so in its one line", () => {
    assert.match(defaultOutput.planSuccessLine(output({ oversize: true })), /, oversize;/);
    assert.ok(!defaultOutput.planSuccessLine(output()).includes("oversize"));
  });
});

describe("the `parity` profile and the output mode", () => {
  it("nothing is printed under `parity`, and the mode in force says why", () => {
    assert.equal(defaultOutput.outputModeInForce({ profile: "parity" }), "compat");
    assert.equal(defaultOutput.outputModeInForce({ outputCompat: true }), "compat");
    assert.equal(defaultOutput.outputModeInForce({}), "default");
    assert.equal(defaultOutput.mayPrintDefaultOutput({ profile: "parity" }), false);
    assert.equal(defaultOutput.mayPrintDefaultOutput({ outputCompat: true }), false);
    assert.equal(defaultOutput.mayPrintDefaultOutput({}), true);
    assert.equal(defaultOutput.LINES_HAVE_AN_AS_IS_EQUIVALENT, false);
    assert.deepEqual([...defaultOutput.linesInForce(["a"], { profile: "parity" })], []);
    assert.deepEqual([...defaultOutput.linesInForce(["a"], {})], ["a"]);
  });

  it("the module holds no runner, no spawn and no write: it returns strings", () => {
    const source = readFileSync(SRC, "utf8");
    for (const forbidden of ["spawn", "writeFileSync", "atomicWrite", "process.exit"]) {
      assert.ok(!source.includes(forbidden), `default output must not reach \`${forbidden}\``);
    }
  });
});

describe("the kinds of guard problem and their fixes", () => {
  it("a line the closed set does not describe still gets a fix", () => {
    assert.equal(defaultOutput.kindOfGuardProblem("something else"), undefined);
    const [item] = defaultOutput.guardFailingItems(["something else"]);
    assert.ok((item as { fix: string }).fix.length > 0);
  });

  it("every member of row 156 has its own fix", () => {
    const fixes = new Set(Object.values(defaultOutput.FIX_OF_GUARD_PROBLEM));
    assert.equal(fixes.size, defaultOutput.GUARD_PROBLEM_KINDS.length);
    for (const kind of defaultOutput.GUARD_PROBLEM_KINDS) {
      assert.ok(defaultOutput.FIX_OF_GUARD_PROBLEM[kind].length > 0, kind);
    }
  });
});

describe("`defaultOutputOf` as a whole", () => {
  it("a success with no line at all is an empty output and not a blank line", () => {
    const empty = defaultOutput.defaultOutputOf({ command: "reverse" });
    assert.deepEqual([...empty.lines], []);
    assert.equal(empty.measure.bytes, 0);
    assert.equal(empty.outcome, "success");
  });

  it("failing items decide the outcome, whatever else is passed", () => {
    const both = defaultOutput.defaultOutputOf({
      command: "reverse",
      successLine: "reverse: planned",
      failingItems: [{ item: "changed: a", fix: "restore a" }],
    });
    assert.equal(both.outcome, "failure");
    assert.equal(both.measure.budget, 2240);
    assert.deepEqual([...both.lines], ["reverse: changed: a — fix: restore a"]);
  });
});
