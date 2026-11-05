/**
 * T038 — CT-122-4 to CT-122-9: the handshake (F122-FR-004 to F122-FR-009,
 * F122-SC-007; annex F §F.3; `specs/122-detached-runtime/contracts/cli-state-commands.md`).
 *
 * The subject is `packages/cli/src/commands/launch-handshake.ts` (steps 1, 2
 * and 4) together with `packages/runtime/src/root/start.ts` (step 3). The two
 * are driven through each other here, because that is the only way the
 * handshake can be observed at all: the CLI waits for a FILE the root writes,
 * and either half alone proves nothing about the other.
 *
 * Every assertion below reads the disk. The return value of a function is never
 * taken as evidence that it wrote what it said it wrote.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { STRATEGY_WITHOUT_DETACHING } from "@specstride/contracts/ep/detach";
import type { DetachStrategy, StartInput, StartedProcess } from "@specstride/contracts/ep/detach";
import { deriveLaunchAbandoned } from "@specstride/contracts/state/handshake";
import {
  HANDSHAKE_LIMIT_SECONDS,
  HANDSHAKE_STEPS,
  LAUNCH_ABANDONED,
  OutcomeAlreadyWrittenError,
  abandonedLaunchesOf,
  launchRecordPathOf,
  leasePathOf,
  readLeaseAt,
  readTheLaunchRecord,
  runLaunchHandshake,
  writeTheLaunchRecord,
  type HandshakePlace,
  type LaunchHandshakeOutcome,
} from "../../../cli/src/commands/launch-handshake.ts";
import { buildOwnerRecord } from "../../src/lock/owner-record.ts";
import { GRACE_SECONDS, writeTheLease } from "../../src/lease/lease.ts";
import { mintRunToken } from "../../src/procs/run-token.ts";
import { endTheRoot } from "../../src/root/end.ts";
import { startTheRoot, type RootPlace } from "../../src/root/start.ts";

/* ------------------------------------------------------------------ *
 * One hermetic workspace per case.
 * ------------------------------------------------------------------ */

const SLUG = "122-detached-runtime";
const RUN = "run-handshake";

/** The module under test, by path, for the case that runs it in its own process. */
const HANDSHAKE_MODULE = new URL("../../../cli/src/commands/launch-handshake.ts", import.meta.url)
  .href;

type Scratch = {
  readonly place: HandshakePlace;
  readonly where: RootPlace;
  readonly runtimeDirectory: string;
  dispose(): void;
};

function scratch(label: string): Scratch {
  const controlRoot = mkdtempSync(join(tmpdir(), `hs-${label}-c-`));
  const workspaceRealPath = mkdtempSync(join(tmpdir(), `hs-${label}-w-`));
  const runtimeDirectory = mkdtempSync(join(tmpdir(), `hs-${label}-r-`));
  const place = { controlRoot, workspaceRealPath };
  return {
    place,
    where: { place, slug: SLUG, runId: RUN },
    runtimeDirectory,
    dispose(): void {
      for (const path of [controlRoot, workspaceRealPath, runtimeDirectory]) {
        rmSync(path, { recursive: true, force: true });
      }
    },
  };
}

/** The pieces every launch of these cases brings. */
function launchOf(
  scratchOf: Scratch,
  strategy: DetachStrategy,
  over: {
    readonly launchId: string;
    readonly launchNonce: string;
    readonly requestKind?: string;
    readonly handshakeLimitSeconds?: number;
    readonly printed?: string[];
    readonly profile?: string;
  },
): Parameters<typeof runLaunchHandshake>[0] {
  const printed = over.printed ?? [];
  return {
    place: scratchOf.place,
    slug: SLUG,
    launchId: over.launchId,
    runId: RUN,
    workspaceId: "ws-handshake",
    requestKind: over.requestKind ?? "pipeline",
    request: { pipelineId: "p-1", bundleHash: "sha256:abc" },
    engineExecutable: { path: process.execPath, hash: "sha256:engine" },
    strategy,
    runtimeEntry: [process.execPath, "--runtime-root"],
    environmentAllowList: ["PATH", "LC_ALL"],
    runtimeLogLogicalName: "launch:<launchId>:runtime-log",
    launchNonce: over.launchNonce,
    handshakeLimitSeconds: over.handshakeLimitSeconds ?? 5,
    ...(over.profile === undefined ? {} : { profile: over.profile }),
    print: (line: string): void => void printed.push(line),
  };
}

/** What step 3 took, for a case that must give it back. */
type Held = Parameters<typeof endTheRoot>[0];

/** A strategy that records what happened when `start` was called. */
function spyStrategy(
  id: string,
  onStart: (input: StartInput) => void | Promise<void>,
  options: { readonly available?: boolean } = {},
): DetachStrategy & { readonly calls: StartInput[] } {
  const calls: StartInput[] = [];
  return Object.freeze({
    available: () => ({
      available: options.available ?? true,
      reason:
        (options.available ?? true)
          ? `the spy strategy \`${id}\` is available`
          : `unavailable: run with the strategy \`${STRATEGY_WITHOUT_DETACHING}\``,
    }),
    async start(input: StartInput): Promise<StartedProcess> {
      calls.push(input);
      await onStart(input);
      return { pid: process.pid, startTime: new Date().toISOString(), sessionLeader: true };
    },
    describe: () => ({
      id,
      survives: { endOfTheParent: true, endOfTheHostSession: true, reboot: false },
    }),
    calls,
  });
}

/** Take the whole step 3, in this process, and give everything back after. */
async function withTheRootStarted(
  scratchOf: Scratch,
  launchId: string,
  launchNonce: string,
  body: () => Promise<void>,
): Promise<void> {
  const token = mintRunToken();
  const started = await startTheRoot({
    where: scratchOf.where,
    launchId,
    launchNonce,
    owner: buildOwnerRecord({ launchId, runTokenHash: token.hash }),
  });
  assert.equal(started.started, true, "step 3 took the lock and wrote the lease");
  if (!started.started) return;
  try {
    await body();
  } finally {
    await endTheRoot(
      {
        where: scratchOf.where,
        launchId,
        provider: started.provider,
        lease: started.lease,
        heartbeat: started.heartbeat,
      },
      "completed",
    );
  }
}

/* ------------------------------------------------------------------ *
 * CT-122-4 — the launch record exists before the strategy is called.
 * ------------------------------------------------------------------ */

test("CT-122-4: the launch record exists on disk before the detach strategy is called, and carries the nonce the lease must bear (F122-FR-004)", async () => {
  const s = scratch("ct4");
  try {
    const seen: { exists: boolean; nonce: string | null; outcome: unknown } = {
      exists: false,
      nonce: null,
      outcome: "not read",
    };
    // The strategy reads the disk AT THE MOMENT it is called. Nothing else can
    // tell "before" from "after" — an assertion afterwards would pass for a
    // record written in either order.
    const strategy = spyStrategy("spy-ct4", () => {
      const path = launchRecordPathOf(s.place, "launch-ct4");
      seen.exists = existsSync(path);
      const record = readTheLaunchRecord(path);
      seen.nonce = record === null ? null : String(record.launchNonce);
      seen.outcome = record?.outcome ?? null;
    });
    const outcome = await runLaunchHandshake(
      launchOf(s, strategy, {
        launchId: "launch-ct4",
        launchNonce: "nonce-ct4",
        handshakeLimitSeconds: 0,
      }),
    );

    assert.equal(seen.exists, true, "the record was on disk when the strategy was called");
    assert.equal(seen.nonce, "nonce-ct4", "and it carried this launch's nonce");
    assert.equal(seen.outcome, null, "and it carried no outcome yet");
    assert.equal(strategy.calls.length, 1, "the strategy was called exactly once");
    // The order of the steps, as the module recorded them.
    assert.deepEqual([...outcome.steps], [1, 2, 4]);
    assert.deepEqual(
      HANDSHAKE_STEPS.filter((step) => step.actor === "CLI").map((step) => step.step),
      [1, 2, 4],
      "steps 1, 2 and 4 are the CLI's; step 3 is the runtime root's (§F.3)",
    );
    // F122-FR-004 — written to a temporary name and renamed: no temporary name
    // is left beside the record.
    const directory = launchRecordPathOf(s.place, "launch-ct4").replace(/\/[^/]+$/, "");
    assert.deepEqual(
      (await import("node:fs")).readdirSync(directory).filter((n) => n !== "launch.json"),
      [],
      "the atomic write left nothing beside the record",
    );
  } finally {
    s.dispose();
  }
});

/* ------------------------------------------------------------------ *
 * CT-122-5 — `started`, exit 0.
 * ------------------------------------------------------------------ */

test("CT-122-5: a lease that carries this launch's nonce gives the outcome `started`, exit 0 and one line `[SPECSTRIDE-LAUNCH]` (F122-FR-005)", async () => {
  const s = scratch("ct5");
  // Step 3 happens for real, in this process, so the resources it takes must be
  // given back whatever the assertions do.
  let held: Held | null = null;
  try {
    const printed: string[] = [];
    const strategy = spyStrategy("spy-ct5", async (input) => {
      const token = mintRunToken();
      const started = await startTheRoot({
        where: s.where,
        launchId: "launch-ct5",
        launchNonce: input.launchNonce,
        owner: buildOwnerRecord({ launchId: "launch-ct5", runTokenHash: token.hash }),
      });
      assert.equal(started.started, true, "step 3 took the lock and wrote the lease");
      if (started.started) {
        held = {
          where: s.where,
          launchId: "launch-ct5",
          provider: started.provider,
          lease: started.lease,
          heartbeat: started.heartbeat,
        };
      }
    });

    const outcome = await runLaunchHandshake(
      launchOf(s, strategy, {
        launchId: "launch-ct5",
        launchNonce: "nonce-ct5",
        printed,
      }),
    );

    assert.equal(outcome.outcome, "started");
    assert.equal(outcome.exit, 0, "`started` exits 0 (§F.3)");
    assert.deepEqual(printed, [`[SPECSTRIDE-LAUNCH] run=${RUN} state=running`]);

    // Read back off the disk: the record carries the one outcome.
    const record = readTheLaunchRecord(launchRecordPathOf(s.place, "launch-ct5"));
    assert.equal(record?.outcome, "started");
    assert.equal(record?.refusal, undefined);

    // And the lease the wait found is the one the root wrote, with the nonce.
    const lease = readLeaseAt(leasePathOf({ place: s.place, slug: SLUG, runId: RUN }));
    assert.notEqual(lease, null);
    assert.equal(String(lease?.launchNonce), "nonce-ct5");
    assert.equal(String(lease?.launchId), "launch-ct5");

    // Under the `parity` profile the same launch prints NOTHING (F122-FR-005).
    const quiet: string[] = [];
    const second = await runLaunchHandshake(
      launchOf(
        s,
        spyStrategy("spy-ct5-quiet", () => {}),
        {
          launchId: "launch-ct5-quiet",
          launchNonce: "nonce-ct5",
          printed: quiet,
          profile: "parity",
        },
      ),
    );
    assert.equal(second.outcome, "started", "the same nonce is still this launch's lease");
    assert.deepEqual(quiet, [], "under the `parity` profile neither line is printed");
    assert.equal(second.line, "");
  } finally {
    if (held !== null) await endTheRoot(held, "completed");
    s.dispose();
  }
});

/* ------------------------------------------------------------------ *
 * CT-122-6 — a strategy failure, and a missing lease.
 * ------------------------------------------------------------------ */

test("CT-122-6: a strategy that is unavailable, one that throws, and a lease that never appears each give `refused`, exit 4, and a line that names `foreground` (F122-FR-005)", async () => {
  for (const kind of ["unavailable", "throws", "no-lease"] as const) {
    const s = scratch(`ct6-${kind}`);
    try {
      const printed: string[] = [];
      const strategy =
        kind === "unavailable"
          ? spyStrategy("spy-ct6", () => {}, { available: false })
          : kind === "throws"
            ? spyStrategy("spy-ct6", () => {
                throw new Error("the platform refused to start the root");
              })
            : // Starts "successfully" and writes no lease at all.
              spyStrategy("spy-ct6", () => {});

      const outcome = await runLaunchHandshake(
        launchOf(s, strategy, {
          launchId: `launch-ct6-${kind}`,
          launchNonce: `nonce-ct6-${kind}`,
          handshakeLimitSeconds: 0,
          printed,
        }),
      );

      assert.equal(outcome.outcome, "refused", `${kind}: the outcome is \`refused\``);
      assert.equal(outcome.exit, 4, `${kind}: a refused launch exits 4`);
      assert.equal(
        outcome.refusal,
        kind === "no-lease" ? "detach-not-ready" : "detach-unavailable",
        `${kind}: the refusal is a member of the closed set 212`,
      );
      assert.equal(printed.length, 1, `${kind}: exactly one line`);
      assert.match(
        printed[0] ?? "",
        /^\[SPECSTRIDE-REFUSE\] action=launch reason=detach-(unavailable|not-ready) next=/,
        `${kind}: the line is \`[SPECSTRIDE-REFUSE]\` with action, reason and next`,
      );
      // F122-FR-005 — *the message MUST name the strategy `foreground`*.
      assert.match(printed[0] ?? "", /foreground/, `${kind}: the line names \`foreground\``);
      assert.equal(STRATEGY_WITHOUT_DETACHING, "foreground");

      // The refusal is in the record, read back off the disk.
      const record = readTheLaunchRecord(launchRecordPathOf(s.place, `launch-ct6-${kind}`));
      assert.equal(record?.outcome, "refused");
      assert.equal(
        record?.refusal,
        kind === "no-lease" ? "detach-not-ready" : "detach-unavailable",
      );

      // And nothing of the run was written: no lease, no lock.
      assert.equal(
        existsSync(leasePathOf({ place: s.place, slug: SLUG, runId: RUN })),
        false,
        `${kind}: a refused launch left no lease`,
      );
    } finally {
      s.dispose();
    }
  }
});

test("CT-122-6: a lease of ANOTHER launch whose `validUntil` has passed is not a live run, so the launch is refused and never `attached` (F122-FR-006)", async () => {
  const s = scratch("ct6-stale");
  try {
    const printed: string[] = [];
    // A lease of another launch, written long enough ago that its grace has
    // passed. F122-FR-006 makes `attached` the outcome for a lease *of a LIVE
    // run*; this one is the trace of a run that stopped reporting, and attaching
    // to it would tell the consumer a dead run lives.
    const longAgo = new Date(Date.now() - (GRACE_SECONDS + 600) * 1_000);
    writeTheLease({
      where: s.where,
      launchId: "launch-ct6-stale-other",
      launchNonce: "nonce-of-another-launch",
      owner: buildOwnerRecord({
        launchId: "launch-ct6-stale-other",
        runTokenHash: "stale-token",
      }),
      leaseTokenHash: "stale-lease",
      now: () => longAgo,
    });
    const stale = readLeaseAt(leasePathOf({ place: s.place, slug: SLUG, runId: RUN }));
    assert.notEqual(stale, null, "the stale lease is on disk");
    assert.equal(
      Date.parse(String(stale?.validUntil)) < Date.now(),
      true,
      "and its `validUntil` has passed",
    );

    const outcome = await runLaunchHandshake(
      launchOf(
        s,
        spyStrategy("spy-ct6-stale", () => {}),
        {
          launchId: "launch-ct6-stale",
          launchNonce: "nonce-ct6-stale",
          handshakeLimitSeconds: 0,
          printed,
        },
      ),
    );
    assert.equal(outcome.outcome, "refused", "a stale lease is not a live run to attach to");
    assert.equal(outcome.refusal, "detach-not-ready");
    assert.equal(outcome.exit, 4);
    assert.match(printed[0] ?? "", /^\[SPECSTRIDE-REFUSE\] action=launch reason=detach-not-ready /);
    assert.match(printed[0] ?? "", /foreground/);

    // And a lease of another launch that IS live gives `attached`, so the
    // difference is `validUntil` and nothing else.
    const printedLive: string[] = [];
    writeTheLease({
      where: s.where,
      launchId: "launch-ct6-live-other",
      launchNonce: "nonce-of-a-live-launch",
      owner: buildOwnerRecord({ launchId: "launch-ct6-live-other", runTokenHash: "live-token" }),
      leaseTokenHash: "live-lease",
    });
    const second = await runLaunchHandshake(
      launchOf(
        s,
        spyStrategy("spy-ct6-live", () => {}),
        {
          launchId: "launch-ct6-live",
          launchNonce: "nonce-ct6-live",
          handshakeLimitSeconds: 0,
          printed: printedLive,
        },
      ),
    );
    assert.equal(second.outcome, "attached");
    assert.equal(second.exit, 4);
    assert.equal(String(second.lease?.launchNonce), "nonce-of-a-live-launch");
  } finally {
    s.dispose();
  }
});

test("CT-122-5: a launch ALWAYS ends: run in a process of its own, whose only pending work is the bounded wait, it prints one line and exits with the code of §F.3 (F122-SC-007)", () => {
  const s = scratch("ct5-process");
  try {
    // This is the case no in-process test can reach. `node:test` holds the event
    // loop of this process open, so a wait whose timer does not hold it open
    // still settles here. In a real `launch` the wait IS the only pending work:
    // an unreferenced timer would leave the loop empty, the platform would
    // resolve it, and the launch would exit without printing a line and without
    // writing an outcome. F122-SC-007 forbids exactly that, so the case runs the
    // handshake in a process of its own and reads its standard output and its
    // exit code.
    const entry = join(s.runtimeDirectory, "one-launch.mjs");
    writeFileSync(
      entry,
      [
        `const { runLaunchHandshake } = await import(${JSON.stringify(HANDSHAKE_MODULE)});`,
        `const strategy = {`,
        `  available: () => ({ available: true, reason: "the strategy of this case starts nothing" }),`,
        `  start: () => Promise.resolve({ pid: 2, startTime: new Date().toISOString(), sessionLeader: true }),`,
        `  describe: () => ({ id: "starts-nothing", survives: { endOfTheParent: true, endOfTheHostSession: true, reboot: false } }),`,
        `};`,
        `const outcome = await runLaunchHandshake({`,
        `  place: ${JSON.stringify(s.place)},`,
        `  slug: ${JSON.stringify(SLUG)},`,
        `  launchId: "launch-in-its-own-process",`,
        `  runId: ${JSON.stringify(RUN)},`,
        `  workspaceId: "ws-own-process",`,
        `  requestKind: "pipeline",`,
        `  request: { pipelineId: "p", bundleHash: "sha256:b" },`,
        `  engineExecutable: { path: process.execPath, hash: "sha256:e" },`,
        `  strategy,`,
        `  runtimeEntry: [process.execPath, "--runtime-root"],`,
        `  environmentAllowList: ["PATH"],`,
        `  runtimeLogLogicalName: "launch:<launchId>:runtime-log",`,
        `  launchNonce: "nonce-own-process",`,
        `  handshakeLimitSeconds: 1,`,
        `});`,
        `process.exit(outcome.exit);`,
      ].join("\n"),
    );
    const ran = spawnSync(process.execPath, [entry], { encoding: "utf8" });
    // One line, the refusal, and the exit code of §F.3 — from a real process.
    assert.equal(
      ran.status,
      4,
      `the launch exited 4 and not ${String(ran.status)} (stderr: ${String(ran.stderr).slice(0, 400)})`,
    );
    const lines = String(ran.stdout)
      .split("\n")
      .filter((line) => line.trim() !== "");
    assert.equal(lines.length, 1, `exactly one line was printed, not ${JSON.stringify(lines)}`);
    assert.match(
      lines[0] ?? "",
      /^\[SPECSTRIDE-REFUSE\] action=launch reason=detach-not-ready next=/,
      "and it is the refusal of §G.3",
    );
    // And the outcome reached the record, which is what F122-SC-007 counts.
    const record = readTheLaunchRecord(launchRecordPathOf(s.place, "launch-in-its-own-process"));
    assert.equal(record?.outcome, "refused");
    assert.equal(record?.refusal, "detach-not-ready");
  } finally {
    s.dispose();
  }
});

/* ------------------------------------------------------------------ *
 * CT-122-7 — two racing launches.
 * ------------------------------------------------------------------ */

test("CT-122-7: two launches of one workspace end with exactly one `started` and one `attached`, and the `attached` one prints the run that lives and exits 4 (F122-FR-006)", async () => {
  const s = scratch("ct7");
  try {
    const outcomes: LaunchHandshakeOutcome[] = [];
    const printedA: string[] = [];
    const printedB: string[] = [];

    await withTheRootStarted(s, "launch-ct7-a", "nonce-ct7-a", async () => {
      // Launch A: its root already holds the lock and wrote the lease.
      outcomes.push(
        await runLaunchHandshake(
          launchOf(
            s,
            spyStrategy("spy-ct7-a", () => {}),
            {
              launchId: "launch-ct7-a",
              launchNonce: "nonce-ct7-a",
              printed: printedA,
            },
          ),
        ),
      );
      // Launch B: a different launch, a different nonce, the same workspace.
      // Its own root would lose the lock, so it never writes a lease.
      outcomes.push(
        await runLaunchHandshake(
          launchOf(
            s,
            spyStrategy("spy-ct7-b", () => {}),
            {
              launchId: "launch-ct7-b",
              launchNonce: "nonce-ct7-b",
              printed: printedB,
            },
          ),
        ),
      );
    });

    const kinds = outcomes.map((one) => one.outcome).sort();
    assert.deepEqual(kinds, ["attached", "started"], "exactly one of each");
    const started = outcomes.find((one) => one.outcome === "started");
    const attached = outcomes.find((one) => one.outcome === "attached");
    assert.equal(started?.exit, 0);
    assert.equal(attached?.exit, 4, "`attached` exits 4 (§F.3)");
    assert.equal(attached?.refusal, undefined, "`attached` is no refusal");

    // F122-FR-006 — it prints the run THAT LIVES, with the launch line and not
    // a refusal.
    assert.deepEqual(printedB, [`[SPECSTRIDE-LAUNCH] run=${RUN} state=running`]);
    assert.equal(
      String(attached?.lease?.launchNonce),
      "nonce-ct7-a",
      "the lease it attached to is the LIVE run's, not its own",
    );

    // Both records carry their own single outcome, read off the disk.
    assert.equal(
      readTheLaunchRecord(launchRecordPathOf(s.place, "launch-ct7-a"))?.outcome,
      "started",
    );
    assert.equal(
      readTheLaunchRecord(launchRecordPathOf(s.place, "launch-ct7-b"))?.outcome,
      "attached",
    );
  } finally {
    s.dispose();
  }
});

/* ------------------------------------------------------------------ *
 * CT-122-8 — `launch-abandoned`: derived, then closed by the next launch.
 * ------------------------------------------------------------------ */

test("CT-122-8: a launch record with no outcome older than the handshake limit is DERIVED as `launch-abandoned` and then closed by the next launch with the outcome `refused` (F122-FR-007, F122-SC-007)", async () => {
  const s = scratch("ct8");
  try {
    // A launch that was never answered: no outcome, no lease, and older than
    // the handshake limit.
    const long_ago = new Date(Date.now() - (HANDSHAKE_LIMIT_SECONDS + 60) * 1_000);
    writeTheLaunchRecord({
      place: s.place,
      launchId: "launch-ct8-old",
      runId: RUN,
      workspaceId: "ws-handshake",
      requestKind: "pipeline",
      request: { pipelineId: "p-old", bundleHash: "sha256:old" },
      detachStrategy: "spawn-detached",
      launchNonce: "nonce-ct8-old",
      engineExecutable: { path: process.execPath, hash: "sha256:engine" },
      now: () => long_ago,
    });

    // 1 — it is DERIVED, by the derivation of feature 100 and by this module's
    // reader over the whole workspace. No process wrote the word anywhere.
    const onDisk = readTheLaunchRecord(launchRecordPathOf(s.place, "launch-ct8-old"));
    assert.notEqual(onDisk, null);
    assert.equal(onDisk?.outcome, undefined, "the record carries no outcome");
    assert.equal(
      readFileSync(launchRecordPathOf(s.place, "launch-ct8-old"), "utf8").includes(
        LAUNCH_ABANDONED,
      ),
      false,
      "`launch-abandoned` is nowhere in the record: it is derived, never written as a state",
    );
    assert.equal(
      deriveLaunchAbandoned({
        record: onDisk as never,
        now: new Date(),
        handshakeLimitSeconds: HANDSHAKE_LIMIT_SECONDS,
      }),
      LAUNCH_ABANDONED,
    );
    assert.deepEqual(
      abandonedLaunchesOf({ place: s.place, slug: SLUG }).map((one) => one.launchId),
      ["launch-ct8-old"],
    );

    // 2 — the NEXT launch closes it.
    const outcome = await runLaunchHandshake(
      launchOf(
        s,
        spyStrategy("spy-ct8", () => {}),
        {
          launchId: "launch-ct8-new",
          launchNonce: "nonce-ct8-new",
          handshakeLimitSeconds: 0,
        },
      ),
    );
    assert.deepEqual([...outcome.closedAsAbandoned], ["launch-ct8-old"]);

    const closed = readTheLaunchRecord(launchRecordPathOf(s.place, "launch-ct8-old"));
    assert.equal(closed?.outcome, "refused", "the abandoned record now carries `refused`");
    assert.equal(closed?.refusal, LAUNCH_ABANDONED, "with the refusal `launch-abandoned`");

    // F122-SC-007 — no launch record stays without an outcome after the next
    // launch. Read over every record of the workspace, off the disk.
    for (const launchId of ["launch-ct8-old", "launch-ct8-new"]) {
      const record = readTheLaunchRecord(launchRecordPathOf(s.place, launchId));
      assert.notEqual(record?.outcome, undefined, `${launchId} carries an outcome`);
    }
  } finally {
    s.dispose();
  }
});

test("CT-122-8: an outcome is written exactly once; a second write is refused (F122-SC-007)", async () => {
  const s = scratch("ct8b");
  try {
    await runLaunchHandshake(
      launchOf(
        s,
        spyStrategy("spy-ct8b", () => {}),
        {
          launchId: "launch-ct8b",
          launchNonce: "nonce-ct8b",
          handshakeLimitSeconds: 0,
        },
      ),
    );
    const { writeTheOutcome } = await import("../../../cli/src/commands/launch-handshake.ts");
    assert.throws(
      () =>
        writeTheOutcome({
          place: s.place,
          launchId: "launch-ct8b",
          outcome: "started",
        }),
      OutcomeAlreadyWrittenError,
    );
  } finally {
    s.dispose();
  }
});

/* ------------------------------------------------------------------ *
 * CT-122-9 — no reader opens a channel; `run --detach` uses the same path.
 * ------------------------------------------------------------------ */

test("CT-122-9: readiness is confirmed by a FILE and no channel is opened: a lease written by a process that has since exited still gives `started` (F122-FR-008)", async () => {
  const s = scratch("ct9a");
  try {
    const printed: string[] = [];
    // The lease is written by a SEPARATE process which then ENDS. Nothing of it
    // is left to connect to: no pipe, no socket the CLI holds, no parent that
    // waits. If the handshake needed a channel to a living root, this case
    // could not pass at all.
    const strategy = spyStrategy("spy-ct9", () => {
      const leaseFile = leasePathOf({ place: s.place, slug: SLUG, runId: RUN });
      const writer = join(s.runtimeDirectory, "write-lease.mjs");
      writeFileSync(
        writer,
        [
          `import { mkdirSync, writeFileSync, renameSync } from "node:fs";`,
          `import { dirname } from "node:path";`,
          `const path = process.argv[2];`,
          `mkdirSync(dirname(path), { recursive: true, mode: 0o700 });`,
          `const at = new Date();`,
          `const lease = {`,
          `  schema: "specstride.lease/1", runId: ${JSON.stringify(RUN)},`,
          `  launchId: "launch-ct9", launchNonce: "nonce-ct9",`,
          `  owner: { pid: process.pid, processGroup: process.pid, startTime: at.toISOString(),`,
          `    bootId: "b", hostName: "h", pidNamespace: null, launchId: "launch-ct9",`,
          `    runTokenHash: "rth" },`,
          `  lockProvider: "specstride.directory-lock/1",`,
          `  heartbeatAt: at.toISOString(), heartbeatEverySeconds: 10,`,
          `  validUntil: new Date(at.getTime() + 300000).toISOString(),`,
          `  leaseTokenHash: "lth" };`,
          `writeFileSync(path + ".writing", JSON.stringify(lease, null, 2) + "\\n", { mode: 0o600 });`,
          `renameSync(path + ".writing", path);`,
        ].join("\n"),
      );
      const ran = spawnSync(process.execPath, [writer, leaseFile], { stdio: "ignore" });
      assert.equal(ran.status, 0, "the writer process wrote the lease and exited");
    });

    const outcome = await runLaunchHandshake(
      launchOf(s, strategy, {
        launchId: "launch-ct9",
        launchNonce: "nonce-ct9",
        printed,
      }),
    );

    assert.equal(outcome.outcome, "started");
    assert.equal(outcome.exit, 0);
    assert.equal(
      outcome.openedAChannel,
      false,
      "F122-FR-008 — no operation of this feature opens a channel to a living runtime root",
    );
    // The owner of the lease is a process that no longer exists, and the
    // handshake neither noticed nor needed it.
    const lease = readLeaseAt(leasePathOf({ place: s.place, slug: SLUG, runId: RUN }));
    const pid = Number((lease?.owner as Record<string, unknown>).pid);
    let there = true;
    try {
      process.kill(pid, 0);
    } catch {
      there = false;
    }
    assert.equal(there, false, "the process that wrote the lease is gone");
  } finally {
    s.dispose();
  }
});

test("CT-122-9: `run --detach` is a run request of kind `engine` and takes the same path as one of kind `pipeline`; any other kind refuses the launch (F122-FR-009)", async () => {
  const both: Record<string, LaunchHandshakeOutcome> = {};
  for (const kind of ["pipeline", "engine"] as const) {
    const s = scratch(`ct9-${kind}`);
    let held: Held | null = null;
    try {
      const printed: string[] = [];
      const strategy = spyStrategy(`spy-ct9-${kind}`, async (input) => {
        const token = mintRunToken();
        const started = await startTheRoot({
          where: s.where,
          launchId: `launch-ct9-${kind}`,
          launchNonce: input.launchNonce,
          owner: buildOwnerRecord({
            launchId: `launch-ct9-${kind}`,
            runTokenHash: token.hash,
          }),
        });
        assert.equal(started.started, true);
        if (started.started) {
          held = {
            where: s.where,
            launchId: `launch-ct9-${kind}`,
            provider: started.provider,
            lease: started.lease,
            heartbeat: started.heartbeat,
          };
        }
      });
      both[kind] = await runLaunchHandshake(
        launchOf(s, strategy, {
          launchId: `launch-ct9-${kind}`,
          launchNonce: `nonce-ct9-${kind}`,
          requestKind: kind,
          printed,
        }),
      );
      // The record of either kind holds the same fields and the same outcome.
      const record = readTheLaunchRecord(launchRecordPathOf(s.place, `launch-ct9-${kind}`));
      assert.equal(record?.requestKind, kind);
      assert.equal(record?.outcome, "started");
      assert.equal(record?.detachStrategy, `spy-ct9-${kind}`);
      assert.deepEqual(printed, [`[SPECSTRIDE-LAUNCH] run=${RUN} state=running`]);
    } finally {
      if (held !== null) await endTheRoot(held, "completed");
      s.dispose();
    }
  }

  // The same path: the same steps, the same outcome, the same exit code.
  assert.deepEqual([...(both.pipeline?.steps ?? [])], [...(both.engine?.steps ?? [])]);
  assert.equal(both.pipeline?.outcome, both.engine?.outcome);
  assert.equal(both.pipeline?.exit, both.engine?.exit);

  // A run request of another kind refuses the launch, and writes no record.
  const s = scratch("ct9-other");
  try {
    const printed: string[] = [];
    const strategy = spyStrategy("spy-ct9-other", () => {
      throw new Error("the strategy must never be called for an unknown request kind");
    });
    const outcome = await runLaunchHandshake(
      launchOf(s, strategy, {
        launchId: "launch-ct9-other",
        launchNonce: "nonce-ct9-other",
        requestKind: "notebook",
        printed,
      }),
    );
    assert.equal(outcome.outcome, "refused");
    assert.equal(outcome.exit, 4);
    assert.equal(outcome.refusal, "unknown-mode");
    assert.deepEqual([...outcome.steps], [], "no step ran: it was refused before step 1");
    assert.equal(strategy.calls.length, 0, "the strategy was never called");
    assert.equal(
      existsSync(launchRecordPathOf(s.place, "launch-ct9-other")),
      false,
      "and no launch record was written for a request the product cannot read",
    );
    assert.match(printed[0] ?? "", /^\[SPECSTRIDE-REFUSE\] action=launch reason=unknown-mode /);
  } finally {
    s.dispose();
  }
});
