/**
 * T067 — every closed set the feature 122 table names holds an unknown-value
 * branch in its reader (F100-FR-209; annex X, §X.6).
 *
 * The rows are read from `packages/contracts/data/closed-sets.json` on the
 * disk, and each row's rule is exercised twice:
 *
 *   1. through the set's own `onUnknown`, which must give the branch the row
 *      names (refuse, show as `unknown`, ignore, or treat as the named
 *      member) — this is the branch every reader of the set shares;
 *   2. where the feature 122 product has a concrete reader of the set,
 *      through that reader, fed a value outside the set.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  endCausesOfAnEntryOfTheProcessRegistry,
  errorsOfADetachStrategy,
  handshakeOutcomes,
  inboxRequestTypes,
  reasonsOfALaunch,
  refusalsOfALaunchWrittenByTheDetachedRuntime,
  resultsOfACaseOfTheSpike,
  resultsOfALockProbe,
  resultsOfReclaimOfALock,
  classesOfTheProcessRegistryKindsOfProcess,
  whatADetachStrategySurvives,
} from "@specstride/contracts/enums/all-sets";
import type { UnknownValueKind } from "@specstride/contracts/enums";
import { exitOfLaunch } from "@specstride/contracts/state/handshake";
import { countsAsHeld } from "../../src/lock/probe.ts";
import { openOwnedEntriesOf } from "../../src/lock/probe.ts";
import { validateRequest } from "../../src/inbox/inbox.ts";
import { checkLayoutVersionAtLaunch } from "../../src/root/layout-version.ts";
import { lockPathsOf } from "../../src/lock/paths.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The rows of §X.6, read from the disk the way a reader would. */
const TABLE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../contracts/data/closed-sets.json", import.meta.url)),
    "utf8",
  ),
) as {
  closedSets: readonly {
    readonly number: number;
    readonly name: string;
    readonly unknownValue: string;
  }[];
};

/** Row of §X.6 by number; a missing row fails the test, not the reader. */
function rowOf(number: number): { name: string; unknownValue: string } {
  const row = TABLE.closedSets.find((one) => one.number === number);
  assert.ok(row !== undefined, `the table holds no row ${number}`);
  return { name: row.name, unknownValue: row.unknownValue };
}

/** Assert the branch a set gives for a value outside it. */
function branchOf(
  set: {
    onUnknown(value: string): {
      kind: UnknownValueKind;
      treatedAs?: string | undefined;
      set: string;
      message: string;
    };
  },
  value: string,
  kind: UnknownValueKind,
  treatedAs?: string,
): void {
  const outcome = set.onUnknown(value);
  assert.equal(outcome.kind, kind, `unknown value "${value}" of "${outcome.set}"`);
  assert.match(outcome.message, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  if (treatedAs !== undefined) {
    assert.equal(outcome.treatedAs, treatedAs);
  }
}

/** Every value of the set is a member, and one value outside it is not. */
function closed(
  set: { has(value: string): boolean; members: readonly string[] },
  outside: string,
): void {
  for (const member of set.members) assert.equal(set.has(member), true, `"${member}" is a member`);
  assert.equal(set.has(outside), false, `"${outside}" is outside the set`);
}

test("T067 rows 17, 21, 22, 23, 82, 209, 210, 211, 212, 213, 214: the unknown-value branch of every closed set of the feature, through its set and its readers", () => {
  // Row 17 — handshake outcomes: unknown is `refused`.
  assert.equal(rowOf(17).name, handshakeOutcomes.name);
  closed(handshakeOutcomes, "suspended");
  branchOf(handshakeOutcomes, "suspended", "refuse");
  // The reader of the outcome in the launch refuses a value outside the set
  // rather than resolving it to a code of a launch that never happened.
  assert.throws(() => exitOfLaunch("suspended" as never), /suspended/);

  // Row 21 — inbox request types: ignored and reported.
  assert.equal(rowOf(21).name, inboxRequestTypes.name);
  closed(inboxRequestTypes, "explode");
  branchOf(inboxRequestTypes, "explode", "ignore");
  // The reader of the BYTES ignores a request of an unknown type, with the
  // reason `unknown-type` (F122-FR-030).
  const validation = validateRequest({
    text: JSON.stringify({ type: "explode", data: {} }),
    expected: "stop",
    path: "/tmp/inbox/stop-1",
  });
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.ignored.reason, "unknown-type");
    assert.match(validation.ignored.detail, /explode/);
  }

  // Row 22 — classes of the process registry; kinds of process: class
  // `owned`, never `adoptable`.
  assert.equal(rowOf(22).name, classesOfTheProcessRegistryKindsOfProcess.name);
  closed(classesOfTheProcessRegistryKindsOfProcess, "hazardous");
  branchOf(classesOfTheProcessRegistryKindsOfProcess, "hazardous", "default", "owned");
  // The reader of the registry: an entry whose class the product cannot name
  // is read as `owned`, so it is never quietly let past the refusal.
  const controlRoot = mkdtempSync(join(tmpdir(), "cs22-c-"));
  const workspaceRealPath = mkdtempSync(join(tmpdir(), "cs22-w-"));
  try {
    const place = { controlRoot, workspaceRealPath };
    // `registryFilesOf` reads `<controlRoot>/features/<slug>/runs/<runId>/procs/*.jsonl`.
    const directory = join(controlRoot, "features", "cs-22", "runs", "run-cs22", "procs");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "w0.jsonl"),
      JSON.stringify({ procId: "p1", kind: "a-kind-no-table-names", pid: 4242, startTime: "0" }) +
        "\n",
    );
    const owner = { runId: "run-cs22" } as never;
    const owned = openOwnedEntriesOf(place as never, owner);
    assert.equal(owned.length, 1, "an entry of an unknown class is read as `owned`");
    assert.equal(owned[0]?.class, "owned");
  } finally {
    rmSync(controlRoot, { recursive: true, force: true });
    rmSync(workspaceRealPath, { recursive: true, force: true });
  }

  // Row 23 — results of a lock probe: `unknown`, which counts as held.
  assert.equal(rowOf(23).name, resultsOfALockProbe.name);
  branchOf(resultsOfALockProbe, "mostly-free", "show-as-unknown");
  // The reader of the probe: a result outside the table counts as held.
  assert.equal(countsAsHeld("mostly-free" as never), true);

  // Row 82 — reasons of a launch: `manual`.
  assert.equal(rowOf(82).name, reasonsOfALaunch.name);
  closed(reasonsOfALaunch, "automatic");
  branchOf(reasonsOfALaunch, "automatic", "default", "manual");

  // Row 209 — results of `reclaim` of a lock: `lost-race`.
  assert.equal(rowOf(209).name, resultsOfReclaimOfALock.name);
  closed(resultsOfReclaimOfALock, "won-race");
  branchOf(resultsOfReclaimOfALock, "won-race", "default", "lost-race");

  // Row 210 — errors of a detach strategy: `not-ready`; the launch is refused.
  assert.equal(rowOf(210).name, errorsOfADetachStrategy.name);
  closed(errorsOfADetachStrategy, "crashed");
  branchOf(errorsOfADetachStrategy, "crashed", "refuse");

  // Row 211 — what a detach strategy survives: ignored.
  assert.equal(rowOf(211).name, whatADetachStrategySurvives.name);
  closed(whatADetachStrategySurvives, "meteor");
  branchOf(whatADetachStrategySurvives, "meteor", "ignore");

  // Row 212 — refusals of a launch: shown as text; the launch stays refused.
  assert.equal(rowOf(212).name, refusalsOfALaunchWrittenByTheDetachedRuntime.name);
  closed(refusalsOfALaunchWrittenByTheDetachedRuntime, "layout-version-major");
  branchOf(refusalsOfALaunchWrittenByTheDetachedRuntime, "layout-version-major", "refuse");
  // The reader of the refusal text keeps the launch refused for a value the
  // set does not hold: the layout version refusal of F122-FR-043.
  const scratch = mkdtempSync(join(tmpdir(), "cs212-"));
  try {
    const place = { controlRoot: scratch, workspaceRealPath: scratch };
    const version = join(lockPathsOf(place as never).layoutVersionFile);
    mkdirSync(join(version, ".."), { recursive: true });
    writeFileSync(version, "9.9\n");
    const check = checkLayoutVersionAtLaunch(place as never, null);
    assert.equal(check.refuse, true);
    if (check.refuse) {
      assert.equal(check.refusal, "layout-version-major");
      // The unknown refusal is shown as text, and the exit stays a refusal.
      assert.equal(exitOfLaunch("refused", { refusal: "layout-version-major" }), 4);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // Row 213 — end causes of an entry of the process registry: shown as text.
  assert.equal(rowOf(213).name, endCausesOfAnEntryOfTheProcessRegistry.name);
  closed(endCausesOfAnEntryOfTheProcessRegistry, "vanished");
  branchOf(endCausesOfAnEntryOfTheProcessRegistry, "vanished", "refuse");

  // Row 214 — results of a case of the spike: `skipped`.
  assert.equal(rowOf(214).name, resultsOfACaseOfTheSpike.name);
  closed(resultsOfACaseOfTheSpike, "exploded");
  branchOf(resultsOfACaseOfTheSpike, "exploded", "default", "skipped");
});
