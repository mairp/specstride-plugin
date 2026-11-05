/**
 * T062 — CT-122-37 and CT-122-38: a moved working tree keeps its approvals
 * (F122-FR-037, F122-FR-038, F122-SC-003).
 *
 * The subjects are `packages/cli/src/commands/launch-handshake.ts` (the
 * refusal `unadopted-approvals`), `packages/runtime/src/state/commands.ts`
 * (`state adopt`) and `packages/runtime/src/root/marker.ts` (the advisory
 * marker).
 *
 * The scenario is the whole of user story 4, end to end, with no step faked:
 * a tree is worked on at one path, the tree MOVES, the launch at the new path
 * is refused because the control plane of the new path knows nothing of the
 * ticked phases, `state adopt` brings the plane of the old path over, and the
 * next launch is no longer refused and continues at the first phase that has
 * no approval record.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import {
  readCanonicalSpecModel,
  type CanonicalSpecModel,
} from "@specstride/contracts/records/canonical-spec-model";
import { STRATEGY_WITHOUT_DETACHING, type DetachStrategy } from "@specstride/contracts/ep/detach";
import {
  THE_THREE_COMMANDS,
  UNADOPTED_APPROVALS,
  UNADOPTED_APPROVALS_IS_REFUSED_BEFORE_STEP,
  THE_RUN_STARTS_AT_THE_FIRST_PHASE_OVER_TICKED_PHASES,
  approvedPhasesOf,
  firstPhaseWithoutAnApprovalRecord,
  launchRecordPathOf,
  nextForARefusal,
  phaseIsTicked,
  readTheLaunchRecord,
  runLaunchHandshake,
  tickedPhasesOf,
  unadoptedApprovalsOf,
} from "../../../cli/src/commands/launch-handshake.ts";
import { stateAdopt } from "../../src/state/commands.ts";
import { approvalFilesOf } from "../../src/state/paths.ts";
import {
  MARKER_DECIDES,
  MARKER_INTEGRITY_EVENT,
  MARKER_LOGICAL_NAME,
  MARKER_REFUSAL,
  THE_MARKER_IS_ADVISORY,
  checkTheMarkerAtLaunch,
  markerDecides,
  markerPathOf,
  probeTheOwnerOfTheMarker,
  readTheMarker,
  removeTheMarker,
  rewriteTheMarkerIfMissing,
  writeTheMarker,
} from "../../src/root/marker.ts";
import { readEvents, startTheRoot, type RootPlace } from "../../src/root/start.ts";
import { buildOwnerRecord } from "../../src/lock/owner-record.ts";
import { lockPathsOf } from "../../src/lock/paths.ts";
import { mintRunToken } from "../../src/procs/run-token.ts";
import { makeScratchWorld, plantFeatureState } from "../helpers/feature-state.ts";

/* ------------------------------------------------------------------ *
 * The canonical spec model of a feature whose first phases are ticked.
 * ------------------------------------------------------------------ */

/**
 * A model of annex C §C.7, validated against
 * `specstride.spec-format/1:model`. The ticked phases are read out of
 * `phases[].tasks[].ticked` — the field of the MODEL — so this test proves the
 * reading goes through the canonical spec model and not through a parser of
 * `tasks.md` that the refusal would otherwise need.
 */
function aModelWithTickedPhases(
  slug: string,
  ticked: readonly number[],
  total = 5,
): CanonicalSpecModel {
  return readCanonicalSpecModel({
    format: "spec-kit",
    feature: slug,
    sources: [
      {
        kind: "tasks",
        path: `specs/${slug}/tasks.md`,
        contentHash: "a".repeat(64),
        hashIgnoringCheckboxes: "b".repeat(64),
      },
    ],
    phases: Array.from({ length: total }, (_unused, index) => {
      const number = index + 1;
      return {
        number,
        title: `Phase ${String(number)}`,
        section: `## Phase ${String(number)}`,
        criteria: [`the criterion of phase ${String(number)}`],
        tasks: [
          {
            id: `T00${String(number)}`,
            markers: ["[P]"],
            text: `the task of phase ${String(number)}`,
            ticked: ticked.includes(number),
            line: 10 * number,
          },
        ],
      };
    }),
  });
}

/** A detach strategy that would be called if the launch were not refused. */
function aStrategyThatRecordsWhetherItRan(): DetachStrategy & { readonly calls: number[] } {
  const calls: number[] = [];
  const strategy = {
    describe: () => ({
      id: STRATEGY_WITHOUT_DETACHING,
      survives: [],
      requiresTool: false,
    }),
    available: () => ({ available: true as const }),
    async start(): Promise<never> {
      calls.push(1);
      throw new Error("the strategy must not be called when the launch is refused");
    },
    calls,
  };
  return strategy as unknown as DetachStrategy & { readonly calls: number[] };
}

/* ================================================================== *
 * CT-122-37 — the launch over ticked phases (F122-FR-037, F122-SC-003).
 * ================================================================== */

test("CT-122-37: a launch over ticked phases without approval records is refused, names the three commands, and never calls the detach strategy", async () => {
  const world = makeScratchWorld("ct37");
  try {
    // The tree moved: it was at `oldPath` (now gone) and is at `newPath`.
    const oldPath = world.goneTree("worked-on");
    const old = plantFeatureState({ plane: world.plane(oldPath), phases: [1, 2, 3] });
    const newPath = world.tree("moved-to");
    const here = world.plane(newPath);

    // The spec shows phases 1 to 3 as ticked; the plane of the NEW path holds
    // no approval record at all.
    const model = aModelWithTickedPhases(old.slug, [1, 2, 3]);
    assert.deepEqual([...tickedPhasesOf(model)], [1, 2, 3]);
    assert.deepEqual([...approvedPhasesOf(here.place, old.slug)], []);

    const reading = unadoptedApprovalsOf(here.place, old.slug, model);
    assert.ok(reading.refuse);
    assert.deepEqual([...reading.unadopted], [1, 2, 3]);
    assert.equal(reading.firstPhaseWithoutARecord, 1);

    const strategy = aStrategyThatRecordsWhetherItRan();
    const lines: string[] = [];
    const outcome = await runLaunchHandshake({
      place: here.place,
      slug: old.slug,
      launchId: "launch-moved",
      runId: "20261003-000000-1",
      workspaceId: here.workspaceId,
      requestKind: "pipeline",
      request: { kind: "pipeline" },
      engineExecutable: { path: "/usr/bin/node", argv: [] },
      strategy,
      runtimeEntry: ["/usr/bin/node", "root.js"],
      environmentAllowList: [],
      runtimeLogLogicalName: "launch:<launchId>:runtime-log",
      specModel: model,
      print: (line) => void lines.push(line),
    });

    assert.equal(outcome.outcome, "refused");
    assert.equal(outcome.refusal, UNADOPTED_APPROVALS);
    assert.equal(outcome.exit, 4, "the refusal table of `cli-state-commands.md` gives exit 4");
    // F122-FR-037 — *refused BEFORE the detach strategy is called*.
    assert.deepEqual(strategy.calls, [], "the detach strategy was never called");
    assert.deepEqual([...outcome.steps], [1], "step 2 was never reached");
    assert.equal(UNADOPTED_APPROVALS_IS_REFUSED_BEFORE_STEP, 2);
    assert.equal(THE_RUN_STARTS_AT_THE_FIRST_PHASE_OVER_TICKED_PHASES, false);

    // One line, and it NAMES THE THREE COMMANDS.
    assert.equal(lines.length, 1);
    const line = lines[0] ?? "";
    assert.match(line, /^\[SPECSTRIDE-REFUSE\] action=launch reason=unadopted-approvals next=/);
    for (const command of THE_THREE_COMMANDS) {
      assert.ok(line.includes(command), `the refusal names \`${command}\`: ${line}`);
    }
    assert.equal(THE_THREE_COMMANDS.length, 3);
    assert.deepEqual([...THE_THREE_COMMANDS], ["state export", "state import", "state adopt"]);
    assert.ok(nextForARefusal(UNADOPTED_APPROVALS).includes("state adopt"));

    // The refusal is written into the launch record, read off the disk.
    const record = readTheLaunchRecord(launchRecordPathOf(here.place, "launch-moved"));
    assert.notEqual(record, null);
    assert.equal(String(record?.outcome), "refused");
    assert.equal(
      String((record as unknown as Record<string, unknown>)["refusal"]),
      UNADOPTED_APPROVALS,
    );

    // And the state is still only at the old path: the refusal moved nothing.
    assert.equal(approvalFilesOf(old.place, old.slug).length, 3);
    assert.equal(approvalFilesOf(here.place, old.slug).length, 0);
  } finally {
    world.dispose();
  }
});

test("CT-122-37: after `state adopt` the launch is no longer refused and the run continues at the first phase without an approval record (F122-SC-003)", async () => {
  const world = makeScratchWorld("ct37b");
  try {
    const oldPath = world.goneTree("worked-on");
    const old = plantFeatureState({ plane: world.plane(oldPath), phases: [1, 2, 3] });
    const newPath = world.tree("moved-to");
    const here = world.plane(newPath);
    const model = aModelWithTickedPhases(old.slug, [1, 2, 3]);

    // Before: refused.
    assert.ok(unadoptedApprovalsOf(here.place, old.slug, model).refuse);

    // `state adopt` — the command the refusal named.
    const adopted = await stateAdopt({
      place: here.place,
      slug: old.slug,
      from: oldPath,
      print: () => undefined,
    });
    assert.equal(adopted.exit, 0, JSON.stringify(adopted));
    assert.equal(adopted.approvals, 3);

    // After: not refused, and the first phase without a record is 4.
    const after = unadoptedApprovalsOf(here.place, old.slug, model);
    assert.equal(after.refuse, false, after.detail);
    assert.deepEqual([...after.unadopted], []);
    assert.deepEqual([...after.approved], [1, 2, 3]);
    assert.equal(after.firstPhaseWithoutARecord, 4, "the run continues at phase 4");
    assert.equal(firstPhaseWithoutAnApprovalRecord(model, [1, 2, 3]), 4);

    // And the handshake really does go on to step 2 now.
    const strategy = aStrategyThatRecordsWhetherItRan();
    const lines: string[] = [];
    const outcome = await runLaunchHandshake({
      place: here.place,
      slug: old.slug,
      launchId: "launch-after-adopt",
      runId: "20261003-000001-1",
      workspaceId: here.workspaceId,
      requestKind: "pipeline",
      request: { kind: "pipeline" },
      engineExecutable: { path: "/usr/bin/node", argv: [] },
      strategy,
      runtimeEntry: ["/usr/bin/node", "root.js"],
      environmentAllowList: [],
      runtimeLogLogicalName: "launch:<launchId>:runtime-log",
      specModel: model,
      handshakeLimitSeconds: 0.05,
      print: (line) => void lines.push(line),
    });
    assert.notEqual(outcome.refusal, UNADOPTED_APPROVALS, "the refusal is gone");
    assert.deepEqual(strategy.calls, [1], "the detach strategy WAS called this time");
    assert.ok(outcome.steps.includes(2), "step 2 was reached");
  } finally {
    world.dispose();
  }
});

test("CT-122-37: a phase is ticked only when it has tasks and every one of them is ticked", () => {
  const model = aModelWithTickedPhases("f", [1, 2]);
  assert.deepEqual([...tickedPhasesOf(model)], [1, 2]);
  // A phase with a half-ticked task list is not ticked.
  const half = readCanonicalSpecModel({
    format: "spec-kit",
    feature: "f",
    sources: [{ kind: "tasks", path: "t.md", contentHash: "c".repeat(64) }],
    phases: [
      {
        number: 1,
        title: "One",
        section: "## 1",
        criteria: ["x"],
        tasks: [
          { id: "T001", markers: [], text: "a", ticked: true, line: 1 },
          { id: "T002", markers: [], text: "b", ticked: false, line: 2 },
        ],
      },
      { number: 2, title: "Two", section: "## 2", criteria: ["x"], tasks: [] },
    ],
  });
  assert.deepEqual(
    [...tickedPhasesOf(half)],
    [],
    "neither a half-ticked nor an empty phase is ticked",
  );
  assert.equal(phaseIsTicked(half.phases[0] as never), false);
  assert.equal(phaseIsTicked(half.phases[1] as never), false, "a phase with no task is not ticked");
});

test("CT-122-37: a FILE that is not a valid approval record does not count as an approval", async () => {
  const world = makeScratchWorld("ct37c");
  try {
    const tree = world.tree("here");
    const planted = plantFeatureState({ plane: world.plane(tree), phases: [1] });
    const model = aModelWithTickedPhases(planted.slug, [1, 2]);
    assert.deepEqual([...approvedPhasesOf(planted.place, planted.slug)], [1]);

    // A bare marker for phase 2: a file at the right path that is no record.
    const path = planted.approvalPaths[0]?.replace("phase-1.json", "phase-2.json");
    assert.ok(path !== undefined);
    writeFileSync(path, JSON.stringify({ approved: true }) + "\n", { mode: 0o600 });
    assert.deepEqual(
      [...approvedPhasesOf(planted.place, planted.slug)],
      [1],
      "a bare marker without a record counts as not approved (F100-FR-070)",
    );
    assert.deepEqual([...unadoptedApprovalsOf(planted.place, planted.slug, model).unadopted], [2]);

    // A record of ANOTHER phase at this path does not count either.
    writeFileSync(path, readFileSync(planted.approvalPaths[0] as string, "utf8"), { mode: 0o600 });
    assert.deepEqual(
      [...approvedPhasesOf(planted.place, planted.slug)],
      [1],
      "a record whose `phase` does not match its file is no approval of that phase",
    );
  } finally {
    world.dispose();
  }
});

/* ================================================================== *
 * CT-122-38 — the advisory marker (F122-FR-038).
 * ================================================================== */

/** A scratch workspace for the root: a control root, a tree, a runtime dir. */
function scratchRoot(label: string): {
  readonly where: RootPlace;
  readonly runtimeDirectory: string;
  readonly dispose: () => void;
} {
  const controlRoot = mkdtempSync(join(tmpdir(), `specstride-${label}-c-`));
  const workspaceRealPath = mkdtempSync(join(tmpdir(), `specstride-${label}-w-`));
  const runtimeDirectory = mkdtempSync(join(tmpdir(), `specstride-${label}-r-`));
  mkdirSync(join(workspaceRealPath, ".specstride"), { recursive: true });
  return {
    where: {
      place: { controlRoot, workspaceRealPath },
      slug: "122-detached-runtime",
      runId: "20261003-000002-1",
    },
    runtimeDirectory,
    dispose(): void {
      for (const path of [controlRoot, workspaceRealPath, runtimeDirectory]) {
        rmSync(path, { recursive: true, force: true });
      }
    },
  };
}

test("CT-122-38: a marker whose owner cannot be probed refuses the launch with `foreign-owner`; a provably dead owner does not", async () => {
  const s = scratchRoot("ct38-foreign");
  try {
    const place = s.where.place;
    const mine = buildOwnerRecord({ launchId: "L", runTokenHash: "h" });

    // No marker: nothing is refused.
    assert.equal(readTheMarker(place).present, false);
    assert.equal(checkTheMarkerAtLaunch(place).refuse, false);

    // A marker made on ANOTHER HOST: its process id means nothing here, so it
    // cannot be probed at all (F122-FR-013's `foreign`).
    writeTheMarker(place, { ...mine, hostName: `${String(mine.hostName)}-elsewhere` }, "L-foreign");
    const foreign = checkTheMarkerAtLaunch(place);
    assert.equal(foreign.refuse, true, foreign.because);
    assert.equal(foreign.refusal, MARKER_REFUSAL);
    assert.equal(foreign.refusal, "foreign-owner");
    assert.equal(foreign.probe, "cannot-be-probed");
    assert.equal(foreign.path, markerPathOf(place));

    // And the ROOT refuses the launch over it, before it takes the lock.
    const token = mintRunToken();
    const refused = await startTheRoot({
      where: s.where,
      launchId: "launch-over-foreign-marker",
      launchNonce: "n1",
      owner: buildOwnerRecord({ launchId: "launch-over-foreign-marker", runTokenHash: token.hash }),
    });
    assert.equal(refused.started, false);
    if (refused.started) return;
    assert.equal(refused.refusal, "foreign-owner");
    assert.equal(refused.exit, 4, "`foreign-owner` is exit 4 (`cli-state-commands.md`)");
    assert.match(refused.detail, /workspace:active/);
    // Nothing of the run was written: no lock, because the check came first.
    assert.equal(
      existsSync(lockPathsOf(place).lockDirectory),
      false,
      "a refused launch left no lock behind",
    );

    // A marker whose owner is PROVABLY DEAD refuses nothing (F122-FR-038).
    // Another boot identity: *an owner whose boot identity differs from the
    // present boot MUST count as dead, whatever process now has its pid*.
    writeTheMarker(place, { ...mine, bootId: "a-boot-that-is-over" }, "L-dead");
    const dead = checkTheMarkerAtLaunch(place);
    assert.equal(dead.refuse, false, dead.because);
    assert.equal(dead.probe, "dead");
    const probe = probeTheOwnerOfTheMarker({
      ...mine,
      bootId: "a-boot-that-is-over",
    });
    assert.equal(probe.answer, "dead");

    // A pid that is gone, in this boot, is dead too.
    writeTheMarker(place, { ...mine, pid: 999_999, startTime: "1" }, "L-gone");
    const gone = checkTheMarkerAtLaunch(place);
    assert.equal(gone.refuse, false, gone.because);
    assert.equal(gone.probe, "dead");

    // And over a dead marker the root really does start.
    const started = await startTheRoot({
      where: s.where,
      launchId: "launch-over-dead-marker",
      launchNonce: "n2",
      owner: buildOwnerRecord({ launchId: "launch-over-dead-marker", runTokenHash: token.hash }),
    });
    assert.equal(started.started, true, JSON.stringify(started));
    if (!started.started) return;
    started.heartbeat.stop();
    assert.notEqual(started.markerCheck, null);
    assert.equal(started.markerCheck?.refuse, false);
  } finally {
    s.dispose();
  }
});

test("CT-122-38: a marker removed while the run lives is written again at the next heartbeat and an integrity event is raised", async () => {
  const s = scratchRoot("ct38-rewrite");
  try {
    const place = s.where.place;
    const token = mintRunToken();
    const started = await startTheRoot({
      where: s.where,
      launchId: "launch-live",
      launchNonce: "n",
      owner: buildOwnerRecord({ launchId: "launch-live", runTokenHash: token.hash }),
    });
    assert.equal(started.started, true, JSON.stringify(started));
    if (!started.started) return;
    try {
      const marker = markerPathOf(place);
      assert.equal(started.markerPath, marker);
      assert.ok(existsSync(marker), "the root wrote the marker at the start");
      const eventsBefore = readEvents(s.where).length;

      // The proposer deletes the marker (the edge case of spec.md).
      assert.equal(removeTheMarker(place), true);
      assert.equal(existsSync(marker), false);

      // The next heartbeat of the root writes it again AND raises the event.
      const beat = started.heartbeat.beatNow();
      assert.notEqual(beat, null, "the heartbeat beat");
      assert.ok(existsSync(marker), "the marker is back on disk");
      const back = readTheMarker(place);
      assert.equal(back.present, true);
      assert.equal(back.present && back.readable, true);

      const events = readEvents(s.where);
      assert.ok(events.length > eventsBefore, "an event was appended");
      const raised = events.filter((one) => one.type === MARKER_INTEGRITY_EVENT);
      assert.equal(raised.length, 1, JSON.stringify(events.map((one) => one.type)));
      const data = (raised[0] as { data: Record<string, unknown> }).data;
      assert.equal(data["logicalName"], MARKER_LOGICAL_NAME);
      assert.equal(data["logicalName"], "workspace:active");
      assert.equal(data["path"], marker);
      assert.equal(data["wasMissing"], true);
      assert.equal(data["launchId"], "launch-live");
      assert.equal(MARKER_INTEGRITY_EVENT, "integrity.marker-removed");
      // The outcome of the root records the rewrite too.
      assert.equal(started.markerRewrites.length, 1);
      assert.equal(started.markerRewrites[0]?.rewritten, true);

      // A heartbeat with the marker in place rewrites nothing and raises
      // nothing: the event is about an integrity breach, not about a beat.
      const after = readEvents(s.where).length;
      started.heartbeat.beatNow();
      assert.equal(readEvents(s.where).length, after, "a healthy beat raises no event");
      assert.equal(started.markerRewrites.length, 1);
    } finally {
      started.heartbeat.stop();
    }
  } finally {
    s.dispose();
  }
});

test("CT-122-38: an unreadable marker is treated as a missing one — it refuses nothing and is written again", () => {
  const s = scratchRoot("ct38-junk");
  try {
    const place = s.where.place;
    const mine = buildOwnerRecord({ launchId: "L", runTokenHash: "h" });
    writeFileSync(markerPathOf(place), "not a record at all", { mode: 0o600 });
    const reading = readTheMarker(place);
    assert.equal(reading.present, true);
    assert.equal(reading.present && reading.readable, false);

    // It refuses NOTHING: were it a refusal, any writer of the workspace part
    // could deny every launch of the workspace, and the marker is advisory.
    const check = checkTheMarkerAtLaunch(place);
    assert.equal(check.refuse, false, check.because);
    assert.equal(check.unreadable, true);

    // The root writes it again and asks for the integrity event.
    const beat = rewriteTheMarkerIfMissing(place, mine, "L-again");
    assert.equal(beat.rewritten, true);
    assert.notEqual(beat.integrityEvent, null);
    assert.equal(beat.integrityEvent?.type, MARKER_INTEGRITY_EVENT);
    assert.equal(beat.integrityEvent?.data["wasUnreadable"], true);
    const back = readTheMarker(place);
    assert.equal(back.present && back.readable, true);

    // A second call changes nothing and asks for no event.
    const again = rewriteTheMarkerIfMissing(place, mine, "L-again");
    assert.equal(again.rewritten, false);
    assert.equal(again.integrityEvent, null);
  } finally {
    s.dispose();
  }
});

test("CT-122-38: the marker decides nothing else", () => {
  assert.equal(THE_MARKER_IS_ADVISORY, true);
  assert.deepEqual([...MARKER_DECIDES], ["refuse-a-launch-whose-owner-cannot-be-probed"]);
  assert.equal(markerDecides("refuse-a-launch-whose-owner-cannot-be-probed"), true);
  for (const question of [
    "take-the-lock",
    "start-the-run",
    "attach-to-the-run",
    "end-a-process",
    "approve-a-phase",
    "reclaim-the-lock",
  ]) {
    assert.equal(markerDecides(question), false, `the marker does not decide \`${question}\``);
  }
});

test("CT-122-38: the marker lies in the workspace part, under the logical name of the layout table", () => {
  const s = scratchRoot("ct38-path");
  try {
    const place = s.where.place;
    const path = markerPathOf(place);
    assert.equal(path, lockPathsOf(place).advisoryMarkerFile);
    assert.ok(
      path.startsWith(join(place.workspaceRealPath, ".specstride")),
      `the marker is in the workspace part: ${path}`,
    );
    assert.equal(MARKER_LOGICAL_NAME, "workspace:active");
  } finally {
    s.dispose();
  }
});
