/**
 * `STOP` AGAINST A LIVE ENGINE (step 5, part B item 3, the reviewer ruling's
 * own demand: "Test with a live engine").
 *
 * WHAT HAPPENS. The REAL engine is started as a process over a real git
 * workspace with a one-phase feature, its implementer a stub `claude` on the
 * PATH that holds its pass in flight (the hostile-table fixture shape).
 * While that engine is running — a pass in flight, the run's event file
 * growing and NOT ended — the `stop` command is run against the control
 * root the engine is really writing, and the AS-IS FAILURE MUST NOT RECUR:
 * the command said `no run appears to be active … (lock is free)` and exited
 * 1 (reproduced in the par-4 drive). Now it says where the run stands open,
 * writes the request, and exits 0. The engine is then SIGKILLED — the cut
 * the requirement names (F143-SC-002) — and `stop` run again still finds the
 * run open in the records the cut left: no terminal event stands in the
 * event file, so the records say a run stands open, and the command says so.
 *
 * WHAT IS REAL. The engine module itself (`run-feature.ts`), the control
 * root derivation the front door shares with it
 * (`workspace-control-root.ts`), the supervision registry and the run's
 * event file it writes, the stop request the command writes into the inbox
 * the engine polls, and the reader the command reads. Nothing is simulated:
 * the liveness the command reports is the liveness of a process that is
 * running while it is reported.
 *
 * HOST SAFETY. The engine is a child of the caller, which always runs inside
 * the PID namespace of `tests/isolate.ts`; the stub `claude` ends itself when
 * its parent goes away, so the cut leaves nothing behind.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
import { realpathSync } from "node:fs";
import test from "node:test";

import {
  controlRootOfWorkspace,
  workspaceIdOfWorkspace,
} from "../../src/engine/workspace-control-root.ts";
import { theLiveRunOfTheEngineRecords } from "../../src/run-control/live-run-evidence.ts";
import { runStop } from "../../src/commands/stop.ts";

/** The stub `claude`: holds the pass in flight, and ends when its parent does. */
const HANGING_CLAUDE = `#!/bin/sh
# THE PASS, HELD IN FLIGHT: read the prompt from stdin, hold, and end when
# the parent goes away (a cut) or after a ceiling far beyond the test.
cat > /dev/null
at=0
while [ "$at" -lt 600 ]; do
  sleep 1
  at=$((at + 1))
  [ "$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ')" = "1" ] && exit 0
done
exit 0
`;

test(
  "`stop` says where the run of a LIVE engine stands open, writes the request, and exits 0 — before and after the engine is cut",
  { timeout: 240_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "stop-live-engine-"));
    const bin = join(dir, "bin");
    const home = join(dir, "home");
    const parallelHome = join(dir, "parallel-home");
    const work = join(dir, "work");
    mkdirSync(bin);
    mkdirSync(home);
    mkdirSync(parallelHome);
    mkdirSync(join(work, "specs", "001-one"), { recursive: true });
    writeFileSync(join(bin, "claude"), HANGING_CLAUDE);
    chmodSync(join(bin, "claude"), 0o755);
    writeFileSync(
      join(work, "specs", "001-one", "tasks.md"),
      "# Tasks\n\n## Phase 1: One\n\n- [ ] T001 Do it\n",
    );
    for (const argv of [
      ["init", "-q"],
      ["config", "user.email", "t@t"],
      ["config", "user.name", "t"],
    ]) {
      spawnSync("git", ["-C", work, ...argv]);
    }
    // The runner: the engine in this process, the exit code on the last line.
    writeFileSync(
      join(dir, "runner.mjs"),
      `const { runFeature } = await import(${JSON.stringify(
        join(import.meta.dirname, "..", "..", "src", "engine", "run-feature.ts"),
      )});\n` +
        `const code = await runFeature({ argv: [], workdir: process.env.TEST_WORKDIR });\n` +
        `console.log("ENGINE-EXIT " + String(code));\n`,
    );
    // The control root the ENGINE writes and the COMMAND reads: the one
    // derivation (`workspace-control-root.ts`), under the fixture's own home.
    const realWorkdir = realpathSync(work);
    const controlRoot = join(
      home,
      ".specstride",
      "workspaces",
      workspaceIdOfWorkspace(realWorkdir),
    );
    assert.equal(
      controlRootOfWorkspace(realWorkdir).endsWith(workspaceIdOfWorkspace(realWorkdir)),
      true,
    );

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      SPECSTRIDE_PARALLEL_HOME: parallelHome,
      // The pass stays in flight: a ceiling the test never reaches.
      SPECSTRIDE_PROPOSER_TIMEOUT_SEC: "600",
      SPECSTRIDE_WATCHDOG_TICK_MS: "1000",
      SPECSTRIDE_PROPOSER_PAUSE_SEC: "0",
      TEST_WORKDIR: realWorkdir,
    };
    const engine = spawn(process.execPath, [join(dir, "runner.mjs")], {
      cwd: realWorkdir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const engineOutput: string[] = [];
    engine.stdout.on("data", (chunk: Buffer) => engineOutput.push(chunk.toString()));
    engine.stderr.on("data", (chunk: Buffer) => engineOutput.push(chunk.toString()));

    const eventsFileOf = (): string | undefined => {
      const runs = join(controlRoot, "runs");
      try {
        const runId = readdirSync(runs).at(-1);
        const file = join(runs, runId ?? "", "events.jsonl");
        return existsSync(file) ? file : undefined;
      } catch {
        return undefined;
      }
    };

    try {
      // THE ENGINE COMES UP: wait until its own records name a run — the event
      // file the engine appends from its first boundary, or the registry entry
      // a pass in flight holds. Ninety seconds, then the run's output says
      // what the engine met.
      const deadline = Date.now() + 90_000;
      let eventsFile: string | undefined;
      while (Date.now() < deadline) {
        eventsFile = eventsFileOf();
        if (eventsFile !== undefined) break;
        if (engine.exitCode !== null || engine.signalCode !== null) break;
        await new Promise((done) => setTimeout(done, 400));
      }
      const engineSaid = engineOutput.join("");
      assert.ok(
        eventsFile !== undefined,
        `the engine left no run records in 90s; the engine said: ${engineSaid.slice(-2000)}`,
      );

      // THE LIVE RUN, AS THE RECORDS HOLD IT WHILE THE PROCESS RUNS.
      const reading = theLiveRunOfTheEngineRecords(controlRoot);
      assert.equal(reading.live, true, "the records of a running engine name no live run");

      // THE COMMAND, AGAINST THE LIVE ENGINE: the as-is failure must not recur.
      const live = runStop({
        controlRoot,
        workspaceRealPath: realWorkdir,
        workdir: realWorkdir,
      });
      assert.equal(live.exitCode, 0, "stop exited 1 against a live run");
      assert.equal(live.runAppearedActive, true);
      assert.equal(
        live.lines.filter((l) => l.stream === "stderr").length,
        0,
        "the as-is warnings are absent against a live run",
      );
      const stdout = live.lines.filter((l) => l.stream === "stdout").map((l) => l.text);
      assert.ok(
        stdout.some((text) => text.includes("a run stands open")),
        `no sentence names the open run: ${JSON.stringify(stdout)}`,
      );
      assert.equal(
        existsSync(live.requestPath),
        true,
        "the request stands for the engine to honour",
      );

      // THE CUT (F143-SC-002): the engine dies, its children with it.
      engine.kill("SIGKILL");
      await new Promise<void>((done) => {
        engine.once("exit", () => done());
        setTimeout(done, 30_000);
      });
      assert.equal(engine.signalCode, "SIGKILL", "the engine did not die by the cut");

      // THE RECORDS THE CUT LEFT: no terminal event stands in the event file,
      // so the run stands open in the records, and the command says so.
      assert.equal(
        readFileSync(eventsFile as string, "utf8").includes("run.ended"),
        false,
        "the cut run ended its own event file",
      );
      const after = runStop({
        controlRoot,
        workspaceRealPath: realWorkdir,
        workdir: realWorkdir,
      });
      assert.equal(after.exitCode, 0, "stop exited 1 against the records a cut left open");
      assert.equal(after.runAppearedActive, true);
      const afterStdout = after.lines.filter((l) => l.stream === "stdout").map((l) => l.text);
      assert.ok(
        afterStdout.some((text) => text.includes("a run stands open")),
        `no sentence after the cut: ${JSON.stringify(afterStdout)}`,
      );
    } finally {
      if (engine.exitCode === null && engine.signalCode === null) engine.kill("SIGKILL");
      rmSync(dir, { recursive: true, force: true });
      rmSync(parallelHome, { recursive: true, force: true });
    }
  },
);
