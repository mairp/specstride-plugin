/**
 * The kernel side of the notebook sweep (annex B, §B.5; F100-FR-057,
 * F100-FR-058; T247). The parity tests of `tests/parity/100/` read the same
 * function from the port side.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CANONICAL_NAME,
  EVENT_FIELDS,
  EVENT_TYPE,
  EVIDENCE_NAME,
  STRAY_FILE_NAME,
  STRAY_PLACES,
  canonicalPath,
  strayPaths,
  sweepLogLine,
  sweepNotebooks,
} from "../src/notebook-sweep/index.ts";

function sandbox(): { root: string; input: Parameters<typeof sweepNotebooks>[0] } {
  const root = mkdtempSync(join(tmpdir(), "specstride-sweep-"));
  const workspace = join(root, "repo");
  mkdirSync(workspace, { recursive: true });
  return {
    root,
    input: {
      slug: "100-specstride",
      phase: 3,
      workspaceRealPath: workspace,
      roots: {
        "<control>": join(root, "control"),
        "<workspace>": workspace,
        "<workspace-part>": join(workspace, ".specstride"),
        "<worker-root>": join(root, "workers"),
        "<user-config>": join(root, "cfg"),
        "<user-state>": join(root, "state"),
        "<user-cache>": join(root, "cache"),
        "<temp>": join(root, "tmp"),
        "<package>": join(root, "pkg"),
        "<harness-home>": join(root, "hh"),
      },
      parameters: { "<runId>": "run-1", "<k>": 1, "<n>": 1 },
    },
  };
}

const touch = (path: string, contents: string, seconds: number): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  utimesSync(path, seconds, seconds);
};

test("the sweep looks at the two as-is stray places (F100-FR-057)", () => {
  const { root, input } = sandbox();
  try {
    assert.equal(CANONICAL_NAME, "feature:<slug>:notebook");
    assert.equal(EVIDENCE_NAME, "gate:<N>:evidence");
    assert.deepEqual([...STRAY_PLACES], ["phase-evidence-directory", "working-tree-root"]);
    const places = strayPaths(input);
    assert.equal(places.length, 2);
    // The directory of the phase evidence, and the root of the working tree.
    assert.equal(places[1]?.path, join(input.workspaceRealPath, STRAY_FILE_NAME));
    assert.equal(places[0]?.place, "phase-evidence-directory");
    assert.ok(canonicalPath(input).includes("100-specstride"));
    // Nothing to sweep when neither place holds a notebook.
    assert.deepEqual([...sweepNotebooks(input)], []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the newer file wins: the stray replaces the canonical one when it is newer (F100-FR-057)", () => {
  const { root, input } = sandbox();
  try {
    const to = canonicalPath(input);
    const from = join(input.workspaceRealPath, STRAY_FILE_NAME);
    touch(to, "canonical\n", 1_000);
    touch(from, "stray-and-newer\n", 2_000);
    const results = sweepNotebooks(input);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.outcome, "replaced");
    assert.equal(readFileSync(to, "utf8"), "stray-and-newer\n");
    assert.equal(existsSync(from), false, "the stray file is moved, not copied");
    // The as-is log line carries both paths.
    assert.equal(results[0]?.logLine, sweepLogLine(from, to));
    assert.ok(results[0]?.logLine.includes(from));
    assert.ok(results[0]?.logLine.includes(to));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the newer file wins: the stray is deleted when the canonical one is newer (F100-FR-057)", () => {
  const { root, input } = sandbox();
  try {
    const to = canonicalPath(input);
    const from = join(input.workspaceRealPath, STRAY_FILE_NAME);
    touch(to, "canonical-and-newer\n", 2_000);
    touch(from, "stray\n", 1_000);
    const results = sweepNotebooks(input);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.outcome, "deleted");
    assert.equal(readFileSync(to, "utf8"), "canonical-and-newer\n");
    assert.equal(existsSync(from), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the sweep returns the event progress.swept with from and to (F100-FR-058)", () => {
  const { root, input } = sandbox();
  try {
    const to = canonicalPath(input);
    const from = join(input.workspaceRealPath, STRAY_FILE_NAME);
    touch(from, "stray\n", 2_000);
    const results = sweepNotebooks(input);
    assert.equal(results.length, 1);
    const event = results[0]?.event;
    assert.equal(EVENT_TYPE, "progress.swept");
    assert.equal(event?.type, EVENT_TYPE);
    assert.deepEqual([...EVENT_FIELDS], ["from", "to"]);
    assert.equal(event?.data.from, from);
    assert.equal(event?.data.to, to);
    // The canonical file now holds the stray content, written atomically.
    assert.equal(readFileSync(to, "utf8"), "stray\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a notebook at each of the two stray places gives one result each", () => {
  const { root, input } = sandbox();
  try {
    const places = strayPaths(input);
    for (const place of places) touch(place.path, `at ${place.place}\n`, 3_000);
    const results = sweepNotebooks(input);
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((r) => r.place),
      ["phase-evidence-directory", "working-tree-root"],
    );
    for (const place of places) assert.equal(existsSync(place.path), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
