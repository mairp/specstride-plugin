/**
 * The own test of T029, the context documents and the budget (F104-FR-016).
 *
 * The parity tests of the context ORDER and the context BUDGET against the
 * fixtures of FX-10 are T046 of phase 8 (`PT-104-C-145-context-order`,
 * `PT-104-C-145-context-budget`, `PT-104-C-144-context-markers`,
 * `PT-104-C-140-context-budget-key`). This test measures the module itself,
 * over real trees in a temporary directory, so that T029's rules are
 * observable now and T046 has something to compare.
 *
 * The rows of R18 behind each rule are named in `context.ts`; here they are
 * measured: B-2058 (native renders nothing), B-2047, B-2048 (the Spec Kit
 * order), B-2046 (the OpenSpec order), B-2049, B-2050, B-2052 (the budget),
 * B-2051, B-2011 (the cut and its marker) and B-2012 (the block heading).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  BLOCK_SEPARATOR,
  BUDGET_KEY,
  BUDGET_VARIABLE,
  DEFAULT_BUDGET,
  FLOOR,
  KEY_OF_THE_BUDGET_VARIABLE,
  TRUNCATION_MARKER,
  allocate,
  blockHeading,
  budgetIsTakenAsGiven,
  contextDocumentsOf,
  contextLinesOf,
  deltaNameOf,
  hasAnUnbalancedCodeFence,
  loadContextDocuments,
  readBudget,
  renderContext,
  servedCharactersOf,
  specifyProjectRootOf,
  truncate,
} from "../src/context.ts";

/** A throw-away tree, removed whatever happens. */
function withTree<T>(tree: Readonly<Record<string, string>>, body: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "ss104-ctx-"));
  try {
    for (const [path, content] of Object.entries(tree)) {
      const file = join(root, ...path.split("/"));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A Spec Kit project with every document of B-2048, and two of each stem kind. */
const SPECKIT_TREE = Object.freeze({
  ".specify/memory/constitution.md": "# The constitution\n",
  "specs/104/tasks.md": "## Phase 1: Setup\n\n- [ ] T001 a\n",
  "specs/104/spec.md": "# Spec\n",
  "specs/104/plan.md": "# Plan\n",
  "specs/104/data-model.md": "# Data model\n",
  "specs/104/research.md": "# Research\n",
  "specs/104/quickstart.md": "# Quickstart\n",
  "specs/104/contracts/verdict.md": "# Verdict\n",
  "specs/104/contracts/README.md": "# Contracts\n",
  "specs/104/checklists/requirements.md": "# Requirements\n",
  "specs/104/checklists/alpha.md": "# Alpha\n",
  // Not a context document of any format: it must not appear.
  "specs/104/notes.md": "# Notes\n",
});

test("T029: B-2058 — the native format renders no context", () => {
  withTree(SPECKIT_TREE, (root) => {
    assert.deepEqual(
      contextDocumentsOf({ root, specPath: "specs/104/tasks.md", format: "native" }),
      [],
    );
    assert.deepEqual(
      renderContext(
        loadContextDocuments({ root, specPath: "specs/104/tasks.md", format: "native" }),
      ),
      "",
    );
  });
});

test("T029: B-2047, B-2048 — the Spec Kit order, each document only when it exists", () => {
  withTree(SPECKIT_TREE, (root) => {
    const documents = contextDocumentsOf({
      root,
      specPath: "specs/104/tasks.md",
      format: "speckit-tasks",
    });
    assert.deepEqual(
      documents.map((document) => document.name),
      [
        "constitution",
        "spec",
        "plan",
        // `contract:<stem>` sorted by file name: `README.md` before `verdict.md`
        "contract:README",
        "contract:verdict",
        "data-model",
        "research",
        "quickstart",
        // `checklist:<stem>` sorted: `alpha.md` before `requirements.md`
        "checklist:alpha",
        "checklist:requirements",
      ],
    );
    // The paths are repository-relative, as `data-model.md` requires.
    assert.deepEqual(documents[1], { name: "spec", path: "specs/104/spec.md" });
    assert.equal(documents[0]?.path, ".specify/memory/constitution.md");
    // `notes.md` is in the feature directory and is NO context document.
    assert.equal(
      documents.some((document) => document.path.endsWith("notes.md")),
      false,
    );
    // `spec context` prints `name<TAB>path` per document.
    assert.equal(contextLinesOf(documents)[1], "spec\tspecs/104/spec.md");

    // B-2043, B-2047 — the project root is found by walking UPWARD, and the
    // constitution is context ONLY inside a `.specify` project.
    assert.equal(specifyProjectRootOf(join(root, "specs/104/tasks.md")), root);
  });

  // The same feature directory with NO `.specify` anywhere above it: the
  // constitution drops out and nothing else changes.
  const withoutTheProject = Object.fromEntries(
    Object.entries(SPECKIT_TREE).filter(([path]) => !path.startsWith(".specify/")),
  );
  withTree(withoutTheProject, (root) => {
    const names = contextDocumentsOf({
      root,
      specPath: "specs/104/tasks.md",
      format: "speckit-tasks",
    }).map((document) => document.name);
    assert.equal(names.includes("constitution"), false);
    assert.equal(names[0], "spec");
  });

  // A feature directory with only a `tasks.md`: every other document is absent
  // and the listing is empty, not a list of missing files.
  withTree({ "specs/x/tasks.md": "## Phase 1: A\n\n- [ ] T001 a\n" }, (root) => {
    assert.deepEqual(
      contextDocumentsOf({ root, specPath: "specs/x/tasks.md", format: "speckit-tasks" }),
      [],
    );
  });
});

test("T029: B-2046 — the OpenSpec order, with `current-spec` only where it matches", () => {
  const tree = Object.freeze({
    "openspec/changes/add-thing/tasks.md": "## 1. Setup\n\n- [ ] 1.1 a\n",
    "openspec/changes/add-thing/proposal.md": "# Proposal\n",
    "openspec/changes/add-thing/design.md": "# Design\n",
    "openspec/changes/add-thing/specs/greeting/spec.md": "# Greeting delta\n",
    "openspec/changes/add-thing/specs/zeta/spec.md": "# Zeta delta\n",
    // The current spec of `greeting` exists; the one of `zeta` does not.
    "openspec/specs/greeting/spec.md": "# Greeting, current\n",
  });
  withTree(tree, (root) => {
    const documents = contextDocumentsOf({
      root,
      specPath: "openspec/changes/add-thing/tasks.md",
      format: "openspec-change",
    });
    assert.deepEqual(
      documents.map((document) => document.name),
      [
        "proposal",
        // the deltas, recursive and sorted
        "delta-spec:greeting",
        "delta-spec:zeta",
        "design",
        // one `current-spec` per delta that HAS a matching file
        "current-spec:greeting",
      ],
    );
    assert.equal(
      documents.find((document) => document.name === "current-spec:greeting")?.path,
      "openspec/specs/greeting/spec.md",
    );
    // The reading of `<name>` is in one place and is measured there.
    assert.equal(deltaNameOf("/c/specs", "/c/specs/greeting/spec.md"), "greeting");
    assert.equal(deltaNameOf("/c/specs", "/c/specs/a/b/spec.md"), "a/b");
    assert.equal(deltaNameOf("/c/specs", "/c/specs/loose.md"), "loose");
  });
});

test("T029: the budget — its key, its alias, its default and a value that is no whole number", () => {
  // The key, and the pairing of the as-is variable, READ from the alias table.
  assert.equal(BUDGET_KEY, "spec.contextBudget");
  assert.equal(BUDGET_VARIABLE, "SPECSTRIDE_CONTEXT_BUDGET");
  assert.equal(KEY_OF_THE_BUDGET_VARIABLE, BUDGET_KEY);
  // B-2049, B-2050 — the default and the floor.
  assert.equal(DEFAULT_BUDGET, 24_000);
  assert.equal(FLOOR, 1_200);
  // A whole number is taken as given; anything else falls back to the default.
  assert.equal(readBudget(5_000), 5_000);
  assert.equal(readBudget("5000"), 5_000);
  assert.equal(readBudget(0), 0);
  for (const value of [undefined, null, "", "   ", "lots", "1.5", 1.5, -1, Number.NaN, {}]) {
    assert.equal(readBudget(value), DEFAULT_BUDGET, JSON.stringify(value) ?? String(value));
    assert.equal(budgetIsTakenAsGiven(value), false, JSON.stringify(value) ?? String(value));
  }
  assert.equal(budgetIsTakenAsGiven(5_000), true);
  // A value equal to the default is still "taken as given", which is what
  // separates the two functions.
  assert.equal(budgetIsTakenAsGiven(DEFAULT_BUDGET), true);
  assert.equal(readBudget(DEFAULT_BUDGET), DEFAULT_BUDGET);
});

test("T029: B-2052, B-2050 — the allocation, the floor, and the leftover cascading forward", () => {
  const document = (name: string, size: number) => ({
    name,
    path: `${name}.md`,
    content: "x".repeat(size),
  });

  // Everything fits: each document gets its whole size and nothing is cut.
  const small = [document("a", 100), document("b", 200)];
  assert.deepEqual(
    allocate(small, 24_000).map((allocation) => [allocation.served, allocation.truncated]),
    [
      [100, false],
      [200, false],
    ],
  );
  assert.equal(servedCharactersOf(allocate(small, 24_000)), 300);

  // The leftover cascades FORWARD: a small first document leaves more for the
  // second, which then takes more than its own fair share would have been.
  const cascade = [document("a", 50), document("b", 10_000)];
  const cascaded = allocate(cascade, 4_000);
  assert.equal(cascaded[0]?.served, 50);
  assert.equal(cascaded[1]?.served, 3_950);
  assert.equal(cascaded[1]?.truncated, true);
  assert.equal(servedCharactersOf(cascaded), 4_000);

  // Each document gets at most a FAIR SHARE: three large documents under
  // 6,000 characters get 2,000 each, not the first one everything.
  const fair = allocate([document("a", 9_000), document("b", 9_000), document("c", 9_000)], 6_000);
  assert.deepEqual(
    fair.map((allocation) => allocation.served),
    [2_000, 2_000, 2_000],
  );

  // B-2050 — a document that would get less than the floor is DROPPED, unless
  // it fits whole. With 2,500 characters and three large documents the fair
  // share is below the floor, so the floor is used: the first two take 1,200
  // each and the third, left with 100, is dropped.
  const tight = allocate([document("a", 9_000), document("b", 9_000), document("c", 9_000)], 2_500);
  assert.deepEqual(
    tight.map((allocation) => [allocation.served, allocation.dropped]),
    [
      [FLOOR, false],
      [FLOOR, false],
      [0, true],
    ],
  );
  // The two halves of B-2050's "unless it fits whole", over the SAME budget
  // and the same first document, so that only the second document's size
  // decides. With 1,300 characters the first takes the floor and 100 are left:
  //   - a 200-character document would get 100 of its 200: it is DROPPED;
  //   - a 30-character document fits WHOLE in the 100: it is SERVED.
  const dropped = allocate([document("a", 9_000), document("b", 200)], 1_300);
  assert.deepEqual(
    dropped.map((allocation) => [allocation.served, allocation.dropped]),
    [
      [FLOOR, false],
      [0, true],
    ],
    "B-2050: a document that would get less than the floor and not fit whole is dropped",
  );
  const stillFits = allocate([document("a", 9_000), document("b", 30)], 1_300);
  assert.deepEqual(
    stillFits.map((allocation) => [allocation.served, allocation.dropped]),
    [
      [FLOOR, false],
      [30, false],
    ],
    "B-2050: a document that fits whole is served even below the floor",
  );

  // The guarantee of reading 1 of `context.ts`: the CONTENT served never
  // exceeds the budget, for any of the allocations above.
  for (const [allocations, budget] of [
    [cascaded, 4_000],
    [fair, 6_000],
    [tight, 2_500],
    [dropped, 1_300],
    [stillFits, 1_300],
  ] as const) {
    assert.ok(servedCharactersOf(allocations) <= budget);
  }
});

test("T029: B-2051, B-2011 — the cut falls on a line end, closes a fence, and carries the marker", () => {
  const lines = ["alpha", "beta", "gamma", "delta"].join("\n");
  // A cut inside `gamma` falls back to the end of `beta`.
  const cut = truncate(lines, 14);
  assert.equal(cut, `alpha\nbeta\n${TRUNCATION_MARKER}`);
  assert.ok(cut.endsWith(TRUNCATION_MARKER));
  // Nothing is cut when the whole text fits, and no marker is added.
  assert.equal(truncate(lines, lines.length), lines);
  assert.equal(truncate(lines, 1_000), lines);
  // A single OVER-LONG line has no line end to cut at: it is cut hard.
  const long = "x".repeat(50);
  assert.equal(truncate(long, 10), `${"x".repeat(10)}\n${TRUNCATION_MARKER}`);
  // An unbalanced code fence is CLOSED.
  const fenced = ["# A doc", "", "```ts", "const a = 1;", "const b = 2;", "```", ""].join("\n");
  assert.equal(hasAnUnbalancedCodeFence("```ts\ncode"), true);
  assert.equal(hasAnUnbalancedCodeFence("```ts\ncode\n```"), false);
  // The cut at 25 characters falls inside `const a = 1;`, so the body ends at
  // the line end after the opening fence — which leaves the fence open, and it
  // is closed before the marker.
  const cutFence = truncate(fenced, 25);
  assert.equal(
    cutFence,
    `# A doc\n\n\`\`\`ts\n\`\`\`\n${TRUNCATION_MARKER}`,
    "the fence the cut left open is closed before the marker",
  );
  assert.equal(hasAnUnbalancedCodeFence(cutFence), false);
  // A cut that falls AFTER the closing fence leaves it balanced and adds none.
  const wholeFence = truncate(`${fenced}more\nlines\n`, fenced.length + 2);
  assert.equal(wholeFence.split("```").length - 1, 2, "no fence was added");
});

test("T029: B-2012 — the block heading, the blank line between blocks, and no added newline", () => {
  assert.equal(
    blockHeading("spec", "specs/104/spec.md"),
    "## Context: spec (read-only background, NOT a gate) — specs/104/spec.md",
  );
  assert.equal(BLOCK_SEPARATOR, "\n\n");
  withTree(SPECKIT_TREE, (root) => {
    const documents = loadContextDocuments({
      root,
      specPath: "specs/104/tasks.md",
      format: "speckit-tasks",
    });
    assert.equal(documents.length, 10);
    const block = renderContext(documents);
    // The blocks are in the documents' order, each under its own heading.
    const headings = block.split("\n").filter((line) => line.startsWith("## Context: "));
    assert.deepEqual(
      headings.map((heading) => heading.slice("## Context: ".length).split(" (")[0]),
      documents.map((document) => document.name),
    );
    // Joined by a BLANK line, and with NO newline of the renderer's own: the
    // block ends exactly where the last document's content ends, which here is
    // the newline that file itself carries.
    assert.ok(block.startsWith("## Context: constitution "));
    const last = documents[documents.length - 1] as { name: string; path: string; content: string };
    assert.ok(
      block.endsWith(`${blockHeading(last.name, last.path)}\n${last.content}`),
      "render-context adds no newline of its own (B-1981)",
    );
    assert.ok(block.includes(`\n\n${blockHeading("spec", "specs/104/spec.md")}`));
    // Everything fits under the default budget, so nothing is cut.
    assert.equal(block.includes(TRUNCATION_MARKER), false);

    // Under a tiny budget the later documents are dropped and the kept ones
    // still carry their headings: the block is never half a heading.
    const tiny = renderContext(documents, 1_300);
    assert.equal(tiny.split("## Context: ").length - 1, 10);
    assert.ok(tiny.length < block.length + 1_000);
  });
});
