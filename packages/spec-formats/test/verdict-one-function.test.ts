/**
 * T051 — CT-104-8, the test that the staleness verdict is ONE function
 * (F104-FR-027; CQ-214).
 *
 * Four claims:
 *
 *   1. the verdict IS one function — the classification of the hasher of the
 *      kernel — and every route a caller can take reaches that one operation;
 *   2. it gives the SAME result whenever it is asked: the classification holds
 *      no clock, reads no file and keeps no state, so the answer is a function
 *      of the recorded hashes and the hashes now and of nothing else;
 *   3. `@specstride/spec-formats` compares at NO CHECK POINT itself: where the
 *      comparison is made belongs to features 102, 103 and 105 (ruling K3);
 *   4. a STATIC check that no package outside `packages/kernel/src/hasher/`
 *      classifies recorded hashes against hashes now.
 *
 * The static check is structural and not lexical. A file CLASSIFIES when it
 * does BOTH halves of the job: it produces a state of row 98 (or a verdict of
 * `fresh`/`stale`) as a literal, AND it compares a hash-named value with
 * another. Either half alone is innocent — a presenter names the states it
 * prints, a test compares two hashes — and only the two together are the
 * operation CQ-214 puts in one place. Two controls prove the detector works:
 * the kernel's own classification IS found (non-vacuity), and a synthetic
 * classifier written in a scratch directory under the temporary directory IS
 * found while a clean file beside it is not (falsification). Nothing of this
 * repository is written.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STALENESS_ANNEX_SECTION,
  STALENESS_DEPENDS_ON_WHEN_IT_IS_ASKED,
  STALENESS_READS_A_FILE,
  STATES_OF_A_SOURCE,
  canonicalHasher,
  classifySources,
  classifyStaleness,
  verdictOf,
} from "@specstride/kernel/hasher";
import {
  CLASSIFIER,
  COMPARES_AT_A_CHECK_POINT,
  READS_A_CLOCK,
  hashesNowOf,
  readingOf,
  verdict,
  verdictOfALaunchContract,
  verdictOfARun,
} from "../src/verdict.ts";
import { inputs } from "../src/sources.ts";

/** The root of the repository: four levels up from `test/`. */
const ROOT = resolve(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));

/** The ONE place that may classify recorded hashes against hashes now. */
const THE_CLASSIFIER = "packages/kernel/src/hasher";

/** The product and the test trees the check scans. */
const ROOTS = Object.freeze(["packages", "tools", "tests"]);

const TASKS = [
  "## Phase 1: Setup",
  "",
  "- [ ] T001 create the package",
  "- [ ] T002 the second task",
  "",
].join("\n");
const SPEC = "# Feature Specification\n\n- FR-001 a requirement\n";
const PLAN = "# Implementation Plan\n\nThe plan.\n";

/** A throw-away workspace with the three sources of a Spec Kit feature. */
function workspace(): {
  readonly root: string;
  readonly at: (path: string) => string;
  readonly write: (path: string, text: string) => void;
  readonly remove: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "ss104-verdict-"));
  mkdirSync(join(root, "specs", "alpha"), { recursive: true });
  const write = (path: string, text: string): void =>
    writeFileSync(join(root, ...path.split("/")), text);
  write("specs/alpha/spec.md", SPEC);
  write("specs/alpha/plan.md", PLAN);
  write("specs/alpha/tasks.md", TASKS);
  return {
    root,
    at: (path: string) => join(root, ...path.split("/")),
    write,
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

/* ------------------------------------------------------------------ *
 * The scanner of the static check.
 * ------------------------------------------------------------------ */

/** Every source file under a root, excluding `node_modules` and dot names. */
function sourcesUnder(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(entry.name)) found.push(path);
    }
  };
  walk(root);
  return Object.freeze(found);
}

/** The path of a file relative to a root, with `/` as the separator. */
function pathOf(file: string, root: string): string {
  return relative(root, file).split(sep).join("/");
}

/** The code of a file with every comment stripped: prose is not code. */
function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Half one of the job: the file PRODUCES a state of row 98, or a verdict of
 * row 50, as a literal of its own. Two of them, so a file that merely mentions
 * one word in passing is not counted.
 */
function producesAState(code: string): readonly string[] {
  const states = [...STATES_OF_A_SOURCE, ...NAMES_OF_THE_RUN_VERDICT_MEMBERS];
  return Object.freeze(
    states.filter((state) =>
      new RegExp(`(["'\`])${state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`).test(code),
    ),
  );
}

/** The two names a run verdict can carry (row 50 holds the source names). */
const NAMES_OF_THE_RUN_VERDICT_MEMBERS: readonly string[] = Object.freeze(["fresh", "stale"]);

/**
 * Half two of the job: the file COMPARES a RECORDED hash with a hash NOW. The
 * expression must name a hash on BOTH sides, so a PRESENCE check such as
 * `source.checkboxInsensitiveHash === undefined` is not counted — that asks
 * whether a source carries the hash at all, which every reader of a record
 * may do, and is not a classification.
 */
const A_HASH_NAME =
  "(?:recordedHashIgnoringCheckboxes|recordedHash|hashNowIgnoringCheckboxes|hashNow|" +
  "contentHash|checkboxInsensitiveHash|semantic_sha256|sha256)";

const COMPARES_TWO_HASHES = new RegExp(
  `${A_HASH_NAME}\\b\\s*(?:!==|===|==|!=)\\s*` +
    `(?:[A-Za-z_$][\\w$]*\\s*(?:\\?\\.|\\.)\\s*)*${A_HASH_NAME}\\b`,
);

function comparesAHash(code: string): boolean {
  return COMPARES_TWO_HASHES.test(code);
}

/**
 * The PRODUCT, where a second classifier would be a breach of F104-FR-027:
 * `src/` of a package or of a tool. A test tree is scanned too, but only as a
 * REPORT — a test that MEASURES the classification is not a second classifier
 * in the product, and this very file holds such a measurement by design (the
 * falsification control below writes one as a string). The report is also the
 * proof that the detector finds a classifier wherever one is written.
 */
function isProduct(path: string): boolean {
  return /^(?:packages|tools)\/[^/]+\/src\//.test(path);
}

/** A file that does BOTH halves: it classifies. */
type Classifier = { readonly file: string; readonly states: readonly string[] };

function classifiersIn(files: readonly string[], root: string): readonly Classifier[] {
  const found: Classifier[] = [];
  for (const file of files) {
    const code = codeOf(readFileSync(file, "utf8"));
    const states = producesAState(code);
    if (states.length >= 2 && comparesAHash(code)) {
      found.push({ file: pathOf(file, root), states });
    }
  }
  return Object.freeze(found);
}

/** Every source file of the repository that the check scans. */
const FILES: readonly string[] = Object.freeze(
  ROOTS.flatMap((root) => sourcesUnder(join(ROOT, root))),
);

/** Every classifier of the repository. */
const CLASSIFIERS: readonly Classifier[] = Object.freeze(classifiersIn(FILES, ROOT));

/* ------------------------------------------------------------------ *
 * The tests.
 * ------------------------------------------------------------------ */

test("CT-104-8: the verdict is ONE function, the classification of the kernel's hasher", () => {
  // The owner of the operation, as the annex and CQ-214 name it.
  assert.equal(CLASSIFIER, "@specstride/kernel/hasher");
  assert.equal(STALENESS_ANNEX_SECTION, "annex X, §X.5");
  // The classification is reachable as ONE operation of the canonical hasher,
  // and it is the same function object the module exports.
  assert.equal(canonicalHasher.classifyStaleness, classifyStaleness);
  assert.equal(typeof classifySources, "function");

  const ws = workspace();
  try {
    const recorded = inputs({
      root: ws.root,
      format: "speckit-tasks",
      specPath: ws.at("specs/alpha/tasks.md"),
    });
    assert.equal(recorded.length, 3);
    // A tick of the task list and a changed plan, so the verdict has something
    // to say about two of the three sources.
    ws.write("specs/alpha/tasks.md", TASKS.replace("- [ ] T001", "- [x] T001"));
    ws.write("specs/alpha/plan.md", `${PLAN}\nAnd one more line.\n`);

    const report = verdictOfARun(ws.root, recorded);
    assert.equal(report.verdict.result, "stale");
    assert.deepEqual(
      report.verdict.sources.map((source) => [source.name, source.state]),
      [
        ["spec", "unchanged"],
        ["plan", "changed"],
        ["tasks", "ticks-only"],
      ],
    );
    assert.deepEqual(report.verdict.changed, ["plan"]);
    assert.deepEqual(report.lines, ["sources[1] hash changed: specs/alpha/plan.md"]);

    // EVERY route a caller can take reaches the kernel's one operation, and
    // the states a caller gets are the ones that operation gives. The states
    // are taken DIRECTLY from `classifySources` over the same readings, so the
    // claim is measured and not read off a constant.
    const readings = recorded.map((source) => readingOf(source, hashesNowOf(ws.root, source)));
    const direct = classifySources(readings, { nameRule: "run" });
    assert.deepEqual(
      report.compared.map((source) => [
        source.index,
        source.name,
        source.state,
        source.moreThanTicks,
      ]),
      direct.map((source) => [source.index, source.name, source.state, source.moreThanTicks]),
    );
    assert.equal(report.verdict.result, verdictOf(direct));
    // ...and so does the launch-contract route, which differs only in the name
    // rule: the one operation, asked differently.
    const contract = verdictOfALaunchContract(ws.root, recorded);
    assert.deepEqual(
      contract.compared.map((source) => source.state),
      report.compared.map((source) => source.state),
    );
    assert.equal(contract.verdict.result, report.verdict.result);
    // The general form `verdict` is the one both go through.
    const general = verdict({ root: ws.root, sources: recorded, kind: "run" });
    assert.deepEqual(general, report);

    // `verdict.ts` calls the classification ONCE: the module holds exactly one
    // call of `classifySources` and no comparison of hashes of its own.
    const code = codeOf(readFileSync(new URL("../src/verdict.ts", import.meta.url), "utf8"));
    assert.equal(
      (code.match(/classifySources\(/g) ?? []).length,
      1,
      "`verdict.ts` calls the classification exactly once",
    );
    assert.equal(comparesAHash(code), false, "`verdict.ts` compares no hash itself");
  } finally {
    ws.remove();
  }
});

test("CT-104-8: it gives the SAME result whenever it is asked", () => {
  // The two statements of the classification, and the measurement behind them.
  assert.equal(STALENESS_DEPENDS_ON_WHEN_IT_IS_ASKED, false);
  assert.equal(STALENESS_READS_A_FILE, false);
  assert.equal(READS_A_CLOCK, false);

  const ws = workspace();
  try {
    const recorded = inputs({
      root: ws.root,
      format: "speckit-tasks",
      specPath: ws.at("specs/alpha/tasks.md"),
    });
    ws.write("specs/alpha/plan.md", `${PLAN}\nchanged\n`);

    // Asked ten times over, in two orders, the answer is the same record.
    const first = verdictOfARun(ws.root, recorded);
    for (let round = 0; round < 10; round += 1) {
      assert.deepEqual(verdictOfARun(ws.root, recorded), first, `round ${round}`);
    }
    // A caller that holds its records in another order gets the same VERDICT:
    // `result`, `sources` and `changed` are in the verdict's own order (spec,
    // plan, tasks), so none of the three depends on how the caller asked.
    const reversed = verdictOfARun(ws.root, [...recorded].reverse());
    assert.deepEqual(reversed.verdict, first.verdict);
    // `compared` keeps the RECORDED order and its indices, because the verdict
    // over the sources of a launch contract names a source BY ITS INDEX — so
    // that half of the report follows the caller, by requirement. The STATE of
    // each named source is the same either way round, which is the part that
    // must not depend on the order.
    const stateByName = (report: typeof first): readonly (readonly [string, string])[] =>
      Object.freeze(
        [...report.compared]
          .map((source) => [source.name, source.state] as const)
          .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
      );
    assert.deepEqual(stateByName(reversed), stateByName(first));
    assert.deepEqual(
      reversed.compared.map((source) => source.index),
      [0, 1, 2],
      "the indices are the caller's own, 0 upward",
    );
    assert.deepEqual(
      reversed.compared.map((source) => source.name),
      ["tasks", "plan", "spec"],
      "and in the order the caller recorded them",
    );

    // The classification itself, over the same readings, is the same value
    // every time — and over readings built in a different order too.
    const readings = recorded.map((source) => readingOf(source, hashesNowOf(ws.root, source)));
    const once = classifyStaleness(readings, { nameRule: "run" });
    for (let round = 0; round < 10; round += 1) {
      assert.deepEqual(classifyStaleness(readings, { nameRule: "run" }), once, `round ${round}`);
    }
    assert.deepEqual(classifyStaleness([...readings].reverse(), { nameRule: "run" }), once);

    // The code of the classification holds no clock, no file read and no
    // randomness — measured on the module with its comments stripped, so the
    // prose that NAMES them cannot make the check pass or fail by accident.
    const staleness = readFileSync(
      new URL("../../kernel/src/hasher/staleness.ts", import.meta.url),
      "utf8",
    );
    const code = codeOf(staleness);
    for (const forbidden of [
      "Date.now",
      "new Date",
      "Math.random",
      "node:fs",
      "readFileSync",
      "process.hrtime",
      "performance.now",
    ]) {
      assert.ok(!code.includes(forbidden), `the classification holds no ${forbidden}`);
    }
    // The stripping is falsifiable: the prose DOES name a file read, to say it
    // is absent, and the code does not.
    assert.ok(staleness.includes("read"), "the doc comment speaks of reading");
    // A changed file gives a DIFFERENT answer, so "the same result" is not the
    // same answer for every input.
    ws.write("specs/alpha/spec.md", `${SPEC}\nchanged too\n`);
    assert.notDeepEqual(verdictOfARun(ws.root, recorded), first);
  } finally {
    ws.remove();
  }
});

test("CT-104-8: the package compares at NO CHECK POINT itself", () => {
  // Where the comparison is made belongs to features 102, 103 and 105
  // (ruling K3, research D-5). This package answers when it is asked.
  assert.equal(COMPARES_AT_A_CHECK_POINT, false);

  const ws = workspace();
  try {
    const recorded = inputs({
      root: ws.root,
      format: "speckit-tasks",
      specPath: ws.at("specs/alpha/tasks.md"),
    });
    // Nothing of the verdict runs by itself: a change on disk produces NO
    // report, no record and no write until a caller asks.
    const before = readdirSync(ws.at("specs/alpha")).sort();
    ws.write("specs/alpha/tasks.md", `${TASKS}- [ ] T003 a new task\n`);
    assert.deepEqual(readdirSync(ws.at("specs/alpha")).sort(), before, "nothing was written");

    // The verdict is a pure READER: asking it leaves the tree as it was.
    const report = verdictOfARun(ws.root, recorded);
    assert.equal(report.verdict.result, "stale");
    assert.deepEqual(readdirSync(ws.at("specs/alpha")).sort(), before);
    assert.equal(readFileSync(ws.at("specs/alpha/spec.md"), "utf8"), SPEC);

    // The module holds no timer, no watcher and no schedule: the whole of
    // "when" is the caller's. Measured on the code, comments stripped.
    const code = codeOf(readFileSync(new URL("../src/verdict.ts", import.meta.url), "utf8"));
    for (const forbidden of [
      "setInterval",
      "setTimeout",
      "setImmediate",
      "watch(",
      "Date.now",
      "new Date",
      "process.exit",
    ]) {
      assert.ok(!code.includes(forbidden), `\`verdict.ts\` holds no ${forbidden}`);
    }
    // And it writes to no stream: a report is a value, not an output.
    for (const forbidden of ["process.stdout", "process.stderr", "console."]) {
      assert.ok(!code.includes(forbidden), `\`verdict.ts\` holds no ${forbidden}`);
    }
  } finally {
    ws.remove();
  }
});

test("CT-104-8: no package outside the kernel's hasher classifies (the static check)", () => {
  // NON-VACUITY (a): the scan really read the repository.
  assert.ok(FILES.length > 300, `the scan found ${FILES.length} source files`);
  assert.ok(
    FILES.some((file) => pathOf(file, ROOT) === `${THE_CLASSIFIER}/staleness.ts`),
    "the classification itself is among the files scanned",
  );

  // NON-VACUITY (b): the DETECTOR finds the one real classifier. Without this
  // the check would pass over a repository it cannot read at all.
  const inTheKernel = CLASSIFIERS.filter((found) => found.file.startsWith(`${THE_CLASSIFIER}/`));
  assert.deepEqual(
    inTheKernel.map((found) => found.file),
    [`${THE_CLASSIFIER}/staleness.ts`],
    "the one classifier of the product is the kernel's own",
  );
  assert.ok((inTheKernel[0]?.states.length ?? 0) >= 2);

  // THE CLAIM: no PRODUCT file outside `packages/kernel/src/hasher/` classifies.
  const outside = CLASSIFIERS.filter(
    (found) => isProduct(found.file) && !found.file.startsWith(`${THE_CLASSIFIER}/`),
  );
  assert.deepEqual(
    outside.map((found) => found.file),
    [],
    `these product files classify recorded hashes against hashes now: ${outside
      .map((found) => `${found.file} (${found.states.join(", ")})`)
      .join("; ")}`,
  );
  // The test trees are REPORTED and not changed: a test that measures the
  // classification is no second classifier in the product. This file is among
  // them, because its falsification control writes one as a string.
  const inTests = CLASSIFIERS.filter((found) => !isProduct(found.file)).map((found) => found.file);
  assert.ok(
    inTests.includes("packages/spec-formats/test/verdict-one-function.test.ts"),
    `the detector finds the measurement in this very file; it reported ${inTests.join(", ")}`,
  );

  // The CALLERS reach the operation rather than repeating it. Of the three the
  // task names, this one exists and is measured directly; the packages of 102
  // and 103 are measured where they exist, and reported where they do not —
  // a package that is not built yet cannot hold a second classifier either.
  const callers = Object.freeze({
    "@specstride/spec-formats": "packages/spec-formats",
    "102 run-control": "packages/runtime",
    "103 proposer-pass": "packages/pipeline",
  });
  const report: string[] = [];
  for (const [name, directory] of Object.entries(callers)) {
    const files = sourcesUnder(join(ROOT, directory, "src"));
    if (files.length === 0) {
      report.push(`${name}: ${directory}/src holds no source file yet`);
      continue;
    }
    assert.deepEqual(
      classifiersIn(files, ROOT).map((found) => found.file),
      [],
      `${name} classifies no hash itself`,
    );
    report.push(`${name}: ${files.length} file(s), 0 classifiers`);
  }
  assert.equal(report.length, 3);
  // The one caller that DOES call the operation calls it, so "they call the
  // kernel's operation" is not satisfied by calling nothing at all.
  const verdictCode = readFileSync(new URL("../src/verdict.ts", import.meta.url), "utf8");
  assert.match(verdictCode, /from "@specstride\/kernel\/hasher"/);
  assert.match(codeOf(verdictCode), /classifySources\(/);

  // FALSIFICATION: the same scan over a SCRATCH directory under the temporary
  // directory. A clean file is not a classifier; a file that does both halves
  // of the job IS found. Nothing of this repository is written.
  const scratch = mkdtempSync(join(tmpdir(), "ss104-static-"));
  try {
    mkdirSync(join(scratch, "packages", "elsewhere", "src"), { recursive: true });
    const at = (name: string): string => join(scratch, "packages", "elsewhere", "src", name);
    // (a) a file that only NAMES the states: a presenter. Not a classifier.
    writeFileSync(
      at("presenter.ts"),
      'export const WORDS = ["unchanged", "ticks-only", "changed", "unreadable"];\n' +
        "export const show = (state: string) => WORDS.includes(state);\n",
    );
    // (b) a file that only COMPARES hashes: a test. Not a classifier.
    writeFileSync(
      at("compare.ts"),
      "export const same = (a: {contentHash: string}, b: {contentHash: string}) =>\n" +
        "  a.contentHash === b.contentHash;\n",
    );
    // (c) a file that does BOTH: a second classifier, which must be found.
    writeFileSync(
      at("second-classifier.ts"),
      "export function classify(recorded: {contentHash: string; checkboxInsensitiveHash?: string},\n" +
        "  now: {contentHash: string; checkboxInsensitiveHash?: string}): string {\n" +
        '  if (recorded.contentHash === now.contentHash) return "unchanged";\n' +
        '  if (recorded.checkboxInsensitiveHash === now.checkboxInsensitiveHash) return "ticks-only";\n' +
        '  return "changed";\n' +
        "}\n",
    );
    const inScratch = classifiersIn(sourcesUnder(scratch), scratch);
    assert.deepEqual(
      inScratch.map((found) => found.file),
      ["packages/elsewhere/src/second-classifier.ts"],
      "the detector finds a second classifier and nothing else",
    );
    // And a scratch tree with the classifier REMOVED reports nothing: the
    // detector is falsifiable in both directions.
    rmSync(at("second-classifier.ts"));
    assert.deepEqual(classifiersIn(sourcesUnder(scratch), scratch), []);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
