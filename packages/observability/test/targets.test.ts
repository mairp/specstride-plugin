/**
 * T037 — PT-111-C-167-target-extraction: the parity test of C-167 / B-2210,
 * B-2211, B-2217 and B-2218 on the fixture family FX-26 (stream formats through
 * the seam), surface `events`.
 *
 * F111-FR-026: *The observability policy MUST treat targets as the baseline
 * does. The string values of the keys `file`, `file_path`, `filename`,
 * `notebook_path`, `path`, `paths`, `target`, `targets`, `destination` and
 * `source` (also in camel case) MUST be taken as paths. The values of
 * `command`, `cmd` and `script` MUST be split as a shell would split them (on a
 * quoting error, at white space) to find paths. Extraction MUST be lexical:
 * tokens that start with `-`, `http://` or `https://`, shell operators and
 * tokens not shaped as paths MUST be discarded and duplicates removed. At most
 * 8 targets MUST be kept. A tool argument MUST be summarised as `targets`,
 * `summary` (the redacted JSON cut to the argument limit), `redacted`,
 * `truncated`, `original_bytes` and `retained_bytes`.*
 *
 * THE EXPECTED VALUES OF `BASELINE_CASES` BELOW WERE READ OFF THE BASELINE.
 * `lib/observability_policy.py` at `9cab15d` was run over each input and its
 * answer recorded, so the table is a characterization of the as-is behaviour
 * and not a restatement of the port. Two answers are worth naming, because a
 * port written from the prose alone would get them wrong: the PROGRAM NAME of a
 * command is kept (`cp`, `cat`, `rm` are shaped like paths, and the baseline's
 * extraction is lexical, so it does not know they are programs), and a shell
 * operator between two commands is dropped while both commands' own names stay.
 *
 * EXTRACTION IS LEXICAL AND NOTHING IS EXECUTED. The test proves that in the
 * strongest way available to it: a command whose tokens would delete a file is
 * put through `extractTargetPaths` with the file on disk, and the file is still
 * there afterwards.
 *
 * The REFERENCE side of a parity test is the oracle of feature 141, which is
 * not built: that half reports a SKIP with its reason and never a pass (the
 * constitution, principle XVII).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMAND_KEYS,
  SHELL_OPERATORS,
  TARGET_KEYS,
  extractTargetPaths,
  shellSplit,
  snakeKey,
  summarizeTargets,
} from "../src/ingress/targets.ts";
import {
  DEFAULT_LIMITS,
  SANITIZED_METADATA_FIELDS,
  baselineJson,
  resolveLimits,
} from "../src/ingress/limits.ts";

const ROOT = resolve(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
const FIXTURES = ["FX-26"] as const;

function referenceHalf(): { skip: string | false } {
  const present =
    existsSync(join(ROOT, "tests", "parity", "reference")) &&
    existsSync(join(ROOT, "packages", "oracle", "src"));
  if (present) return { skip: false };
  return {
    skip:
      `prerequisite missing: the parity oracle of feature 141 (\`packages/oracle\` and ` +
      `\`tests/parity/reference\`) is not built, so the fixture family ${FIXTURES.join(", ")} ` +
      `cannot be run against the reference. This is a SKIP with its reason and never a pass ` +
      `(the constitution, principle XVII).`,
  };
}

test(
  "PT-111-C-167: the targets of the reference on FX-26 equal the port's",
  referenceHalf(),
  () => {
    assert.fail("the oracle is present: compare the reference trees here");
  },
);

const limits = resolveLimits();

/* ------------------------------------------------------------------ *
 * The characterization table, read off the baseline.
 * ------------------------------------------------------------------ */

/** Each row: the input, and what `lib/observability_policy.py` answered. */
const BASELINE_CASES: readonly { input: unknown; targets: readonly string[]; why: string }[] =
  Object.freeze([
    { input: { filePath: "src/a.ts" }, targets: ["src/a.ts"], why: "camel case of `file_path`" },
    {
      input: { notebookPath: "nb/b.ipynb" },
      targets: ["nb/b.ipynb"],
      why: "camel case of `notebook_path`",
    },
    { input: { note: "src/a.ts" }, targets: [], why: "`note` is no key of either set" },
    {
      input: { edit: { paths: ["src/a.ts", "src/b.ts"] } },
      targets: ["src/a.ts", "src/b.ts"],
      why: "a path key however deep, member by member",
    },
    {
      input: { command: "cp -r src/a.ts build/a.ts" },
      targets: ["cp", "src/a.ts", "build/a.ts"],
      why: "the flag goes, the PROGRAM NAME stays: extraction is lexical",
    },
    {
      input: { command: "curl -sS https://example.com/x http://y/z src/a.ts" },
      targets: ["curl", "src/a.ts"],
      why: "`http://` and `https://` tokens go",
    },
    {
      input: { command: "cat src/a.ts | tee out/b.ts" },
      targets: ["cat", "src/a.ts", "tee", "out/b.ts"],
      why: "the operator `|` goes, both program names stay",
    },
    {
      input: { paths: ["", "   ", "a b", "!!", "$VAR?"] },
      targets: [],
      why: "none is shaped as a path",
    },
    {
      input: { paths: ["src/a.ts", "src/b.ts", "src/a.ts"] },
      targets: ["src/a.ts", "src/b.ts"],
      why: "duplicates removed, first order kept",
    },
    { input: { paths: ["--flag", "-o", "src/a.ts"] }, targets: ["src/a.ts"], why: "`-` goes" },
    {
      input: { paths: ["|", "||", "&&", ">", ">>", "<"] },
      targets: [],
      why: "the six shell operators go",
    },
    {
      input: { command: "cat src/a.ts", api_key: "sekritvalue" },
      targets: ["cat", "src/a.ts"],
      why: "a secret key is no path key",
    },
    { input: { file: "src/a.ts" }, targets: ["src/a.ts"], why: "the plain key `file`" },
  ]);

test("every case of the baseline table gives the baseline's answer", () => {
  for (const row of BASELINE_CASES) {
    assert.deepEqual(
      extractTargetPaths(row.input, limits),
      [...row.targets],
      `${JSON.stringify(row.input)} (${row.why})`,
    );
  }
  assert.equal(BASELINE_CASES.length, 13);
});

/* ------------------------------------------------------------------ *
 * The path keys and the command keys (B-2210).
 * ------------------------------------------------------------------ */

test("the ten path keys are the ten of the requirement", () => {
  assert.deepEqual([...TARGET_KEYS].sort(), [
    "destination",
    "file",
    "file_path",
    "filename",
    "notebook_path",
    "path",
    "paths",
    "source",
    "target",
    "targets",
  ]);
});

test("the three command keys are `command`, `cmd` and `script`", () => {
  assert.deepEqual([...COMMAND_KEYS].sort(), ["cmd", "command", "script"]);
  for (const key of COMMAND_KEYS) {
    assert.deepEqual(
      extractTargetPaths({ [key]: "wc -l src/a.ts" }, limits),
      ["wc", "src/a.ts"],
      key,
    );
  }
});

test("camel case reaches the same key through the snake-case formula", () => {
  assert.equal(snakeKey("filePath"), "file_path");
  assert.equal(snakeKey("notebookPath"), "notebook_path");
  assert.equal(snakeKey("file_path"), "file_path");
  assert.equal(snakeKey("FilePath"), "_file_path");
});

/* ------------------------------------------------------------------ *
 * The command keys are split as a shell would (B-2211).
 * ------------------------------------------------------------------ */

test("a command is split as a shell splits it: quotes hold a token together", () => {
  assert.deepEqual(shellSplit(`cat "a b.txt" 'c d.txt'`), ["cat", "a b.txt", "c d.txt"]);
  assert.deepEqual(shellSplit("ls   -la   src/x.ts"), ["ls", "-la", "src/x.ts"]);
  assert.deepEqual(shellSplit("echo a\\ b"), ["echo", "a b"]);
});

test("a quoting error falls back to a split at white space", () => {
  // An unmatched quote: `shlex.split` raises `No closing quotation`, and the
  // baseline falls back to `command.split()`.
  assert.deepEqual(shellSplit(`cat "unclosed src/a.ts`), ["cat", `"unclosed`, "src/a.ts"]);
});

test("extraction is LEXICAL: a command that would delete a file does not delete it", () => {
  const dir = mkdtempSync(join(tmpdir(), "pt-111-targets-"));
  const victim = join(dir, "keep-me.txt");
  writeFileSync(victim, "still here\n");
  try {
    const targets = extractTargetPaths({ command: `rm -rf ${victim}` }, limits);
    assert.ok(existsSync(victim), "the file was not touched: nothing was executed");
    assert.equal(readFileSync(victim, "utf8"), "still here\n");
    assert.deepEqual(targets, ["rm", victim]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * What is discarded (B-2217).
 * ------------------------------------------------------------------ */

test("the shell operators are the baseline's six", () => {
  assert.deepEqual([...SHELL_OPERATORS].sort(), ["<", ">", ">>", "&&", "|", "||"].sort());
  for (const operator of SHELL_OPERATORS) {
    assert.deepEqual(extractTargetPaths({ paths: [operator] }, limits), [], operator);
  }
});

test("a target longer than the target limit is cut to it, in bytes", () => {
  const cut = resolveLimits({ targetMaxBytes: 16 });
  const long = `src/${"x".repeat(60)}.ts`;
  const [only] = extractTargetPaths({ path: long }, cut);
  assert.equal(Buffer.byteLength(only as string, "utf8"), 16);
  assert.ok(long.startsWith(only as string));
});

/* ------------------------------------------------------------------ *
 * At most eight targets (B-2218).
 * ------------------------------------------------------------------ */

test("at most eight targets are kept, and the default is eight", () => {
  assert.equal(DEFAULT_LIMITS.maxTargetPaths, 8);
  const many = Array.from({ length: 20 }, (_, index) => `src/f${index}.ts`);
  const targets = extractTargetPaths({ paths: many }, limits);
  assert.equal(targets.length, 8);
  assert.deepEqual(targets, many.slice(0, 8));
});

/* ------------------------------------------------------------------ *
 * The summary of a tool argument (B-2218).
 * ------------------------------------------------------------------ */

test("a tool argument is summarised as exactly the six fields of the requirement", () => {
  const summary = summarizeTargets({ command: "cat src/a.ts", api_key: "sekritvalue" }, limits);
  assert.deepEqual(Object.keys(summary).sort(), [
    "original_bytes",
    "redacted",
    "retained_bytes",
    "summary",
    "targets",
    "truncated",
  ]);
  for (const field of SANITIZED_METADATA_FIELDS) {
    assert.ok(Object.hasOwn(summary, field), field);
  }
});

test("the summary of the baseline's own case equals the baseline's answer, byte for byte", () => {
  // Read off `lib/observability_policy.py` at `9cab15d`:
  //   {'targets': ['cat', 'src/a.ts'],
  //    'summary': '{"api_key": "[REDACTED]", "command": "cat src/a.ts"}',
  //    'redacted': True, 'truncated': False,
  //    'original_bytes': 53, 'retained_bytes': 52}
  const summary = summarizeTargets({ command: "cat src/a.ts", api_key: "sekritvalue" }, limits);
  assert.deepEqual(summary, {
    targets: ["cat", "src/a.ts"],
    summary: '{"api_key": "[REDACTED]", "command": "cat src/a.ts"}',
    redacted: true,
    truncated: false,
    original_bytes: 53,
    retained_bytes: 52,
  });
  assert.ok(!summary.summary.includes("sekritvalue"), summary.summary);
});

test("`original_bytes` is the size BEFORE redaction, and the keys are sorted", () => {
  const argument = { command: "cat src/a.ts", api_key: "sekritvalue" };
  const before = baselineJson(argument);
  assert.equal(before, '{"api_key": "sekritvalue", "command": "cat src/a.ts"}');
  const summary = summarizeTargets(argument, limits);
  assert.equal(summary.original_bytes, Buffer.byteLength(before, "utf8"));
  assert.notEqual(summary.original_bytes, summary.retained_bytes);
});

test("the summary is cut to the ARGUMENT limit, and `truncated` says so", () => {
  const cut = resolveLimits({ toolArgsMaxBytes: 32 });
  const summary = summarizeTargets({ command: "cat src/a.ts", note: "y".repeat(400) }, cut);
  assert.equal(summary.truncated, true);
  assert.equal(summary.retained_bytes, 32);
  assert.equal(Buffer.byteLength(summary.summary, "utf8"), 32);
  assert.ok(summary.original_bytes > 400);
});

test("an argument that holds no secret and fits is neither redacted nor truncated", () => {
  const summary = summarizeTargets({ file: "src/a.ts" }, limits);
  assert.equal(summary.redacted, false);
  assert.equal(summary.truncated, false);
  assert.deepEqual(summary.targets, ["src/a.ts"]);
  assert.equal(summary.summary, '{"file": "src/a.ts"}');
});
