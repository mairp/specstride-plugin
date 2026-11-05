/**
 * THE MOUNT OF `specstride stop` (F143-FR-026 over F102-FR-001/-002/-010) —
 * the front-door half of the stop join. Before this build mounted a handler,
 * the verb was routed and guarded and then raised `VerbNotMountedError`:
 * the engine honoured a request nobody could write. Pinned here, over the
 * REAL router and the REAL home control plane:
 *
 *  - the routed verb reaches the handler (no `VerbNotMountedError`) and ends
 *    0 with the compatibility lines and the one product line;
 *  - the request lands at the path the ENGINE polls — the control root of
 *    `workspace-control-root.ts`, the same derivation run-feature.ts uses —
 *    so a live group reads what the command wrote;
 *  - `--now` reads the supervision registry the engine writes
 *    (`<controlRoot>/procs.json`) and ends a recorded, live, token-holding
 *    process after the identity check — and prints the not-running line for
 *    a recorded pid that is gone, and the flag-only line where no registry
 *    file stands. The identity check itself is signal-owned's, tested there;
 *    what is pinned here is that the entries reach it from the engine's own
 *    file.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  layoutVersion,
  resolve as resolveLogicalName,
  rootPathsOf,
} from "@specstride/contracts/ids/logical-names";
import { platformProcessTableIo, processGroupOf, startTimeOf } from "@specstride/kernel";
import { hashOfToken, RUN_TOKEN_VAR } from "../../src/run-control/signal-owned.ts";
import {
  controlRootOfWorkspace,
  workspaceIdOfWorkspace,
} from "../../src/engine/workspace-control-root.ts";
import { route } from "../../src/router/route.ts";

/** A captured io for the router. */
function captureIo(): { out: (t: string) => void; err: (t: string) => void; lines: string[] } {
  const lines: string[] = [];
  return {
    out: (t) => lines.push(t),
    err: (t) => lines.push(t),
    lines,
  };
}

/** A workspace with the state the router's guard and the command check. */
function aWorkspace(): { workdir: string; controlRoot: string; dispose: () => void } {
  const workdir = mkdtempSync(join(tmpdir(), "par4-stop-mount-"));
  mkdirSync(join(workdir, ".specstride"), { recursive: true });
  const controlRoot = controlRootOfWorkspace(workdir);
  // The state the layout table defines: a workspace record that reads back
  // (`workspace:record`, annex B §B.6). The engine of this build writes no
  // record yet — a gap recorded in the drive notes — so the tests stand one
  // to hold the command's own contract (exit 0 once state exists).
  mkdirSync(controlRoot, { recursive: true });
  writeFileSync(
    join(controlRoot, "workspace.json"),
    JSON.stringify({
      schema: "specstride.layout/1",
      layoutVersion,
      workspaceId: workspaceIdOfWorkspace(workdir),
      realPath: workdir,
      createdAt: new Date().toISOString(),
      productVersion: "test",
      lockProvider: { id: "test", version: "1" },
    }),
  );
  return {
    workdir,
    controlRoot,
    dispose: () => {
      rmSync(workdir, { recursive: true, force: true });
      rmSync(controlRoot, { recursive: true, force: true });
    },
  };
}

const home = homedir();

test("the routed verb stop reaches a handler and writes the request where the engine polls", async () => {
  const w = aWorkspace();
  try {
    const io = captureIo();
    const exit = await route(["stop", "-w", w.workdir], { io, handlers: {} });
    assert.equal(exit, 0);
    const request = join(w.controlRoot, "inbox", "stop.request");
    assert.equal(existsSync(request), true, "the request stands at the engine's control root");
    const printed = io.lines.join("");
    assert.match(printed, /stop requested → /);
    assert.match(printed, /the run finishes its current pass, then exits 6 \(clean stop\)\./);
    assert.match(printed, /\[SPECSTRIDE-STOP\]/);
    assert.ok(io.lines.some((l) => l.includes("SPECSTRIDE-STOP")));
  } finally {
    w.dispose();
  }
});

test("the mounted request path is byte for byte the path the engine resolves", async () => {
  const w = aWorkspace();
  try {
    // The engine's own resolution (run-feature.ts): home, the workspace id
    // from the workdir, the control root under the home directory.
    const enginePath = resolveLogicalName(
      "inbox:stop",
      {},
      rootPathsOf({
        home,
        workspaceRealPath: w.workdir,
        workspaceId: workspaceIdOfWorkspace(w.workdir),
        controlRoot: controlRootOfWorkspace(w.workdir),
        workerRoot: "",
      }),
    );
    const io = captureIo();
    const exit = await route(["stop", "-w", w.workdir], { io, handlers: {} });
    assert.equal(exit, 0);
    const written = io.lines.find((l) => l.startsWith("stop requested → "));
    assert.ok(written !== undefined, "the stop requested line was printed");
    assert.equal(written.replace("stop requested → ", "").trim(), enginePath);
    assert.equal(existsSync(enginePath), true);
  } finally {
    w.dispose();
  }
});

test("stop --now prints the flag-only line where the engine recorded no registry", async () => {
  const w = aWorkspace();
  try {
    const io = captureIo();
    const exit = await route(["stop", "--now", "-w", w.workdir], { io, handlers: {} });
    assert.equal(exit, 0);
    const printed = io.lines.join("");
    assert.match(printed, /no in-flight pass recorded \(.*\) — flag-only stop/);
    assert.match(printed, /\[SPECSTRIDE-STOP\].*now=true/);
  } finally {
    w.dispose();
  }
});

test("stop --now ends a recorded live token-holding process, and prints nothing killed for a dead pid", async () => {
  const w = aWorkspace();
  try {
    // A live stub the engine's own registry shape describes: its own session
    // leader (group = pid), holding the run token in its environment, with
    // the start time the platform reports.
    const child: ChildProcess = spawn("sleep", ["600"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, [RUN_TOKEN_VAR]: "the-run-token" },
    });
    const pid = child.pid as number;
    try {
      const startedAtMs = startTimeOf(pid, platformProcessTableIo);
      assert.ok(typeof startedAtMs === "number", "the stub's start time reads");
      const group = processGroupOf(pid) ?? pid;
      assert.equal(group, pid, "the detached stub leads its own group");
      const entry = {
        "run:the-run:pass-in-flight": {
          logicalName: "run:the-run:pass-in-flight",
          identity: {
            pid,
            groupId: group,
            sessionId: group,
            startedAtMs,
            runTokenHash: createHash("sha256").update("the-run-token", "utf8").digest("hex"),
          },
          registryClass: "pass",
          survivesStop: false,
        },
      };
      writeFileSync(join(w.controlRoot, "procs.json"), JSON.stringify(entry));
      const io = captureIo();
      const exit = await route(["stop", "--now", "-w", w.workdir], { io, handlers: {} });
      assert.equal(exit, 0);
      assert.match(
        io.lines.join(""),
        new RegExp(`killed in-flight agent pass \\(pid ${String(pid)} \\+ descendants\\)`),
      );
      // The recorded process ends; the check polls bounded, never spins.
      let alive = true;
      for (let at = 0; at < 40 && alive; at += 1) {
        try {
          process.kill(pid, 0);
        } catch {
          alive = false;
        }
        if (alive) await new Promise((wait) => setTimeout(wait, 50));
      }
      assert.equal(alive, false, "the recorded process was ended by the stop");
    } finally {
      if (typeof child.pid === "number") {
        try {
          process.kill(child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
  } finally {
    w.dispose();
  }
});

test("stop --now with a recorded dead pid prints the not-running line and sends nothing", async () => {
  const w = aWorkspace();
  try {
    // A pid that has gone: the start time the record holds cannot match a
    // live process, so the check answers not-running and no line of a kill
    // is printed.
    const gone = spawnSync("true", []);
    assert.equal(gone.status, 0);
    const pid = gone.pid as number;
    const entry = {
      "run:the-run:pass-in-flight": {
        logicalName: "run:the-run:pass-in-flight",
        identity: {
          pid,
          groupId: pid,
          sessionId: pid,
          startedAtMs: Date.now() - 5_000,
          runTokenHash: hashOfToken("no-such-token"),
        },
        registryClass: "pass",
        survivesStop: false,
      },
    };
    writeFileSync(join(w.controlRoot, "procs.json"), JSON.stringify(entry));
    const io = captureIo();
    const exit = await route(["stop", "--now", "-w", w.workdir], { io, handlers: {} });
    assert.equal(exit, 0);
    assert.match(
      io.lines.join(""),
      new RegExp(`recorded pass \\(pid ${String(pid)}\\) is not running — nothing to kill`),
    );
  } finally {
    w.dispose();
  }
});

test("the engine's control root and the command's agree for one workdir", () => {
  // The seam the drive leans on: the engine derives its control root from
  // the workdir; the command derives the same; one id, one root, one inbox.
  const workdir = mkdtempSync(join(tmpdir(), "par4-stop-root-"));
  try {
    assert.equal(controlRootOfWorkspace(workdir), controlRootOfWorkspace(workdir));
    assert.equal(
      workspaceIdOfWorkspace(workdir),
      createHash("sha256").update(workdir).digest("hex").slice(0, 16),
    );
    assert.equal(
      controlRootOfWorkspace(workdir),
      join(home, ".specstride", "workspaces", workspaceIdOfWorkspace(workdir)),
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});
