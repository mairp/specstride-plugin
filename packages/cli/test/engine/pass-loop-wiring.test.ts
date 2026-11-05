/**
 * The pass loop wiring of the engine (step 1, part B): a phase attempt runs
 * through `runPassLoop`, evidence is checked BETWEEN passes, the real
 * supervision of feature 118 kills a pass over the time limit and renders the
 * kill note into the next pass's prompt, the loop's counters are written back
 * to the ledger (mismatch 4 of the wiring map), and an unknown
 * `betweenPasses` value of a dsh adapter can never stop the loop (mismatch 5).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runPassLoop } from "../../../core/src/pass-loop/loop.ts";
import {
  proposerLoopPort,
  readDshBetweenPasses,
  runFeature,
} from "../../src/engine/run-feature.ts";

/** The stub of `claude`, as `run-feature.test.ts` has it; what pass N does is the script the test writes. */
const STUB = (passScript: string): string => `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const argv = process.argv.slice(2);
const prompt = fs.readFileSync(0, "utf8");
const session = argv[argv.indexOf("--session-id") + 1];
const critic = argv.includes("--max-turns");
console.log(JSON.stringify({ type: "system", subtype: "init", tools: critic ? [] : ["Read"], session_id: session }));
if (critic) {
  fs.writeFileSync("seen-by-critic.txt", prompt);
  const nonce = /VERDICT ([0-9a-f]+): APPROVED/.exec(prompt)[1];
  console.log(JSON.stringify({ type: "result", result: "T001 judged.\\nVERDICT " + nonce + ": APPROVED" }));
} else {
  fs.appendFileSync("prompt-log.txt", prompt + "\\n---PASS---\\n");
  const passes = Number(fs.existsSync("pass-count.txt") ? fs.readFileSync("pass-count.txt", "utf8") : "0") + 1;
  fs.writeFileSync("pass-count.txt", String(passes));
  ${passScript}
}
`;

const WRITE_EVIDENCE = `const evidence = /write (\\.specstride\\S+?):/.exec(prompt)[1];
  fs.mkdirSync(path.dirname(evidence), { recursive: true });
  fs.writeFileSync(evidence, "T001 done\\n");
  fs.writeFileSync("made.txt", "work\\n");
  const tasks = "specs/001-one/tasks.md";
  fs.writeFileSync(tasks, fs.readFileSync(tasks, "utf8").replace("[ ]", "[x]"));
  console.log(JSON.stringify({ type: "result", result: "ok" }));`;

function fixture(passScript: string): { readonly dir: string; readonly restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "specstride-loop-"));
  const bin = join(dir, "bin");
  const work = join(dir, "work");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(work, "specs", "001-one"), { recursive: true });
  writeFileSync(join(bin, "claude"), STUB(passScript));
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

const withEnv = async (
  values: Record<string, string | undefined>,
  body: () => Promise<void>,
): Promise<void> => {
  const before = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    await body();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

const ledgerOf = (home: string, workdir: string): unknown =>
  JSON.parse(
    readFileSync(
      join(
        home,
        ".specstride",
        "workspaces",
        createHash("sha256").update(workdir).digest("hex").slice(0, 16),
        "features",
        "001-one",
        "ledger.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

test("the first pass writes no evidence, the second does: the phase is approved; the loop counters went back to the ledger (mismatch 4)", async () => {
  await withEnv({ SPECSTRIDE_PROPOSER_PAUSE_SEC: "0" }, async () => {
    const { dir, restore } = fixture(
      `if (passes < 2) { console.log(JSON.stringify({ type: "result", result: "thinking" })); } else { ${WRITE_EVIDENCE} }`,
    );
    try {
      assert.equal(await runFeature({ argv: [], workdir: dir }), 0);
      // Two passes ran; only the second saw the evidence.
      const log = readFileSync(join(dir, "prompt-log.txt"), "utf8");
      assert.equal(log.split("---PASS---").length - 1, 2);
      assert.match(readFileSync(join(dir, "specs", "001-one", "tasks.md"), "utf8"), /- \[x\] T001/);
      assert.equal(commits(dir), 2);
      // Mismatch 4 — the loop's counters came back to the ledger: the first
      // pass made no progress and no error, and the ledger carries that.
      const ledger = ledgerOf(process.env.HOME as string, dir);
      const phase = ledger["1"] as Record<string, unknown>;
      assert.deepEqual(phase.passLoop, { errorCount: 0, capCount: 0, noProgressCount: 0 });
    } finally {
      restore();
    }
  });
});

test("a pass hung over the time limit is killed by the supervision and the run continues with the kill note in the next prompt", async () => {
  await withEnv(
    {
      SPECSTRIDE_PROPOSER_PAUSE_SEC: "0",
      SPECSTRIDE_PROPOSER_TIMEOUT_SEC: "1",
      SPECSTRIDE_WATCHDOG_TICK_MS: "200",
      SPECSTRIDE_KILL_GRACE_MS: "500",
    },
    async () => {
      const { dir, restore } = fixture(
        `if (passes < 2) { setInterval(() => {}, 1000); } else { ${WRITE_EVIDENCE} }`,
      );
      try {
        assert.equal(await runFeature({ argv: [], workdir: dir }), 0);
        // Two passes: the first hung and was killed at the ceiling, the
        // second carried the phase over the gate.
        const log = readFileSync(join(dir, "prompt-log.txt"), "utf8");
        assert.equal(log.split("---PASS---").length - 1, 2);
        // The second prompt carries the kill note block (F118-FR-010).
        const secondPrompt = log.split("---PASS---")[1];
        assert.match(secondPrompt, /previous pass was terminated/i);
        assert.match(secondPrompt, /kill note/i);
        assert.match(secondPrompt, /hard_cap/);
        // The kill note and its sidecars lie in the control plane.
        const checkpoints = join(
          process.env.HOME as string,
          ".specstride",
          "workspaces",
          createHash("sha256").update(dir).digest("hex").slice(0, 16),
          "features",
          "001-one",
          "pass-checkpoints",
        );
        assert.ok(existsSync(checkpoints), "the kill note of the killed pass exists");
        // The note itself stays; its one-line sidecar entered the prompt and
        // left the control plane (F118-FR-026).
        const names = readdirSync(checkpoints);
        assert.ok(
          names.some((name) => name.endsWith(".md")),
          "the kill note is there",
        );
        assert.deepEqual(
          names.filter((name) => name.endsWith(".one-line")),
          [],
          "the one-line sidecar was removed once read",
        );
      } finally {
        restore();
      }
    },
  );
});

test("mismatch 5: an unknown betweenPasses value of a dsh adapter reads as continue, and cannot stop the loop", async () => {
  const port = proposerLoopPort;
  assert.equal(readDshBetweenPasses(undefined).outcome, "continue");
  assert.equal(readDshBetweenPasses(null).outcome, "continue");
  assert.equal(readDshBetweenPasses({ outcome: "stop", result: 5 }).outcome, "continue");
  assert.equal(readDshBetweenPasses({ outcome: "stop" }).outcome, "continue");
  // The port the engine composes answers `continue`, which the reader keeps.
  const outcome = await port.betweenPasses({} as never, undefined, "/tmp");
  assert.equal(readDshBetweenPasses(outcome).outcome, "continue");
  // And through the real loop: whatever the dsh adapter returns between the
  // passes, the loop runs on and ends at the evidence.
  for (const returned of [undefined, { outcome: "stop", result: 5 }, "continue"]) {
    let passes = 0;
    const result = await runPassLoop(
      {
        workdir: "/tmp",
        evidence: "/tmp/evidence.md",
        standingPrompt: "work",
        harness: "dsh",
        role: "proposer",
        passLimit: 5,
        pauseSec: 0,
        feature: "default",
        phase: 1,
        phaseAttempt: 1,
        debug: false,
        help: false,
      },
      {
        port: {
          startPass: port.startPass,
          betweenPasses: (async () => returned) as never,
        },
        evidenceExists: () => passes >= 2,
        runPass: async (pass) => {
          passes = pass;
          return {
            handle: { pid: 1, startTime: "", stream: (async function* () {})(), sessionId: "" },
            result: { exit_code: 0 },
            outcome: { path: "legacy" as const, madeProgress: true },
          };
        },
        now: () => "",
        pause: async () => undefined,
        print: () => undefined,
        emit: () => undefined,
      },
    );
    assert.equal(result.exit_code, 0, `the loop went on past ${JSON.stringify(returned)}`);
    assert.equal(passes, 2);
  }
});
