/**
 * The composition root of `specstride run`, with a stub of the `claude`
 * executable: an honest phase is approved, signed, ticked and committed; a
 * rejected phase ends at the reject limit with no approval and no commit; a
 * second run over approved phases does nothing.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runFeature } from "../../src/engine/run-feature.ts";

const STUB = (verdict: string): string => `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const argv = process.argv.slice(2);
const prompt = fs.readFileSync(0, "utf8");
const session = argv[argv.indexOf("--session-id") + 1];
const critic = argv.includes("--max-turns");
console.log(JSON.stringify({ type: "system", subtype: "init", tools: critic ? [] : ["Read"], session_id: session }));
if (prompt.includes("Diagnostician")) {
  // A call of the diagnostician: no nonce, no verdict; the case and the hint.
  fs.writeFileSync("seen-by-diagnostician.txt", prompt);
  console.log(JSON.stringify({ type: "result", result: "CASE: GROUNDING\\nName the missing test of T001." }));
} else if (critic) {
  fs.writeFileSync("seen-by-critic.txt", prompt);
  const nonce = /VERDICT ([0-9a-f]+): APPROVED/.exec(prompt)[1];
  console.log(JSON.stringify({ type: "result", result: "T001 judged.\\nVERDICT " + nonce + ": ${verdict}" }));
} else {
  const evidence = /write (\\.specstride\\S+?):/i.exec(prompt)[1];
  fs.mkdirSync(path.dirname(evidence), { recursive: true });
  fs.writeFileSync(evidence, "T001 done\\n");
  fs.writeFileSync("made.txt", process.env.STUB_NEW_FILE ?? "work\\n");
  fs.mkdirSync("newdir", { recursive: true });
  fs.writeFileSync("newdir/inside.txt", "nested\\n");
  const tasks = "specs/001-one/tasks.md";
  fs.writeFileSync(tasks, fs.readFileSync(tasks, "utf8").replace("[ ]", "[x]"));
  console.log(JSON.stringify({ type: "result", result: "ok" }));
}
`;

function fixture(verdict: string): { readonly dir: string; readonly restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "specstride-run-"));
  const bin = join(dir, "bin");
  const work = join(dir, "work");
  mkdirSync(bin);
  mkdirSync(join(work, "specs", "001-one"), { recursive: true });
  writeFileSync(join(bin, "claude"), STUB(verdict));
  chmodSync(join(bin, "claude"), 0o755);
  writeFileSync(
    join(work, "specs", "001-one", "tasks.md"),
    "# Tasks\n\n## Phase 1: One\n\n- [ ] T001 Do it\n",
  );
  for (const argv of [
    ["init", "-q"],
    ["config", "user.email", "t@t"],
    ["config", "user.name", "t"],
    ["add", "-A"],
    ["commit", "-qm", "init"],
  ]) {
    spawnSync("git", ["-C", work, ...argv]);
  }
  const before = { HOME: process.env.HOME, PATH: process.env.PATH };
  process.env.HOME = dir;
  process.env.PATH = `${bin}:${before.PATH ?? ""}`;
  return {
    dir: work,
    restore: () => {
      process.env.HOME = before.HOME;
      process.env.PATH = before.PATH;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const commits = (dir: string): number =>
  Number(spawnSync("git", ["-C", dir, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).stdout);

test("an approved phase is ticked and committed, and a second run does nothing", async () => {
  const { dir, restore } = fixture("APPROVED");
  try {
    assert.equal(await runFeature({ argv: [], workdir: dir }), 0);
    assert.equal(commits(dir), 2);
    assert.match(readFileSync(join(dir, "specs", "001-one", "tasks.md"), "utf8"), /- \[x\] T001/);
    assert.equal(await runFeature({ argv: [], workdir: dir }), 0);
    assert.equal(commits(dir), 2);
  } finally {
    restore();
  }
});

test("a rejected phase ends at the reject limit with no approval and no commit", async () => {
  const { dir, restore } = fixture("REJECTED");
  try {
    assert.equal(await runFeature({ argv: [], workdir: dir }), 2);
    assert.equal(commits(dir), 1);
    assert.equal(existsSync(join(dir, "made.txt")), true);
    // The stub pass ticked the file; only an approval may, so the engine put it back.
    assert.match(readFileSync(join(dir, "specs", "001-one", "tasks.md"), "utf8"), /- \[ \] T001/);
  } finally {
    restore();
  }
});

test("the state directory is not committed", async () => {
  const { dir, restore } = fixture("APPROVED");
  try {
    assert.equal(await runFeature({ argv: [], workdir: dir }), 0);
    const files = spawnSync("git", ["-C", dir, "show", "--name-only", "--format=", "HEAD"], {
      encoding: "utf8",
    }).stdout;
    assert.match(files, /made\.txt/);
    assert.match(files, /newdir\/inside\.txt/);
    assert.doesNotMatch(files, /\.specstride/);
    assert.equal(
      spawnSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }).stdout,
      "",
    );
  } finally {
    restore();
  }
});

test("a secret in the change blocks the commit and is not shown to the critic", async () => {
  const { dir, restore } = fixture("APPROVED");
  const secret = `ghp_${"a1B2c3D4e5".repeat(4)}`;
  process.env.STUB_NEW_FILE = `token=${secret}\\n`;
  try {
    // The run still approves the phase, and its commit stays blocked — so the
    // run no longer exits 0: its work sits uncommitted. Owner ruling
    // 2026-11-04 (commit-gate false positive), part A item 2; this test is the
    // pin of exit 0 with a blocked commit that the ruling replaces.
    assert.equal(await runFeature({ argv: [], workdir: dir }), 1);
    assert.equal(commits(dir), 1);
    assert.doesNotMatch(readFileSync(join(dir, "seen-by-critic.txt"), "utf8"), new RegExp(secret));
    assert.match(readFileSync(join(dir, "seen-by-critic.txt"), "utf8"), /--- new file made\.txt/);
  } finally {
    delete process.env.STUB_NEW_FILE;
    restore();
  }
});

test("a run with a blocked commit exits 1 and says so on the digest and the console", async () => {
  const { dir, restore } = fixture("APPROVED");
  // A hit the gate never excuses: an address with embedded credentials, which
  // the narrowed url-embedded-credentials pattern still matches.
  process.env.STUB_NEW_FILE = 'const u = "https://user:pass@host";';
  const chunks: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: unknown): boolean => {
    if (typeof chunk === "string") chunks.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    assert.equal(await runFeature({ argv: [], workdir: dir }), 1);
    const out = chunks.join("");
    assert.equal(commits(dir), 1, "the init commit only: the blocked commit is not made");
    // The console says so plainly, in one line, with the exit it ended on.
    assert.match(
      out,
      /1 commit\(s\) were blocked by the secret gate; the work of those phases stays uncommitted — the run exits 1, not 0/,
    );
    // And the digest carries the non-zero exit beside the count.
    assert.match(out, /DIGEST exit=1 stop=none cost_usd=\d+\.\d+ commits_blocked=1 run=run-/);
  } finally {
    process.stdout.write = originalWrite;
    delete process.env.STUB_NEW_FILE;
    restore();
  }
});
