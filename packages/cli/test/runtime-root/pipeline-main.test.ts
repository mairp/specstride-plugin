/**
 * The runtime root of a launched pipeline (packages/cli/src/runtime-root/
 * pipeline-main.ts) — the process the launcher becomes, run here in process
 * on a throwaway repository, the way the launcher's
 * `SPECSTRIDE_PIPELINE_ENTRY` reaches it.
 *
 * What this test holds, on a hand-built launch bundle whose contract carries
 * the fixture-shaped stages of `tests/parity/107/phase4-helper.ts`
 * (`applyFixtureCompletion`): the stage graph as the executor runs it, the
 * workspace lock and the lease of handshake step 3, the supervision record,
 * the state record and the events of the run, and ONE final `[DIGEST]` line.
 *
 * The engine is a `-e` script of the node binary the environment names as
 * `SPECSTRIDE_ENGINE` — the argument list of the contract stage begins with
 * the word `specstride`, and the root replaces it, so the stage runs the CLI
 * this build would run without needing it on a search path the child does
 * not hold.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { main } from "../../src/runtime-root/pipeline-main.ts";
import { contentHash } from "@specstride/kernel";
import { dirname } from "node:path";
// The lock of the workspace, held by the test the way the runtime root holds
// it (feature 122); the sources by relative path, the pattern of
// `commands/supervise.ts`.
import { createDirectoryLock } from "../../../../packages/runtime/src/lock/directory-lock.ts";
import { buildOwnerRecord } from "../../../../packages/runtime/src/lock/owner-record.ts";

/** The module under test, by absolute path — the child process imports it. */
const MAIN_PATH = fileURLToPath(
  new URL("../../src/runtime-root/pipeline-main.ts", import.meta.url),
);

/** The input of one run, handed to the child through the environment. */
const INPUT_VARIABLE = "STEP4_ROOT_INPUT";

/** One throwaway repository with a control plane. */
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "step4-root-"));
  mkdirSync(join(repo, ".specstride"), { recursive: true });
  return repo;
}

/** The bundle of one contract, under its logical name; the logical name back. */
function writeBundle(
  repo: string,
  contract: Record<string, unknown>,
): { logicalName: string; hash: string } {
  const id = String(contract["id"]);
  const address = "0123456789abcdef0123";
  const bundlePath = join(repo, ".specstride", "state", "pipeline", id, "bundle", address);
  mkdirSync(bundlePath, { recursive: true });
  writeFileSync(
    join(bundlePath, "launch-contract.json"),
    `${JSON.stringify(contract, null, 2)}\n`,
    "utf8",
  );
  return { logicalName: `pipeline:${id}:bundle:${address}`, hash: "f".repeat(64) };
}

/** A completed launch contract whose stages take the fixture's shape.
 *
 * The record schema of `specstride.launch-contract/1` is CLOSED, so the
 * fixture carries exactly the keys the schema names. The root validates by
 * the ONE schema (F107-FR-012: the record schema joined with the item
 * schemas feature 107 owns) and by the strict rules through its `invalid`
 * port (F123-FR-004), so the fixture is written the way a real derivation
 * and completion write it: at least one source whose hash matches the file
 * (the staleness check reads it), `action` an argv list (F107-FR-041a),
 * `configuration.verification` a record with its reason (F107-FR-036), and
 * postconditions that are never empty.
 */
function contractOf(repo: string, stages: Record<string, unknown>[]): Record<string, unknown> {
  const tasks = join(repo, "specs", "demo", "tasks.md");
  mkdirSync(dirname(tasks), { recursive: true });
  writeFileSync(tasks, "# Tasks\n\n## Phase 1: Create\n\n- [ ] T001 Create `made.txt`\n");
  return {
    schema: "specstride.launch-contract/1",
    id: "demo",
    status: "draft",
    generated_by: { tool: "contract-derive", version: "1.0" },
    repository: { root: repo, revision: null, dirty: null },
    authorized_roots: [repo],
    features: [
      {
        path: "specs/demo",
        slug: "demo",
        phases: [],
        task_count: 1,
        artifacts_present: ["tasks.md"],
        artifacts_absent: [],
      },
    ],
    sources: [
      {
        path: "specs/demo/tasks.md",
        kind: "tasks",
        sha256: contentHash(readFileSync(tasks)),
        lines: 5,
        semantic_sha256: contentHash(readFileSync(tasks)),
      },
    ],
    inventory: { prerequisites: [], shell_candidates: [], tasks: [], verification_documents: [] },
    configuration: { verification: { mode: "off", reason: "configured" } },
    coverage: [],
    findings: [],
    stages,
  };
}

/** One stage of the contract, in the shape the fixture completion writes:
 * the action is the argument list itself (an argv, not an object). */
function engineStage(repo: string, script: string): Record<string, unknown> {
  const action = ["specstride", "-e", script];
  return {
    id: "run-demo",
    kind: "specstride",
    depends_on: [],
    cwd: repo,
    action,
    resume: action,
    preconditions: [],
    // The completion's fallback postcondition (F107-FR-041a): never empty.
    postconditions: [{ check: "dir_exists", timing: "stage", target: ".specstride" }],
    recovery: {},
    evidence: ["run-demo"],
  };
}

/** The script the engine runs: it records what the child of the stage sees. */
function probeScript(mark: string, lease: string): string {
  return [
    'const fs = require("node:fs");',
    "const parts = [",
    '  "feature=" + process.env.SPECSTRIDE_FEATURE,',
    `  "lease=" + fs.existsSync(${JSON.stringify(lease)}),`,
    '  "noColor=" + process.env.NO_COLOR,',
    '  "liveOutput=" + process.env.SPECSTRIDE_LIVE_OUTPUT,',
    "];",
    `fs.appendFileSync(${JSON.stringify(mark)}, parts.join(" ") + "\\n");`,
  ].join(" ");
}

/** The root's environment for one launch; the previous values back. */
function launchEnvironment(
  over: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return { ...process.env, ...over };
}

/**
 * Run the root as its own process — the way the launcher's detached strategy
 * starts it — over the repository, and capture what it prints. The input
 * crosses through the environment; the process's own standard output is the
 * root's alone, so the digest-last assertion reads exactly what the root
 * printed, with nothing after it.
 */
async function runRoot(
  repo: string,
  input: Parameters<typeof main>[0],
  env: Readonly<Record<string, string>>,
): Promise<{ exit: number; out: string[]; err: string[] }> {
  const driver = [
    `const root = await import(${JSON.stringify(pathToFileURL(MAIN_PATH).href)});`,
    `const input = JSON.parse(process.env.${INPUT_VARIABLE} ?? "{}");`,
    "process.exitCode = await root.main(input);",
  ].join(" ");
  const child = spawn(process.execPath, ["--input-type=module", "-e", driver], {
    cwd: repo,
    env: { ...env, [INPUT_VARIABLE]: JSON.stringify(input) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out: string[] = [];
  const err: string[] = [];
  child.stdout.on("data", (chunk) => out.push(String(chunk)));
  child.stderr.on("data", (chunk) => err.push(String(chunk)));
  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exit: code ?? -1,
        out: out
          .join("")
          .split("\n")
          .filter((one) => one !== ""),
        err: err
          .join("")
          .split("\n")
          .filter((one) => one !== ""),
      });
    });
  });
}

/** The run directory of one launch, as the layout resolves it. */
function runDirOf(repo: string): string {
  return join(repo, ".specstride", "state", "pipeline", "demo", "runs", "launch-test");
}

test("the root runs the stages, holds the lock, and ends on one digest line", async () => {
  const repo = makeRepo();
  const mark = join(repo, "mark.txt");
  const lease = join(repo, ".specstride", "lock", "lease.json");
  const bundle = writeBundle(repo, contractOf(repo, [engineStage(repo, probeScript(mark, lease))]));
  const env = launchEnvironment({
    SPECSTRIDE_LAUNCH_ID: "launch-test",
    SPECSTRIDE_LAUNCH_NONCE: "nonce-test",
    SPECSTRIDE_ENGINE: process.execPath,
  });
  try {
    const run = await runRoot(
      repo,
      {
        bundleLogicalName: bundle.logicalName,
        bundleHash: bundle.hash,
        mode: "run",
        args: ["--no-color"],
      },
      env,
    );
    assert.equal(run.exit, 0, run.err.join(""));

    // The digest line is the LAST line of the standard output.
    // The capture is already the root's lines, in order, and nothing else.
    const lines = run.out;
    const last = lines.at(-1) ?? "";
    assert.match(last, /^\[DIGEST\] state=completed exit=0 last-stage=run-demo /);
    assert.ok(last.endsWith(`evidence=${runDirOf(repo)}`), last);

    // The child of the stage: the pinned feature slug, the colour off, the
    // live output off — and the LEASE of the lock, read while the root held
    // it (handshake step 3: the lock lives as long as the root does).
    assert.equal(readFileSync(mark, "utf8"), "feature=demo lease=true noColor=1 liveOutput=off\n");

    // The state record ends completed; the events of the run hold the pair
    // `pipeline.started`/`pipeline.ended`; the pipeline log holds lines.
    const state = JSON.parse(readFileSync(join(runDirOf(repo), "state.json"), "utf8")) as {
      state: string;
      exit_reason: string;
    };
    assert.equal(state.state, "completed");
    assert.equal(state.exit_reason, "all-stages-complete");
    const events = readFileSync(join(runDirOf(repo), "events.jsonl"), "utf8")
      .split("\n")
      .filter((one) => one !== "")
      .map((one) => JSON.parse(one) as { name: string });
    assert.ok(events.some((one) => one.name === "pipeline.started"));
    assert.ok(events.some((one) => one.name === "pipeline.ended"));
    assert.ok(readFileSync(join(runDirOf(repo), "pipeline.log"), "utf8").length > 0);

    // The supervision record, addressed by the launch id the environment
    // names, at its logical place under the control root.
    const supervision = JSON.parse(
      readFileSync(
        join(repo, ".specstride", "launches", "launch-test", "supervision.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(supervision["pipeline"], "demo");
    assert.equal(supervision["launchId"], "launch-test");
    assert.equal(supervision["relaunchOwner"], "root");
    assert.equal(supervision["statePath"], join(runDirOf(repo), "state.json"));

    // The lock is released: every exit path after the acquire ends the hold.
    assert.equal(existsSync(join(repo, ".specstride", "lock")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a failed stage fails the run: exit 22, the digest names the failure", async () => {
  const repo = makeRepo();
  const bundle = writeBundle(repo, contractOf(repo, [engineStage(repo, "process.exit(1);")]));
  const env = launchEnvironment({
    SPECSTRIDE_LAUNCH_ID: "launch-test",
    SPECSTRIDE_LAUNCH_NONCE: "nonce-test",
    SPECSTRIDE_ENGINE: process.execPath,
  });
  try {
    const run = await runRoot(
      repo,
      {
        bundleLogicalName: bundle.logicalName,
        bundleHash: bundle.hash,
        mode: "run",
        args: ["--no-color"],
      },
      env,
    );
    assert.equal(run.exit, 22);
    // The capture is already the root's lines, in order, and nothing else.
    const lines = run.out;
    assert.match(lines.at(-1) ?? "", /^\[DIGEST\] state=failed exit=22 last-stage=run-demo /);
    assert.ok(lines.some((one) => one.startsWith("[FAIL] run-demo")));
    const state = JSON.parse(readFileSync(join(runDirOf(repo), "state.json"), "utf8")) as {
      state: string;
    };
    assert.equal(state.state, "failed");
    assert.equal(existsSync(join(repo, ".specstride", "lock")), false, "the lock is released");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a second root while one holds the lock refuses with the pipeline's 24", async () => {
  const repo = makeRepo();
  const bundle = writeBundle(repo, contractOf(repo, [engineStage(repo, "/* no-op */;")]));
  const place = { controlRoot: join(repo, ".specstride"), workspaceRealPath: repo };
  const lock = createDirectoryLock({ place });
  const acquired = await lock.acquireHere(
    buildOwnerRecord({ launchId: "launch-held", runTokenHash: "a".repeat(64) }),
    { runId: "run-held", launchId: "launch-held", launchNonce: "nonce-held" },
  );
  assert.equal(acquired.acquired, true, "the test holds the lock of the workspace");
  const env = launchEnvironment({
    SPECSTRIDE_LAUNCH_ID: "launch-test",
    SPECSTRIDE_LAUNCH_NONCE: "nonce-test",
    SPECSTRIDE_ENGINE: process.execPath,
  });
  try {
    const run = await runRoot(
      repo,
      {
        bundleLogicalName: bundle.logicalName,
        bundleHash: bundle.hash,
        mode: "run",
        args: ["--no-color"],
      },
      env,
    );
    assert.equal(run.exit, 24, `the pipeline code of a held lock (EP-13)`);
    // The capture is already the root's lines, in order, and nothing else.
    const lines = run.out;
    assert.ok(
      lines.some((one) => one.startsWith("[BLOCKED] another launcher owns")),
      lines.join("\n"),
    );
    assert.match(lines.at(-1) ?? "", /^\[DIGEST\] state=failed exit=24 /);
    // Nothing of the refused RUN was written: no state record, no supervision
    // record. The start-up checked the contract first, so its events and the
    // runtime log exist — and the lock still belongs to its holder: a root
    // that lost the lock never releases another run's.
    assert.equal(existsSync(join(runDirOf(repo), "state.json")), false);
    assert.equal(existsSync(join(repo, ".specstride", "launches")), false);
    assert.equal(existsSync(join(repo, ".specstride", "lock")), true);
  } finally {
    if (acquired.acquired) await lock.release(acquired.lease);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("the dry run of the launcher plans and writes nothing", async () => {
  const repo = makeRepo();
  const bundle = writeBundle(repo, contractOf(repo, [engineStage(repo, "process.exit(7);")]));
  const env = launchEnvironment({
    SPECSTRIDE_LAUNCH_ID: "launch-test",
    SPECSTRIDE_ENGINE: process.execPath,
  });
  try {
    const run = await runRoot(
      repo,
      {
        bundleLogicalName: bundle.logicalName,
        bundleHash: bundle.hash,
        mode: "dry-run",
        args: ["--no-color"],
      },
      env,
    );
    assert.equal(run.exit, 0);
    // The capture is already the root's lines, in order, and nothing else.
    const lines = run.out;
    assert.ok(lines.some((one) => one.startsWith("[DRY-RUN]")));
    assert.match(lines.at(-1) ?? "", /^\[DIGEST\] state=dry-run exit=0 /);
    // A dry run executes nothing and writes nothing of the run (§R.1): no
    // state record, no events, no supervision record, no lock. The runtime
    // log alone exists — every labelled line reaches it (§R.2).
    assert.equal(existsSync(join(runDirOf(repo), "state.json")), false);
    assert.equal(existsSync(join(runDirOf(repo), "events.jsonl")), false);
    assert.equal(existsSync(join(repo, ".specstride", "launches")), false);
    assert.equal(existsSync(join(repo, ".specstride", "lock")), false);
    assert.equal(existsSync(join(runDirOf(repo), "pipeline.log")), true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a contract the strict rules refuse never runs: exit 20, one [INVALID] line, one digest", async () => {
  const repo = makeRepo();
  // A shell command string: F107-FR-015 refuses it outright, and a launched
  // root must not run a contract validation refuses (F123-FR-004) — the
  // refusal reaches the start through the gateway's `invalid` port, after
  // the staleness verdict, before the lock.
  const stage = engineStage(repo, "/* no-op */");
  stage["action"] = ["bash", "-c", "echo made"];
  stage["resume"] = ["bash", "-c", "echo made"];
  const bundle = writeBundle(repo, contractOf(repo, [stage]));
  const env = launchEnvironment({
    SPECSTRIDE_LAUNCH_ID: "launch-test",
    SPECSTRIDE_LAUNCH_NONCE: "nonce-test",
    SPECSTRIDE_ENGINE: process.execPath,
  });
  try {
    const run = await runRoot(
      repo,
      {
        bundleLogicalName: bundle.logicalName,
        bundleHash: bundle.hash,
        mode: "run",
        args: ["--no-color"],
      },
      env,
    );
    assert.equal(run.exit, 20, run.out.join("\n"));
    // The refusal and the digest are both on standard error (§R.2).
    const invalid = run.err.filter((one) => one.startsWith("[INVALID]"));
    assert.equal(invalid.length, 1, [...run.out, ...run.err].join("\n"));
    assert.match(invalid[0] ?? "", /cannot execute a shell command string/);
    assert.match(
      run.err.at(-1) ?? "",
      /^\[DIGEST\] state=failed exit=20 last-stage=none evidence=none$/,
    );
    // Nothing of the refused run was written after the start-up: no stage
    // ran, so no state record and no lock.
    assert.equal(existsSync(join(runDirOf(repo), "state.json")), false);
    assert.equal(existsSync(join(repo, ".specstride", "lock")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
