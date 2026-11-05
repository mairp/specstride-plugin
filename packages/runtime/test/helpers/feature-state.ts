/**
 * A control plane with the state of ONE feature in it, for the tests of
 * user story 4 (T061, T062).
 *
 * The planted state is the real thing and not a sketch: every approval record
 * carries the fifteen required fields of annex B §B.14 and is SIGNED with the
 * approval key of the feature, so a test that expects `state import` or
 * `state adopt` to verify them is testing verification and not a stub. Every
 * path comes from `statePathsOf`, which resolves the logical names of the
 * layout table, so a test never writes a path of its own.
 *
 * The control root is made under a `workspaces/<workspaceId>` directory, which
 * is the shape of the default control root (`<control>` =
 * `$XDG_STATE_HOME/specstride/workspaces/<workspaceId>`, annex B, roots
 * table). `state adopt` finds the plane of an old path as a sibling under it,
 * so a test of `adopt` needs that shape and not a bare directory.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { signApprovalRecord, signLedgerRecord } from "../../src/state/archive.ts";
import {
  approvalPathOf,
  ledgerKeyPathOf,
  ledgerPathOf,
  statePathsOf,
} from "../../src/state/paths.ts";
import { workspaceIdentityOf } from "../../src/lock/workspace-record.ts";
import type { StateCommandPlace } from "../../src/state/commands.ts";

/** The directory every per-workspace control root is a child of. */
export const WORKSPACES_SEGMENT = "workspaces" as const;

/** One control plane, with the tree it belongs to. */
export type PlantedPlane = {
  readonly place: StateCommandPlace;
  readonly controlRoot: string;
  readonly workspacesRoot: string;
  readonly workspaceRealPath: string;
  readonly workspaceId: string;
};

/** A control plane of a workspace, keyed by the identity of its tree. */
export function planeFor(workspacesRoot: string, workspaceRealPath: string): PlantedPlane {
  const workspaceId = workspaceIdentityOf(workspaceRealPath);
  const controlRoot = join(workspacesRoot, workspaceId);
  mkdirSync(controlRoot, { recursive: true, mode: 0o700 });
  return Object.freeze({
    place: Object.freeze({ controlRoot, workspaceRealPath, workspacesRoot }),
    controlRoot,
    workspacesRoot,
    workspaceRealPath,
    workspaceId,
  });
}

/** What a planted feature answers. */
export type PlantedFeature = PlantedPlane & {
  readonly slug: string;
  readonly approvalKey: string;
  readonly ledgerKey: string;
  readonly phases: readonly number[];
  readonly runId: string;
  readonly approvalPaths: readonly string[];
};

/** A valid, signed approval record of one phase (annex B, §B.14). */
export function anApprovalRecord(input: {
  readonly slug: string;
  readonly phase: number;
  readonly runId: string;
  readonly approvalKey: string;
}): Record<string, unknown> {
  return signApprovalRecord(
    {
      schema: "specstride.approval/1",
      feature: input.slug,
      phase: input.phase,
      runId: input.runId,
      engineStartId: "e1",
      attemptId: `e1-a1-p${String(input.phase)}`,
      verdictId: `v-${String(input.phase)}`,
      nonceHash: `nonce-${String(input.phase)}`,
      critic: { harness: "stub", provider: "stub", model: "stub", form: "initial-record" },
      evidenceHash: `evidence-${String(input.phase)}`,
      verification: { mode: "strict", hash: `verification-${String(input.phase)}` },
      treeFingerprint: `tree-${String(input.phase)}`,
      approvedAt: `2026-10-0${String(input.phase)}T00:00:00.000Z`,
      keyId: "approval-key-1",
    },
    input.approvalKey,
  );
}

/** A valid, signed ledger record (annex B, §B.13). */
export function aLedgerRecord(input: {
  readonly seq: number;
  readonly runId: string;
  readonly ledgerKey: string;
}): Record<string, unknown> {
  return signLedgerRecord(
    {
      schema: "specstride.ledger/1",
      seq: input.seq,
      prev: input.seq === 1 ? "" : `hash-${String(input.seq - 1)}`,
      ts: `2026-10-01T00:00:0${String(input.seq)}.000Z`,
      runId: input.runId,
      engineStartId: "e1",
      ns: "core",
      kind: "phase-approved",
      counters: { rejects: 0, attempt: 1, malformed: 0, pass: 1, yields: 0, breakers: 0 },
    },
    input.ledgerKey,
  );
}

/** Plant the state of one feature into the plane of a tree. */
export function plantFeatureState(options: {
  readonly plane: PlantedPlane;
  readonly slug?: string | undefined;
  readonly phases?: readonly number[] | undefined;
  readonly runId?: string | undefined;
  readonly approvalKey?: string | undefined;
}): PlantedFeature {
  const slug = options.slug ?? "122-detached-runtime";
  const phases = options.phases ?? [1, 2, 3];
  const runId = options.runId ?? "20261001-000000-1";
  const approvalKey = options.approvalKey ?? randomBytes(32).toString("hex");
  const ledgerKey = randomBytes(32).toString("hex");
  const paths = statePathsOf(options.plane.place, slug);
  mkdirSync(paths.approvalsDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(paths.keysDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(paths.learningDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(join(paths.runsDirectory, runId), { recursive: true, mode: 0o700 });
  writeFileSync(paths.approvalKeyFile, approvalKey, { mode: 0o600 });
  const approvalPaths: string[] = [];
  for (const phase of phases) {
    const path = approvalPathOf(options.plane.place, slug, phase);
    writeFileSync(
      path,
      JSON.stringify(anApprovalRecord({ slug, phase, runId, approvalKey }), null, 2) + "\n",
      {
        mode: 0o600,
      },
    );
    approvalPaths.push(path);
  }
  mkdirSync(join(paths.runsDirectory, runId, "keys"), { recursive: true, mode: 0o700 });
  writeFileSync(ledgerKeyPathOf(options.plane.place, slug, runId), ledgerKey, { mode: 0o600 });
  writeFileSync(
    ledgerPathOf(options.plane.place, slug, runId),
    phases
      .map((phase) => JSON.stringify(aLedgerRecord({ seq: phase, runId, ledgerKey })))
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  writeFileSync(paths.learningDecisionsFile, JSON.stringify({ applied: ["D-1"] }, null, 2) + "\n", {
    mode: 0o600,
  });
  writeFileSync(
    paths.learningEventsFile,
    JSON.stringify({ schema: "specstride.event/1", type: "learning.applied" }) + "\n",
    { mode: 0o600 },
  );
  return Object.freeze({
    ...options.plane,
    slug,
    approvalKey,
    ledgerKey,
    phases: Object.freeze([...phases]),
    runId,
    approvalPaths: Object.freeze(approvalPaths),
  });
}

/** A scratch world: a state root with `workspaces/` in it, and working trees. */
export type ScratchWorld = {
  /** The directory `<control>` roots are children of. */
  readonly workspacesRoot: string;
  /** Make a working tree that exists on disk. */
  readonly tree: (label: string) => string;
  /** A path that does NOT exist, for a tree that has moved away. */
  readonly goneTree: (label: string) => string;
  /** A plane for a tree path, existing or not. */
  readonly plane: (workspaceRealPath: string) => PlantedPlane;
  /** A place outside every working tree, for an archive. */
  readonly outside: string;
  readonly dispose: () => void;
};

/** Make the scratch world of one test. */
export function makeScratchWorld(label = "us4"): ScratchWorld {
  const root = resolvePath(mkdtempSync(join(tmpdir(), `specstride-${label}-`)));
  const workspacesRoot = join(root, "state", "specstride", WORKSPACES_SEGMENT);
  const outside = join(root, "outside");
  mkdirSync(workspacesRoot, { recursive: true, mode: 0o700 });
  mkdirSync(outside, { recursive: true, mode: 0o700 });
  let disposed = false;
  return Object.freeze({
    workspacesRoot,
    outside,
    tree(name: string): string {
      const path = join(root, "trees", name);
      mkdirSync(path, { recursive: true, mode: 0o755 });
      return path;
    },
    goneTree(name: string): string {
      // A path that never existed: `state adopt` derives the old workspace
      // identity from the path TEXT, which is the whole point of D-12 — the
      // tree has moved, so the old path is gone.
      return join(root, "trees", `${name}-gone`);
    },
    plane(workspaceRealPath: string): PlantedPlane {
      return planeFor(workspacesRoot, workspaceRealPath);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      rmSync(root, { recursive: true, force: true });
    },
  });
}
