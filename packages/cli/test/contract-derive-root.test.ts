/**
 * The repository root the `contract` verbs work on when the caller names
 * none: the root of the GIT WORK TREE of the working directory, not the
 * nearest ancestor that already holds a `.specstride` state directory
 * (packages/cli/src/engine/handlers.ts, `workingRepositoryRoot`).
 *
 * The seam: `contract derive` is the FIRST command of a repository. A host
 * (Claude Code with the plugin) runs it from the repository it was pointed
 * at; when an ANCESTOR of that repository happens to carry a control plane —
 * a trial directory that holds many fixture repositories under one
 * `.specstride` — the state-layout walk would bind every fixture's contract
 * to the ancestor's state. The work tree is the boundary the sources live
 * in, so it is the boundary the contract lives in.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { contractDeriveHandler } from "../src/engine/handlers.ts";

/**
 * One fixture: an outer directory that holds a control plane, and a git
 * repository inside it whose sources are its own — the shape of a trial
 * directory that carries many fixture repositories under one `.specstride`.
 */
function nestedRepository(): { outer: string; repo: string } {
  const outer = mkdtempSync(join(tmpdir(), "derive-root-"));
  // The ancestor's control plane: present, empty, and NOT the root of the
  // repository below it.
  mkdirSync(join(outer, ".specstride"));
  const repo = join(outer, "the-repository");
  const feature = join(repo, "specs", "001-made");
  mkdirSync(feature, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  // The smallest Spec Kit feature the inventory accepts: a tasks.md with one
  // task of one phase.
  writeFileSync(
    join(feature, "tasks.md"),
    ["# Tasks", "", "## Phase 1: Create", "", "- [ ] T001 Create `made.txt`", ""].join("\n"),
  );
  return { outer, repo };
}

test("contract derive works on the work tree root, not an ancestor's control plane", () => {
  const { outer, repo } = nestedRepository();
  const previousCwd = process.cwd();
  let exit = -1;
  const lines: string[] = [];
  try {
    process.chdir(repo);
    exit = contractDeriveHandler([], {
      out: (text: string): void => {
        lines.push(text);
      },
      err: (text: string): void => {
        lines.push(text);
      },
    });
  } finally {
    process.chdir(previousCwd);
  }
  try {
    assert.equal(exit, 0, lines.join(""));
    // The contract landed in the REPOSITORY's own state, under its pipeline.
    const contract = join(repo, ".specstride", "state", "pipeline", "001-made", "contract");
    assert.ok(existsSync(contract), `the contract is written at ${contract}`);
    // The ancestor's control plane was not captured: it holds no pipeline.
    assert.ok(!existsSync(join(outer, ".specstride", "state", "pipeline")));
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});
