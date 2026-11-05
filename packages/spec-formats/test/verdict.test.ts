/**
 * T033 — the own tests of the staleness verdict (F104-FR-023, F104-FR-024,
 * F104-FR-025, F104-FR-027; CQ-214).
 *
 * What this file measures, in the words of the task:
 *
 *  1. the verdict FOR EACH OF THE THREE FILES — spec, plan and tasks: each one
 *     changed on its own gives a stale verdict that names that file and only
 *     that file, by its logical name AND its repository-relative path;
 *  2. a task list with TICKS ONLY is fresh — and that holds for a tick, for a
 *     clear, and for the two together, in every one of the three formats whose
 *     task list carries task ids;
 *  3. a CHANGED TASK TEXT is stale and NAMED.
 *
 * Every verdict here is taken over FILES ON DISK, written and then edited, so
 * the read half of F104-FR-024 is exercised and not stubbed. The states
 * themselves come from the one classification in
 * `packages/kernel/src/hasher/staleness.ts`, which this package calls and never
 * reimplements (CQ-214); `test/static/one-grammar.test.ts` of T023 and the
 * assertions at the end of this file hold that split in place.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STALENESS_DEPENDS_ON_WHEN_IT_IS_ASKED,
  STALENESS_READS_A_FILE,
  classifySources,
} from "@specstride/kernel/hasher";
import {
  CLASSIFICATION_OWNER,
  EP_03_GAINS_AN_OPERATION_FOR_THE_VERDICT,
  VERDICT_LINES,
} from "../src/model.ts";
import {
  DECLARED_SOURCES,
  HASHES_OF_ITS_OWN,
  NATIVE_SOURCE_NAME,
  OPENSPEC_SOURCES,
  ORDER_OF_THE_RUN_VERDICT,
  SPECKIT_SOURCES,
  inputs,
  recordOfName,
  repositoryPath,
} from "../src/sources.ts";
import {
  CLASSIFIER,
  COMPARES_AT_A_CHECK_POINT,
  EXIT_OF_A_STALE_CONTRACT,
  READS_A_CLOCK,
  REWRITES_THE_STATUS_TO_DRAFT,
  STALE_CONTRACT_HEADER,
  VERDICT_IS_THE_SOLE_INPUT,
  hashesNowOf,
  staleContractReport,
  verdictOfALaunchContract,
  verdictOfARun,
} from "../src/verdict.ts";
import { tickFile } from "../src/tick.ts";

/* ------------------------------------------------------------------ *
 * A throw-away workspace of the three files.
 * ------------------------------------------------------------------ */

const SPEC = ["# Feature", "", "A feature that exists.", ""].join("\n");
const PLAN = ["# Plan", "", "The approach.", ""].join("\n");
const TASKS = [
  "# Tasks",
  "",
  "## Phase 1: Setup",
  "",
  "- [ ] T001 [P] write the thing",
  "- [ ] T002 write the other thing",
  "",
  "## Phase 2: Next",
  "",
  "- [ ] T010 the next phase",
  "",
].join("\n");

type Workspace = {
  readonly root: string;
  readonly at: (path: string) => string;
  readonly write: (path: string, content: string) => void;
  readonly read: (path: string) => string;
  readonly remove: () => void;
};

function workspace(tree: Readonly<Record<string, string>>): Workspace {
  const root = mkdtempSync(join(tmpdir(), "ss104-verdict-"));
  const at = (path: string) => join(root, ...path.split("/"));
  const write = (path: string, content: string) => {
    mkdirSync(join(at(path), ".."), { recursive: true });
    writeFileSync(at(path), content);
  };
  for (const [path, content] of Object.entries(tree)) write(path, content);
  return {
    root,
    at,
    write,
    read: (path: string) => readFileSync(at(path), "utf8"),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** The Spec Kit feature directory the three files live in. */
const FEATURE = "specs/104-spec-input";
const SPEC_PATH = `${FEATURE}/spec.md`;
const PLAN_PATH = `${FEATURE}/plan.md`;
const TASKS_PATH = `${FEATURE}/tasks.md`;
const THREE_FILES: Readonly<Record<string, string>> = Object.freeze({
  [SPEC_PATH]: SPEC,
  [PLAN_PATH]: PLAN,
  [TASKS_PATH]: TASKS,
});

/** `inputs` over such a workspace, as the run snapshot records it. */
function recorded(ws: Workspace) {
  return inputs({ root: ws.root, format: "speckit-tasks", specPath: ws.at(TASKS_PATH) });
}

/* ------------------------------------------------------------------ *
 * `inputs` — the record the verdict compares against (F104-FR-023).
 * ------------------------------------------------------------------ */

test("T035: `inputs` lists the three files of a Spec Kit feature, in the order of the verdict, with the hashes of the kernel", () => {
  const ws = workspace(THREE_FILES);
  try {
    const sources = recorded(ws);
    assert.deepEqual(
      sources.map((s) => s.name),
      [...ORDER_OF_THE_RUN_VERDICT],
      "the order is spec, plan, tasks (F104-FR-024)",
    );
    assert.deepEqual(
      sources.map((s) => s.path),
      [SPEC_PATH, PLAN_PATH, TASKS_PATH],
      "every path is repository-relative, with `/` as the separator (F104-FR-023)",
    );
    assert.deepEqual(
      sources.map((s) => s.kind),
      ["spec", "plan", "tasks"],
    );
    // Every source carries a content hash; ONLY the task list carries the hash
    // that ignores checkboxes (F104-FR-023).
    for (const source of sources) {
      assert.match(source.contentHash, /^[0-9a-f]{64}$/, `${source.name}: a SHA-256 hash`);
    }
    assert.equal(recordOfName(sources, "spec")?.checkboxInsensitiveHash, undefined);
    assert.equal(recordOfName(sources, "plan")?.checkboxInsensitiveHash, undefined);
    assert.match(
      recordOfName(sources, "tasks")?.checkboxInsensitiveHash ?? "",
      /^[0-9a-f]{64}$/,
      "the task list carries both hashes",
    );
    // The hashes are the KERNEL's: this package computes none of its own.
    assert.equal(HASHES_OF_ITS_OWN, 0);
    // A file that does not exist is simply not listed (F104-FR-023, "those that
    // exist"), and only a LISTED source can be stale.
    const onlyTasks = workspace({ [TASKS_PATH]: TASKS });
    try {
      assert.deepEqual(
        inputs({
          root: onlyTasks.root,
          format: "speckit-tasks",
          specPath: onlyTasks.at(TASKS_PATH),
        }).map((s) => s.name),
        ["tasks"],
      );
    } finally {
      onlyTasks.remove();
    }
  } finally {
    ws.remove();
  }
});

test("T035: the sources of `openspec-change` and of `native` are those of CQ-043", () => {
  // `openspec-change`: `proposal.md` is the `spec`, `design.md` is the `plan`,
  // `tasks.md` is the task list.
  assert.deepEqual(
    OPENSPEC_SOURCES.map((s) => [s.name, s.file]),
    [
      ["spec", "proposal.md"],
      ["plan", "design.md"],
      ["tasks", "tasks.md"],
    ],
  );
  assert.deepEqual(
    SPECKIT_SOURCES.map((s) => [s.name, s.file]),
    [
      ["spec", "spec.md"],
      ["plan", "plan.md"],
      ["tasks", "tasks.md"],
    ],
  );
  // `native`: the ONE file, as `spec`; it has no task list and is never ticked.
  assert.deepEqual([...DECLARED_SOURCES.native], []);
  const ws = workspace({ "SPECS.md": ["## Phase 1: Only", "", "- [ ] T001 do it", ""].join("\n") });
  try {
    const sources = inputs({ root: ws.root, format: "native", specPath: ws.at("SPECS.md") });
    assert.equal(sources.length, 1, "the one file");
    assert.equal(sources[0]?.name, NATIVE_SOURCE_NAME);
    assert.equal(sources[0]?.kind, "spec");
    assert.equal(sources[0]?.path, "SPECS.md");
    assert.equal(
      sources[0]?.checkboxInsensitiveHash,
      undefined,
      "a native spec is hashed as `spec` and carries no hash that ignores checkboxes",
    );
  } finally {
    ws.remove();
  }
});

/* ------------------------------------------------------------------ *
 * The verdict for EACH of the three files (F104-FR-024).
 * ------------------------------------------------------------------ */

test("T036: nothing changed — every source is `unchanged` and the verdict is fresh", () => {
  const ws = workspace(THREE_FILES);
  try {
    const report = verdictOfARun(ws.root, recorded(ws));
    assert.equal(report.verdict.result, "fresh");
    assert.deepEqual(
      report.verdict.sources.map((s) => [s.name, s.state]),
      [
        ["spec", "unchanged"],
        ["plan", "unchanged"],
        ["tasks", "unchanged"],
      ],
    );
    assert.deepEqual([...report.verdict.changed], []);
    assert.deepEqual([...report.lines], [], "a fresh verdict prints no line");
    assert.equal(
      report.verdict.sources.find((s) => s.name === "tasks")?.moreThanTicks,
      false,
      "the task list reports `moreThanTicks` even when nothing changed",
    );
  } finally {
    ws.remove();
  }
});

for (const subject of [
  { name: "spec", path: SPEC_PATH, edit: `${SPEC}\nA sentence the author added.\n` },
  { name: "plan", path: PLAN_PATH, edit: `${PLAN}\nA step the author added.\n` },
  {
    name: "tasks",
    path: TASKS_PATH,
    edit: TASKS.replace("write the thing", "write a DIFFERENT thing"),
  },
] as const) {
  test(`T036: the verdict of a run when \`${subject.name}\` changed: stale, and it names ${subject.name} alone, by name and by repository-relative path`, () => {
    const ws = workspace(THREE_FILES);
    try {
      const sources = recorded(ws);
      ws.write(subject.path, subject.edit);
      const report = verdictOfARun(ws.root, sources);

      assert.equal(report.verdict.result, "stale");
      // ONLY this file is named — `changed[]` holds exactly one name.
      assert.deepEqual([...report.verdict.changed], [subject.name]);
      // Its logical NAME and its repository-relative PATH are both reported.
      const named = report.verdict.sources.find((s) => s.name === subject.name);
      assert.equal(named?.state, "changed");
      assert.equal(named?.path, subject.path);
      // The other two are untouched and `unchanged`.
      for (const other of ORDER_OF_THE_RUN_VERDICT.filter((n) => n !== subject.name)) {
        assert.equal(
          report.verdict.sources.find((s) => s.name === other)?.state,
          "unchanged",
          `${other} is unchanged`,
        );
      }
      // The line of F104-FR-025, by INDEX and path, and no other line.
      const index = sources.findIndex((s) => s.name === subject.name);
      assert.deepEqual([...report.lines], [VERDICT_LINES.changed(index, subject.path)]);
      assert.match(report.lines[0] ?? "", /^sources\[\d+\] hash changed: /);
    } finally {
      ws.remove();
    }
  });
}

test("T036: a CHANGED TASK TEXT is stale, is named `tasks`, and says the change is more than checkboxes", () => {
  const ws = workspace(THREE_FILES);
  try {
    const sources = recorded(ws);
    ws.write(TASKS_PATH, TASKS.replace("T002 write the other thing", "T002 write something else"));
    const report = verdictOfARun(ws.root, sources);

    assert.equal(report.verdict.result, "stale");
    assert.deepEqual([...report.verdict.changed], ["tasks"]);
    const tasks = report.verdict.sources.find((s) => s.name === "tasks");
    assert.equal(tasks?.state, "changed");
    assert.equal(tasks?.path, TASKS_PATH);
    assert.equal(tasks?.moreThanTicks, true, "the change is more than checkboxes");
  } finally {
    ws.remove();
  }
});

/* ------------------------------------------------------------------ *
 * TICKS ONLY is fresh (F104-FR-024).
 * ------------------------------------------------------------------ */

const TICK_CASES = [
  { what: "one box ticked", edit: (t: string) => t.replace("- [ ] T001", "- [x] T001") },
  {
    what: "every box ticked",
    edit: (t: string) => t.split("- [ ] ").join("- [x] "),
  },
  {
    what: "a box CLEARED again",
    edit: (t: string) => t.replace("- [ ] T002", "- [x] T002").replace("- [x] T002", "- [ ] T002"),
  },
  {
    what: "one ticked and another cleared",
    edit: (t: string) => t.replace("- [ ] T001", "- [x] T001").replace("- [x] T010", "- [ ] T010"),
  },
  {
    what: "an upper-case mark `[X]`",
    edit: (t: string) => t.replace("- [ ] T001", "- [X] T001"),
  },
] as const;

for (const kase of TICK_CASES) {
  test(`T036: a task list with TICKS ONLY (${kase.what}) is fresh and is reported \`ticks-only\``, () => {
    const ws = workspace(THREE_FILES);
    try {
      const sources = recorded(ws);
      const after = kase.edit(TASKS);
      ws.write(TASKS_PATH, after);
      const report = verdictOfARun(ws.root, sources);
      const tasks = report.verdict.sources.find((s) => s.name === "tasks");
      if (after === TASKS) {
        // The round trip of "ticked then cleared" leaves the file as it was.
        assert.equal(tasks?.state, "unchanged");
      } else {
        assert.equal(tasks?.state, "ticks-only", "the content hash differs, the other does not");
      }
      assert.equal(report.verdict.result, "fresh", "a tick never makes a run stale");
      assert.deepEqual([...report.verdict.changed], []);
      assert.deepEqual([...report.lines], []);
      assert.equal(tasks?.moreThanTicks, false);
    } finally {
      ws.remove();
    }
  });
}

test("T036: the tick of THIS feature — `tickFile` — never makes a run stale", () => {
  const ws = workspace(THREE_FILES);
  try {
    const sources = recorded(ws);
    // The tick the proposer and the engine use, over the real file.
    const result = tickFile({
      path: ws.at(TASKS_PATH),
      format: "speckit-tasks",
      request: { phase: 1 },
      file: TASKS_PATH,
    });
    assert.equal(result.changed, 2, "two boxes of phase 1 were written");
    assert.notEqual(ws.read(TASKS_PATH), TASKS, "the file on disk really changed");

    const report = verdictOfARun(ws.root, sources);
    assert.equal(report.verdict.result, "fresh");
    assert.equal(report.verdict.sources.find((s) => s.name === "tasks")?.state, "ticks-only");
  } finally {
    ws.remove();
  }
});

test("T036: a tick AND a text edit together is `changed`, not `ticks-only`", () => {
  const ws = workspace(THREE_FILES);
  try {
    const sources = recorded(ws);
    ws.write(
      TASKS_PATH,
      TASKS.replace("- [ ] T001 [P] write the thing", "- [x] T001 [P] write the OTHER thing"),
    );
    const report = verdictOfARun(ws.root, sources);
    assert.equal(report.verdict.result, "stale");
    assert.equal(report.verdict.sources.find((s) => s.name === "tasks")?.state, "changed");
    assert.equal(report.verdict.sources.find((s) => s.name === "tasks")?.moreThanTicks, true);
  } finally {
    ws.remove();
  }
});

/* ------------------------------------------------------------------ *
 * A source that cannot be read (F104-FR-025).
 * ------------------------------------------------------------------ */

test("T036: a recorded source that cannot be read NOW is `unreadable`, stale, and named with the error", () => {
  const ws = workspace(THREE_FILES);
  try {
    const sources = recorded(ws);
    rmSync(ws.at(PLAN_PATH));
    const report = verdictOfARun(ws.root, sources);

    assert.equal(report.verdict.result, "stale");
    assert.deepEqual([...report.verdict.changed], ["plan"]);
    assert.equal(report.verdict.sources.find((s) => s.name === "plan")?.state, "unreadable");
    const index = sources.findIndex((s) => s.name === "plan");
    assert.equal(report.lines.length, 1);
    assert.match(
      report.lines[0] ?? "",
      new RegExp(`^sources\\[${index}\\] cannot be read: ${PLAN_PATH}: `),
    );
    // The error is the operating system's, carried through as it came.
    const compared = report.compared.find((s) => s.name === "plan");
    assert.match(compared?.error ?? "", /ENOENT/);
    assert.equal(
      report.lines[0],
      VERDICT_LINES.unreadable(index, PLAN_PATH, compared?.error ?? ""),
    );
  } finally {
    ws.remove();
  }
});

test("T036: a changed plan and a ticked task list name the PLAN only (scenario 3 of the spec)", () => {
  const ws = workspace(THREE_FILES);
  try {
    const sources = recorded(ws);
    ws.write(PLAN_PATH, `${PLAN}\nAnother step.\n`);
    ws.write(TASKS_PATH, TASKS.split("- [ ] ").join("- [x] "));
    const report = verdictOfARun(ws.root, sources);
    assert.equal(report.verdict.result, "stale");
    assert.deepEqual([...report.verdict.changed], ["plan"], "the plan ALONE is named");
    assert.equal(report.verdict.sources.find((s) => s.name === "tasks")?.state, "ticks-only");
  } finally {
    ws.remove();
  }
});

/* ------------------------------------------------------------------ *
 * The name rule of a RUN, and its absence for a launch contract (I1).
 * ------------------------------------------------------------------ */

test("T036: in the verdict of a RUN a name outside `spec`, `plan` and `tasks` gives a stale verdict", () => {
  const ws = workspace({ ...THREE_FILES, [`${FEATURE}/research.md`]: "# Research\n" });
  try {
    const sources = [
      ...recorded(ws),
      // A recorded source whose name is outside closed set 50. Its file is
      // untouched, so only the NAME RULE can make the verdict stale.
      Object.freeze({
        kind: "other" as const,
        name: "research",
        path: `${FEATURE}/research.md`,
        contentHash: hashesNowOf(ws.root, {
          kind: "other",
          name: "research",
          path: `${FEATURE}/research.md`,
          contentHash: "",
        }).contentHash as string,
      }),
    ];
    const run = verdictOfARun(ws.root, sources);
    assert.equal(run.verdict.result, "stale", "the name rule of closed set 50 refused `research`");
    assert.ok(run.verdict.changed.includes("research"));
    assert.equal(run.verdict.sources.find((s) => s.name === "research")?.state, "changed");
    assert.equal(run.compared.find((s) => s.name === "research")?.nameOutsideTheRunVerdict, true);
    // The same recorded sources over a LAUNCH CONTRACT: the name rule does not
    // apply, every source is compared by index, and the verdict is fresh.
    const contract = verdictOfALaunchContract(ws.root, sources);
    assert.equal(contract.verdict.result, "fresh");
    assert.equal(contract.verdict.sources.find((s) => s.name === "research")?.state, "unchanged");
    assert.deepEqual([...contract.lines], []);
  } finally {
    ws.remove();
  }
});

test("T036: the verdict over the sources of a launch contract compares EVERY source, by index, of any kind", () => {
  const ws = workspace({
    ...THREE_FILES,
    [`${FEATURE}/research.md`]: "# Research\n",
    ".specify/memory/constitution.md": "# Constitution\n",
  });
  try {
    const three = recorded(ws);
    const hashOf = (path: string) =>
      hashesNowOf(ws.root, { kind: "other", name: path, path, contentHash: "" })
        .contentHash as string;
    const contractSources = [
      ...three,
      Object.freeze({
        kind: "other" as const,
        name: "research",
        path: `${FEATURE}/research.md`,
        contentHash: hashOf(`${FEATURE}/research.md`),
      }),
      Object.freeze({
        kind: "other" as const,
        name: "constitution",
        path: ".specify/memory/constitution.md",
        contentHash: hashOf(".specify/memory/constitution.md"),
      }),
    ];
    // Edit the LAST source, which no verdict of a run would ever look at.
    ws.write(".specify/memory/constitution.md", "# Constitution\n\nAn amendment.\n");
    const report = verdictOfALaunchContract(ws.root, contractSources);

    assert.equal(report.compared.length, 5, "every source of the contract was compared");
    assert.deepEqual(
      report.compared.map((s) => s.index),
      [0, 1, 2, 3, 4],
      "each is identified by its index, in the recorded order",
    );
    assert.equal(report.verdict.result, "stale");
    assert.deepEqual(
      [...report.lines],
      [VERDICT_LINES.changed(4, ".specify/memory/constitution.md")],
    );

    // F104-FR-025 — the caller prints `stale contract sources:` with the list,
    // exits 23, and does NOT rewrite the status of the launch contract to draft.
    const stale = staleContractReport(report);
    assert.ok(stale !== undefined);
    assert.equal(stale.stderr[0], STALE_CONTRACT_HEADER);
    assert.deepEqual([...stale.stderr.slice(1)], [...report.lines]);
    assert.equal(stale.exit, EXIT_OF_A_STALE_CONTRACT);
    assert.equal(stale.exit, 23);
    assert.equal(stale.rewritesTheStatusToDraft, false);
    assert.equal(REWRITES_THE_STATUS_TO_DRAFT, false);
    assert.equal(VERDICT_IS_THE_SOLE_INPUT, true);

    // A fresh contract has no such report at all.
    ws.write(".specify/memory/constitution.md", "# Constitution\n");
    assert.equal(
      staleContractReport(verdictOfALaunchContract(ws.root, contractSources)),
      undefined,
    );
  } finally {
    ws.remove();
  }
});

test("T036: a launch contract may record the SAME file twice; each is compared by its own index", () => {
  const ws = workspace(THREE_FILES);
  try {
    const three = recorded(ws);
    const tasks = recordOfName(three, "tasks");
    assert.ok(tasks !== undefined);
    // Two records of one path, the second with a hash that is out of date.
    // The second record is out of date in BOTH hashes, so its state is
    // `changed` and not `ticks-only`.
    const sources = [
      tasks,
      Object.freeze({
        ...tasks,
        contentHash: "0".repeat(64),
        checkboxInsensitiveHash: "1".repeat(64),
      }),
    ];
    const report = verdictOfALaunchContract(ws.root, sources);
    assert.deepEqual(
      report.compared.map((s) => [s.index, s.state]),
      [
        [0, "unchanged"],
        [1, "changed"],
      ],
    );
    assert.deepEqual([...report.lines], [VERDICT_LINES.changed(1, TASKS_PATH)]);
  } finally {
    ws.remove();
  }
});

/* ------------------------------------------------------------------ *
 * The split of CQ-214, measured on the modules.
 * ------------------------------------------------------------------ */

test("T036: the classification is the KERNEL's; this package reads the files and builds the lines (CQ-214)", () => {
  // The owner, stated in both places and in one word.
  assert.equal(CLASSIFICATION_OWNER, "@specstride/kernel");
  assert.equal(CLASSIFIER, "@specstride/kernel/hasher");
  assert.equal(EP_03_GAINS_AN_OPERATION_FOR_THE_VERDICT, false);

  // The classification reads no file and asks no clock (F104-FR-027).
  assert.equal(STALENESS_READS_A_FILE, false);
  assert.equal(STALENESS_DEPENDS_ON_WHEN_IT_IS_ASKED, false);
  assert.equal(COMPARES_AT_A_CHECK_POINT, false);
  assert.equal(READS_A_CLOCK, false);

  // The staleness module imports `@specstride/contracts` ALONE: no file system,
  // no crypto, no path. Measured on the file, not claimed.
  const staleness = readFileSync(
    new URL("../../kernel/src/hasher/staleness.ts", import.meta.url),
    "utf8",
  );
  const imported = [...staleness.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(imported)].sort(),
    [
      "@specstride/contracts/enums",
      "@specstride/contracts/enums/all-sets",
      "@specstride/contracts/ep/hasher",
    ],
    "the import list of the classification",
  );
  // The CODE of the module, with every comment stripped, so that the prose of
  // the doc comment (which names `node:fs` to say it is absent) cannot make this
  // check pass or fail by accident.
  const code = staleness.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const forbidden of [
    "node:fs",
    "node:crypto",
    "node:path",
    "readFileSync",
    "createHash",
    "Date.now",
  ]) {
    assert.ok(!code.includes(forbidden), `the code of the classification holds no ${forbidden}`);
  }
  // The stripping is falsifiable: the prose DOES name `node:fs`, and the code
  // does not — so the two halves of this check cannot both be vacuous.
  assert.ok(staleness.includes("node:fs"), "the doc comment names `node:fs` to say it is absent");

  // `verdict.ts` makes no comparison of hashes itself: the states come from
  // `classifySources`, and the same recorded hashes give the same states
  // whichever route a caller takes.
  const ws = workspace(THREE_FILES);
  try {
    const sources = recorded(ws);
    ws.write(TASKS_PATH, TASKS.replace("- [ ] T001", "- [x] T001"));
    const report = verdictOfARun(ws.root, sources);
    const direct = classifySources(
      sources.map((source) => {
        const now = hashesNowOf(ws.root, source);
        return {
          logicalName: source.name,
          repositoryPath: source.path,
          recordedHash: source.contentHash,
          recordedHashIgnoringCheckboxes: source.checkboxInsensitiveHash,
          hashNow: now.contentHash,
          hashNowIgnoringCheckboxes: now.checkboxInsensitiveHash,
        };
      }),
      { nameRule: "run" },
    );
    assert.deepEqual(
      report.compared.map((s) => [s.index, s.name, s.state]),
      direct.map((s) => [s.index, s.name, s.state]),
      "the verdict's states ARE the classification's",
    );
  } finally {
    ws.remove();
  }
});

test("T036: the verdict does not depend on when it is asked (F104-FR-027)", () => {
  const ws = workspace(THREE_FILES);
  try {
    const sources = recorded(ws);
    ws.write(PLAN_PATH, `${PLAN}\nA change.\n`);
    const first = verdictOfARun(ws.root, sources);
    const again = verdictOfARun(ws.root, sources);
    assert.deepEqual(again, first, "two verdicts over the same files are the same value");
    // The repository-relative path is stable whichever way the caller spells it.
    assert.equal(repositoryPath(ws.root, ws.at(PLAN_PATH)), PLAN_PATH);
    assert.equal(repositoryPath(ws.root, PLAN_PATH), PLAN_PATH);
  } finally {
    ws.remove();
  }
});
